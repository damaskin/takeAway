import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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
 */
@Injectable()
export class StoreShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly availability: StoreAvailabilityNotifier,
  ) {}

  async current(storeId: string): Promise<StoreShiftDto> {
    await this.assertStore(storeId);
    const last = await this.prisma.storeShift.findFirst({
      where: { storeId },
      orderBy: { openedAt: 'desc' },
      include: WITH_NAMES,
    });
    return toDto(storeId, last);
  }

  async open(storeId: string, userId: string): Promise<StoreShiftDto> {
    await this.assertStore(storeId);
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

  async close(storeId: string, userId: string): Promise<StoreShiftDto> {
    await this.assertStore(storeId);
    await this.prisma.storeShift.updateMany({
      where: { storeId, closedAt: null },
      data: { closedAt: new Date(), closedById: userId },
    });
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

  private async assertStore(storeId: string): Promise<void> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) throw new NotFoundException('Store not found');
  }
}

type ShiftRow = Prisma.StoreShiftGetPayload<{ include: typeof WITH_NAMES }>;

function personName(user: { name: string | null; email: string | null } | null): string | null {
  return user?.name?.trim() || user?.email || null;
}

export function toDto(storeId: string, shift: ShiftRow | null): StoreShiftDto {
  return {
    storeId,
    open: shift != null && shift.closedAt == null,
    openedAt: shift?.openedAt.toISOString() ?? null,
    openedByName: personName(shift?.openedBy ?? null),
    closedAt: shift?.closedAt?.toISOString() ?? null,
    closedByName: personName(shift?.closedBy ?? null),
  };
}
