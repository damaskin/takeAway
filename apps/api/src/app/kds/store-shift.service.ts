import { ConflictException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, StoreStatus } from '@prisma/client';
import type {
  KitchenShiftState,
  ShiftCloseSummary,
  ShiftExtendMinutes,
  ShiftHasUnacceptedOrdersBody,
} from '@takeaway/shared-types';

import { busyMeterOf, isBusy } from '../catalog/store-availability';
import { codedConflict } from '../common/http/coded-conflict';
import { DUE_SOON_SECONDS, KitchenLoadService } from '../kitchen/kitchen-load.service';
import {
  closingAfter,
  closingBefore,
  hoursAround,
  type HoursAround,
  openingAfter,
  withinHours,
} from '../kitchen/opening-hours';
import { StoreAvailabilityService, type StoreAvailabilityView } from '../kitchen/store-availability.service';
import { CARD_PROVIDERS } from '../payments/card-providers';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StoreAvailabilityNotifier } from '../realtime/store-availability.notifier';

/** A store's shift as the cabinet and the kitchen board show it (`GET /kds/shift`). */
export type StoreShiftDto = KitchenShiftState;

const WITH_NAMES = {
  openedBy: { select: { name: true, email: true } },
  closedBy: { select: { name: true, email: true } },
} as const;

/** An extension never reaches further than this past the closing it extends. */
export const MAX_EXTENSION_SECONDS = 4 * 60 * 60;

/** A shift is not closed by the schedule when the next window opens within this. */
export const AUTO_CLOSE_NEXT_OPENING_SECONDS = 60 * 60;

/** {@link autoCloseDue}: `AUTO_CLOSE_GRACE_MINUTES` when unset. */
export const DEFAULT_AUTO_CLOSE_GRACE_MINUTES = 10;

/** The open orders of a store, as "Finish work" needs to see them. */
const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.PAID,
  OrderStatus.ACCEPTED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.READY,
];

/** What an open order looks like to the shift rules. */
interface ShiftOrder {
  status: OrderStatus;
  pickupAt: Date;
  kitchenVisibleAt: Date | null;
  payments: ReadonlyArray<{ id: string }>;
}

