import { ConflictException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, StoreStatus } from '@prisma/client';

import { busyMeterOf, isBusy } from '../catalog/store-availability';
import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StoreAvailabilityNotifier } from '../realtime/store-availability.notifier';

/** A store's shift as the cabinet and the kitchen board show it. */
export interface StoreShiftDto {
  storeId: string;
  /** True while a shift is open — the only time the store takes orders. */
  open: boolean;
  /** When the current shift started; the last one's start when closed. Null if there never was one. */
  openedAt: string | null;
  openedByName: string | null;
  /** When the last shift ended. Null while open or if there never was one. */
  closedAt: string | null;
  closedByName: string | null;
  /**
   * The kitchen marked the store «Загружены» (status OVERLOADED): customers
   * see it as busy, orders still come in. See {@link StoreShiftService.setBusy}.
   */
  busy: boolean;
}

const WITH_NAMES = {
  openedBy: { select: { name: true, email: true } },
  closedBy: { select: { name: true, email: true } },
} as const;

/**
 * Opens and closes a store's working shift. The store takes orders only
 * while a shift is open; the catalog reports it as `acceptingOrders` and
 * order creation refuses otherwise. Both actions are idempotent, so two
 * tablets tapping the same button do not fight.
 *
 * Also the kitchen's «Загружены» switch, which travels with the shift on
 * the same realtime event so every tablet of the store shows it at once.
 */
@Injectable()
export class StoreShiftService {
  private readonly logger = new Logger(StoreShiftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly availability: StoreAvailabilityNotifier,
    private readonly kitchen: KitchenLoadService,
  ) {}

  async current(storeId: string): Promise<StoreShiftDto> {
    const store = await this.findStore(storeId);
    const last = await this.prisma.storeShift.findFirst({
      where: { storeId },
      orderBy: { openedAt: 'desc' },
      include: WITH_NAMES,
    });
    return toDto(storeId, last, isBusy(store));
  }

  async open(storeId: string, userId: string): Promise<StoreShiftDto> {
    await this.findStore(storeId);
    const existing = await this.prisma.storeShift.findFirst({ where: { storeId, closedAt: null } });
    if (!existing) {
      try {
        await this.prisma.storeShift.create({ data: { storeId, openedById: userId } });
      } catch (err) {
        // The partial unique index let only one of two simultaneous taps in;
        // the other one's shift is the open one, which is what both wanted.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    return this.announce(storeId);
  }

  /**
   * "Finish work". A store left marked busy is switched back to normal: the
   * marker is about the rush in front of the counter now, and tomorrow's
   * customers should not see yesterday's.
   */
  async close(storeId: string, userId: string): Promise<StoreShiftDto> {
    const store = await this.findStore(storeId);
    await this.prisma.storeShift.updateMany({
      where: { storeId, closedAt: null },
      data: { closedAt: new Date(), closedById: userId },
    });
    if (isBusy(store)) {
      await this.prisma.store.updateMany({
        where: { id: storeId, status: StoreStatus.OVERLOADED },
        data: { status: StoreStatus.OPEN },
      });
      await this.announceLoad(storeId);
    }
    return this.announce(storeId);
  }

  /**
   * The kitchen's «Загружены» switch: on sets the store's status to
   * OVERLOADED, off back to OPEN. That is the status the owner sees in
   * «Точки» and can also set in the store editor, and the storefronts show
   * as «Загружена» with a full (red) load meter. Orders keep coming; the
   * ETA stays the queue-based one. A store switched off (CLOSED) is not
   * touched — 409 `STORE_SWITCHED_OFF`. Idempotent.
   */
  async setBusy(storeId: string, busy: boolean): Promise<StoreShiftDto> {
    const store = await this.findStore(storeId);
    if (store.status === StoreStatus.CLOSED) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'STORE_SWITCHED_OFF',
        message: 'The store is switched off; turn it on before marking it busy',
      });
    }
    if (isBusy(store) !== busy) {
      // Conditional on the status read above, so a store switched off in the
      // meantime stays off.
      await this.prisma.store.updateMany({
        where: { id: storeId, status: busy ? StoreStatus.OPEN : StoreStatus.OVERLOADED },
        data: { status: busy ? StoreStatus.OVERLOADED : StoreStatus.OPEN },
      });
      await this.announceLoad(storeId);
    }
    return this.announce(storeId);
  }

  /**
   * Kitchen screens of the store get the shift itself; every client — the
   * storefronts included — learns whether the store now takes orders.
   */
  private async announce(storeId: string): Promise<StoreShiftDto> {
    const shift = await this.current(storeId);
    this.realtime.emitKdsShiftChanged({ storeId, shift });
    await this.availability.announce(storeId);
    return shift;
  }

  /**
   * `store.loadChanged` for every connected client, with the load meter and
   * the current ETA. Storefronts also refetch the store on the
   * `store.availabilityChanged` that {@link announce} sends right after.
   * Best effort, like the availability broadcast.
   */
  private async announceLoad(storeId: string): Promise<void> {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { status: true, busyMeter: true, baseEtaSeconds: true, kitchenParallelism: true },
      });
      if (!store) return;
      const queue = await this.kitchen.queueWaitSeconds(storeId, store.kitchenParallelism);
      this.realtime.emitStoreLoad({
        storeId,
        busy: isBusy(store),
        busyMeter: busyMeterOf(store),
        currentEtaSeconds: store.baseEtaSeconds + queue,
      });
    } catch (err) {
      this.logger.warn(`store.loadChanged for ${storeId} not sent: ${(err as Error).message}`);
    }
  }

  private async findStore(storeId: string): Promise<{ id: string; status: StoreStatus }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, status: true } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }
}

type ShiftRow = Prisma.StoreShiftGetPayload<{ include: typeof WITH_NAMES }>;

function personName(user: { name: string | null; email: string | null } | null): string | null {
  return user?.name?.trim() || user?.email || null;
}

export function toDto(storeId: string, shift: ShiftRow | null, busy = false): StoreShiftDto {
  return {
    storeId,
    open: shift != null && shift.closedAt == null,
    openedAt: shift?.openedAt.toISOString() ?? null,
    openedByName: personName(shift?.openedBy ?? null),
    closedAt: shift?.closedAt?.toISOString() ?? null,
    closedByName: personName(shift?.closedBy ?? null),
    busy,
  };
}