/**
 * Opens, extends and closes a store's working shift, and answers what the
 * shift means right now.
 *
 * ASAP orders need an open shift *and* the working hours — or an extension
 * past them (`PUT /kds/shift/extend`); pre-orders for later are taken with
 * the shift closed (docs/kitchen-policy.md). "Finish work" is refused while
 * orders due soon wait for «Принять» (409 `SHIFT_HAS_UNACCEPTED_ORDERS`),
 * and the schedule closes a shift nobody finished after the hours
 * (ShiftScheduleService). Open and close are idempotent, so two tablets
 * tapping the same button do not fight.
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
    private readonly rules: StoreAvailabilityService,
  ) {}

  async current(storeId: string, now: Date = new Date()): Promise<StoreShiftDto> {
    const store = await this.findStore(storeId);
    const [last, view] = await Promise.all([
      this.prisma.storeShift.findFirst({
        where: { storeId },
        orderBy: { openedAt: 'desc' },
        include: WITH_NAMES,
      }),
      this.rules.forStore(storeId, now),
    ]);
    return toDto(storeId, last, isBusy(store), view);
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
   * "Finish work". Refused with 409 `SHIFT_HAS_UNACCEPTED_ORDERS {count}`
   * while orders due within 30 minutes wait for «Принять»: closing would
   * leave customers on their way with an order nobody took on. Orders being
   * made or ready stay on the board; pre-orders for later come to the board
   * of the next shift.
   *
   * A store left marked busy is switched back to normal: the marker is
   * about the rush in front of the counter now, and tomorrow's customers
   * should not see yesterday's.
   */
  async close(storeId: string, userId: string, now: Date = new Date()): Promise<StoreShiftDto> {
    const store = await this.findStore(storeId);
    const summary = await this.closeSummary(storeId, now);
    if (summary.awaitingAcceptance > 0) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'SHIFT_HAS_UNACCEPTED_ORDERS',
        message: `${summary.awaitingAcceptance} order(s) due soon are not accepted yet; accept or reject them first`,
        count: summary.awaitingAcceptance,
      } satisfies ShiftHasUnacceptedOrdersBody);
    }
    await this.prisma.storeShift.updateMany({
      where: { storeId, closedAt: null },
      data: { closedAt: now, closedById: userId },
    });
    await this.clearBusy(storeId, store.status);
    return this.announce(storeId);
  }

  /** What "Finish work" would leave behind, for the dialog that asks before it. */
  async closeSummary(storeId: string, now: Date = new Date()): Promise<ShiftCloseSummary> {
    return summarizeForClose(await this.openOrders(storeId), now);
  }

  /**
   * «Продлить на 30 мин / 1 ч»: the kitchen takes ASAP orders past the
   * working hours. The extension runs from the later of the closing time,
   * the current extension and now, and never reaches more than four hours
   * past the closing it extends (for a shift opened outside the hours, four
   * hours from now). 409 `SHIFT_NOT_OPEN` without a shift,
   * `SHIFT_EXTENSION_NOT_NEEDED` for a store open around the clock,
   * `SHIFT_EXTENSION_LIMIT` once the cap is reached.
   */
  async extend(storeId: string, minutes: ShiftExtendMinutes, now: Date = new Date()): Promise<StoreShiftDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        timezone: true,
        workingHours: { select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } },
        shifts: { where: { closedAt: null }, select: { id: true, openedAt: true, extendedUntil: true }, take: 1 },
      },
    });
    if (!store) throw new NotFoundException('Store not found');
    const shift = store.shifts[0];
    if (!shift) throw codedConflict('SHIFT_NOT_OPEN', 'Start work first; there is no shift to extend');

    const until = extensionTarget(hoursAround(store.workingHours, store.timezone, now), shift, minutes, now);
    if (until === 'NOT_NEEDED') {
      throw codedConflict(
        'SHIFT_EXTENSION_NOT_NEEDED',
        'The store is open around the clock; there is nothing to extend',
      );
    }
    if (until === 'LIMIT') {
      throw codedConflict('SHIFT_EXTENSION_LIMIT', 'The shift is already extended as far as it can be');
    }
    await this.prisma.storeShift.updateMany({
      where: { id: shift.id, closedAt: null },
      data: { extendedUntil: until },
    });
    return this.announce(storeId);
  }

  /**
   * The schedule closes a shift nobody finished: outside the hours, no
   * extension running, the next window not opening within the hour,
   * `AUTO_CLOSE_GRACE_MINUTES` past the end of the last window or extension,
   * and no order due within 30 minutes still waiting or being made. Ready
   * orders stay on the board. Closed with no person and marked as closed by
   * the schedule. Returns whether it closed the shift.
   */
  async closeBySchedule(storeId: string, graceSeconds: number, now: Date = new Date()): Promise<boolean> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        status: true,
        timezone: true,
        workingHours: { select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } },
        shifts: { where: { closedAt: null }, select: { id: true, openedAt: true, extendedUntil: true }, take: 1 },
      },
    });
    const shift = store?.shifts[0];
    if (!store || !shift) return false;
    if (!autoCloseDue(hoursAround(store.workingHours, store.timezone, now), shift, graceSeconds, now)) return false;
    if (keepsShiftOpen(await this.openOrders(storeId), now)) return false;

    const closed = await this.prisma.storeShift.updateMany({
      where: { id: shift.id, closedAt: null },
      data: { closedAt: now, closedById: null, closedAutomatically: true },
    });
    if (closed.count === 0) return false;
    this.logger.log(`Shift of store ${storeId} closed by the schedule`);
    await this.clearBusy(storeId, store.status);
    await this.announce(storeId);
    return true;
  }

  /**
   * The kitchen's «Загружены» switch: on sets the store's status to
   * OVERLOADED, off back to OPEN. That is the status the owner sees in
   * «Точки» and can also set in the store editor, and the storefronts show
   * as «Загружена» with a full (red) load meter. Orders keep coming; the
   * ETA is still the queue-based one, plus `BUSY_EXTRA_WAIT_SECONDS` while
   * busy (KitchenLoadService). A store switched off (CLOSED) is not
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
  async announce(storeId: string): Promise<StoreShiftDto> {
    const shift = await this.current(storeId);
    this.realtime.emitKdsShiftChanged({ storeId, shift });
    await this.availability.announce(storeId);
    return shift;
  }

  private async clearBusy(storeId: string, status: StoreStatus): Promise<void> {
    if (status !== StoreStatus.OVERLOADED) return;
    await this.prisma.store.updateMany({
      where: { id: storeId, status: StoreStatus.OVERLOADED },
      data: { status: StoreStatus.OPEN },
    });
    await this.announceLoad(storeId);
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
      const queue = await this.kitchen.queueWaitSeconds({ id: storeId, ...store });
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

  private openOrders(storeId: string): Promise<ShiftOrder[]> {
    return this.prisma.order.findMany({
      where: { storeId, status: { in: OPEN_ORDER_STATUSES } },
      select: {
        status: true,
        pickupAt: true,
        kitchenVisibleAt: true,
        payments: {
          where: { provider: { in: [...CARD_PROVIDERS] }, status: { in: ['REQUIRES_ACTION', 'SUCCEEDED'] } },
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  private async findStore(storeId: string): Promise<{ id: string; status: StoreStatus }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, status: true } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }
}

/**
 * On the kitchen board: started its acceptance clock, or paid, or (for an
 * order from before the clock existed) carrying a card payment.
 */
function onBoard(order: ShiftOrder): boolean {
  return order.kitchenVisibleAt !== null || order.status !== OrderStatus.CREATED || order.payments.length > 0;
}

function dueSoon(order: ShiftOrder, now: Date): boolean {
  return order.pickupAt.getTime() <= now.getTime() + DUE_SOON_SECONDS * 1000;
}

/** Sorts a store's open orders into what the "Finish work" dialog shows. */
export function summarizeForClose(orders: readonly ShiftOrder[], now: Date): ShiftCloseSummary {
  const summary: ShiftCloseSummary = { awaitingAcceptance: 0, inProgress: 0, ready: 0, later: 0 };
  for (const order of orders) {
    if (order.status === OrderStatus.READY) summary.ready += 1;
    else if (order.status === OrderStatus.IN_PROGRESS) summary.inProgress += 1;
    else if (!onBoard(order)) continue;
    else if (!dueSoon(order, now)) summary.later += 1;
    else if (order.status === OrderStatus.ACCEPTED) summary.inProgress += 1;
    else summary.awaitingAcceptance += 1;
  }
  return summary;
}

/** Orders that keep a shift from closing by itself: being made, or due within 30 minutes and not ready. */
export function keepsShiftOpen(orders: readonly ShiftOrder[], now: Date): boolean {
  return orders.some(
    (o) => o.status === OrderStatus.IN_PROGRESS || (o.status !== OrderStatus.READY && onBoard(o) && dueSoon(o, now)),
  );
}

/**
 * The hours side of the auto-close rule: outside the hours, no extension
 * running, the next window more than an hour away, and the grace past the
 * last closing (or extension, or the opening of a shift started after
 * hours) gone by.
 */
export function autoCloseDue(
  hours: HoursAround,
  shift: { openedAt: Date; extendedUntil: Date | null },
  graceSeconds: number,
  now: Date,
): boolean {
  if (hours.alwaysOpen || withinHours(hours, now)) return false;
  if (shift.extendedUntil && shift.extendedUntil > now) return false;
  const next = openingAfter(hours, now);
  if (next && next.getTime() - now.getTime() <= AUTO_CLOSE_NEXT_OPENING_SECONDS * 1000) return false;
  const ended = Math.max(
    closingBefore(hours, now)?.getTime() ?? 0,
    shift.extendedUntil?.getTime() ?? 0,
    shift.openedAt.getTime(),
  );
  return now.getTime() >= ended + graceSeconds * 1000;
}

/**
 * Where an extension of `minutes` ends: from the later of the closing
 * time, the current extension and now, capped at four hours past the
 * closing it extends — the current window's end within the hours, the
 * last window's end for a shift that was open then, else now.
 */
export function extensionTarget(
  hours: HoursAround,
  shift: { openedAt: Date; extendedUntil: Date | null },
  minutes: number,
  now: Date,
): Date | 'NOT_NEEDED' | 'LIMIT' {
  if (hours.alwaysOpen) return 'NOT_NEEDED';
  const inHours = withinHours(hours, now);
  const closes = inHours ? closingAfter(hours, now) : null;
  if (inHours && !closes) return 'NOT_NEEDED';

  const current = shift.extendedUntil?.getTime() ?? 0;
  const from = Math.max(closes?.getTime() ?? 0, current, now.getTime());
  const lastClosing = closingBefore(hours, now);
  const capBase =
    closes?.getTime() ?? (lastClosing && shift.openedAt < lastClosing ? lastClosing.getTime() : now.getTime());
  const until = Math.min(from + minutes * 60_000, capBase + MAX_EXTENSION_SECONDS * 1000);
  if (until <= Math.max(current, now.getTime())) return 'LIMIT';
  return new Date(until);
}

type ShiftRow = Prisma.StoreShiftGetPayload<{ include: typeof WITH_NAMES }>;

function personName(user: { name: string | null; email: string | null } | null): string | null {
  return user?.name?.trim() || user?.email || null;
}

export function toDto(
  storeId: string,
  shift: ShiftRow | null,
  busy = false,
  view: StoreAvailabilityView | null = null,
): StoreShiftDto {
  const open = shift != null && shift.closedAt == null;
  return {
    storeId,
    open,
    openedAt: shift?.openedAt.toISOString() ?? null,
    openedByName: personName(shift?.openedBy ?? null),
    closedAt: shift?.closedAt?.toISOString() ?? null,
    closedByName: personName(shift?.closedBy ?? null),
    busy,
    extendedUntil: open ? (view?.extendedUntil?.toISOString() ?? null) : null,
    closesAt: view?.closesAt?.toISOString() ?? null,
    opensAt: view?.opensAt?.toISOString() ?? null,
    asapOpen: view?.openNow ?? false,
    asapBlockedReason: view?.asapBlockedReason ?? null,
    closedAutomatically: !open && shift?.closedAutomatically === true,
  };
}
