import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';

import { type AvailabilityPolicy, isBusy, slotBlocker } from '../catalog/store-availability';
import { checkoutError } from '../common/http/checkout-error';
import { PrismaService } from '../prisma/prisma.service';
import type { AcceptancePolicy } from './kitchen-timeline';
import { hoursAround, type WorkingHour } from './opening-hours';
import { SLOT_MS, type SlotLoad, ceilToSlot, floorToSlot, slotFits } from './slots';

export { SLOT_MINUTES, ceilToSlot, floorToSlot } from './slots';

/**
 * Orders that still owe the kitchen work. CREATED and PAID are queued but
 * untouched; ACCEPTED and IN_PROGRESS are being worked. READY is excluded —
 * it is made, it is on the shelf, it costs nobody anything.
 */
const QUEUEING_STATUSES: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.PAID,
  OrderStatus.ACCEPTED,
  OrderStatus.IN_PROGRESS,
];

/** Statuses that hold a slot: everything but an order that will never be handed over. */
const LIVE_ORDER = { notIn: [OrderStatus.CANCELLED, OrderStatus.EXPIRED] };

/**
 * Orders due within this long are the kitchen's queue right now; a pre-order
 * for later does not hold up an ASAP order placed now. Every IN_PROGRESS
 * order counts whatever its time.
 */
export const DUE_SOON_SECONDS = 30 * 60;

/** A pre-order may be booked this far ahead, and checkout offers slots for it. */
export const PREORDER_HORIZON_HOURS = 24;
/** ...and no sooner than this. */
export const MIN_SCHEDULED_LEAD_MINUTES = 10;

/** {@link KitchenLoadService.policy}: `MAX_ASAP_WAIT_SECONDS` when unset. */
export const DEFAULT_MAX_ASAP_WAIT_SECONDS = 45 * 60;
/** {@link KitchenLoadService.policy}: `PREORDER_OPENING_LEAD_MINUTES` when unset. */
export const DEFAULT_PREORDER_OPENING_LEAD_MINUTES = 15;
/** {@link KitchenLoadService.acceptance}: `ORDER_ACCEPT_ALERT_SECONDS` when unset. */
export const DEFAULT_ORDER_ACCEPT_ALERT_SECONDS = 3 * 60;
/** {@link KitchenLoadService.acceptance}: `ORDER_ACCEPT_TIMEOUT_SECONDS` when unset. */
export const DEFAULT_ORDER_ACCEPT_TIMEOUT_SECONDS = 8 * 60;

/**
 * An order already in progress has, on average, burned half its work by the
 * time we look. Counting it whole would inflate every quote during a rush;
 * ignoring it would understate the wait. Half is the honest middle, and it
 * is cheap — no per-order timing bookkeeping.
 */
const IN_PROGRESS_WORK_FACTOR = 0.5;

/** {@link KitchenLoadService.busyExtraWaitSeconds} when `BUSY_EXTRA_WAIT_SECONDS` is not set. */
export const DEFAULT_BUSY_EXTRA_WAIT_SECONDS = 5 * 60;

/** What the queue wait of a store depends on. */
export interface QueueFacts {
  id: string;
  kitchenParallelism: number;
  /** OVERLOADED — «Загружены» in the kitchen — adds the busy wait. */
  status: string;
}

/** What an ASAP quote depends on: the queue, the fixed overhead and the slot capacity. */
export interface AsapFacts extends QueueFacts {
  baseEtaSeconds: number;
  slotCapacity: number;
}

export interface EtaQuote {
  /** Total seconds from now until handover — the spill into a later slot included. */
  etaSeconds: number;
  /** Of which, waiting for the queue to clear — the busy wait included. */
  queueWaitSeconds: number;
  /** Of which, this order's own preparation. */
  prepSeconds: number;
  /** Fixed store overhead folded in. */
  baseEtaSeconds: number;
  /** When an ASAP order placed now would be handed over. */
  pickupAt: Date;
  /**
   * No slot within `MAX_ASAP_WAIT_SECONDS` has room: an ASAP order cannot be
   * taken now (pre-orders still can). `etaSeconds` is then the bare queue
   * figure, without the spill.
   */
  queueFull: boolean;
}

export interface PickupSlot {
  /** Slot start, UTC. */
  startsAt: Date;
  endsAt: Date;
  /** Orders already promised in this slot. */
  taken: number;
  capacity: number;
  available: boolean;
}

export interface StoreCapacity extends Omit<AsapFacts, 'id'> {
  timezone: string;
  workingHours: WorkingHour[];
  /** The open shift, if any — at most one row. */
  shifts: Array<{ extendedUntil: Date | null }>;
}

/**
 * Works out when an order will actually be ready.
 *
 * The product's whole promise is "come at the time we tell you and it is
 * waiting for you". That only holds if the number we quote reflects the
 * queue the customer is joining, so the wait is derived from the work
 * outstanding at the store rather than read off a field nobody updates:
 *
 *     eta = baseEtaSeconds + outstandingWork / kitchenParallelism + ownPrep
 *           (+ busyExtraWait while the store is marked busy)
 *
 * `outstandingWork` sums `Order.workSeconds` (the whole order's cost to the
 * kitchen) of the orders due within {@link DUE_SOON_SECONDS}, while
 * `ownPrep` uses `prepSeconds` (the longest single item). Those are
 * deliberately different numbers: a four-drink order occupies the bar four
 * times as long as it makes its own customer wait.
 *
 * The orders on the board are not all the kitchen is doing: when staff
 * press «Загружены» (store status OVERLOADED) there is a queue at the
 * counter, a big catering order, a short shift. The quote cannot see that,
 * so while the store is busy its queue part grows by a fixed
 * `BUSY_EXTRA_WAIT_SECONDS` (5 minutes by default).
 *
 * Slots are the other half. A 15-minute window is full once it holds
 * `slotCapacity` handovers or more kitchen work than the kitchen does in
 * 15 minutes (`900 s × kitchenParallelism`). A scheduled order picks a slot
 * with room; an ASAP order spills into the first one with room after its
 * ETA, and is not taken at all when that is more than
 * `MAX_ASAP_WAIT_SECONDS` away — a quote nobody can honour is worse than
 * "only for later".
 */
@Injectable()
export class KitchenLoadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * What «Загружены» adds to the queue wait: `BUSY_EXTRA_WAIT_SECONDS`, a
   * whole number of seconds; 0 turns it off. Unset or unreadable falls back
   * to {@link DEFAULT_BUSY_EXTRA_WAIT_SECONDS}.
   */
  get busyExtraWaitSeconds(): number {
    return this.wholeNumber('BUSY_EXTRA_WAIT_SECONDS', DEFAULT_BUSY_EXTRA_WAIT_SECONDS, 0);
  }

  /** The availability rules' numbers, from the environment. */
  get policy(): AvailabilityPolicy {
    return {
      maxAsapWaitSeconds: this.wholeNumber('MAX_ASAP_WAIT_SECONDS', DEFAULT_MAX_ASAP_WAIT_SECONDS, 1),
      minScheduledLeadSeconds: MIN_SCHEDULED_LEAD_MINUTES * 60,
      preorderHorizonSeconds: PREORDER_HORIZON_HOURS * 60 * 60,
      preorderOpeningLeadSeconds:
        this.wholeNumber('PREORDER_OPENING_LEAD_MINUTES', DEFAULT_PREORDER_OPENING_LEAD_MINUTES, 0) * 60,
    };
  }

  /**
   * How long an order waits for «Принять»: staff and the owner are alerted
   * after `ORDER_ACCEPT_ALERT_SECONDS`, the order is called off after
   * `ORDER_ACCEPT_TIMEOUT_SECONDS` (never sooner than the alert).
   */
  get acceptance(): AcceptancePolicy {
    const acceptAlertSeconds = this.wholeNumber('ORDER_ACCEPT_ALERT_SECONDS', DEFAULT_ORDER_ACCEPT_ALERT_SECONDS, 1);
    const timeout = this.wholeNumber('ORDER_ACCEPT_TIMEOUT_SECONDS', DEFAULT_ORDER_ACCEPT_TIMEOUT_SECONDS, 60);
    return { acceptAlertSeconds, acceptTimeoutSeconds: Math.max(timeout, acceptAlertSeconds) };
  }

  /**
   * Seconds of kitchen work due soon at a store, divided by how many items
   * it makes in parallel — plus the busy wait while the store is marked busy.
   */
  async queueWaitSeconds(store: QueueFacts, now: Date = new Date()): Promise<number> {
    const byStore = await this.queueWaitByStore([store], now);
    return byStore.get(store.id) ?? 0;
  }

  /**
   * Same figure for many stores in one round trip. The storefront lists
   * every nearby store with a live wait, so the per-store version would turn
   * one screen into a query per pin on the map.
   */
  async queueWaitByStore(stores: readonly QueueFacts[], now: Date = new Date()): Promise<Map<string, number>> {
    const waits = new Map<string, number>();
    if (stores.length === 0) return waits;

    const rows = await this.prisma.order.groupBy({
      by: ['storeId', 'status'],
      where: {
        storeId: { in: stores.map((s) => s.id) },
        status: { in: QUEUEING_STATUSES },
        OR: [
          { pickupAt: { lte: new Date(now.getTime() + DUE_SOON_SECONDS * 1000) } },
          { status: OrderStatus.IN_PROGRESS },
        ],
      },
      _sum: { workSeconds: true },
    });

    const work = new Map<string, number>();
    for (const row of rows) {
      const factor = row.status === OrderStatus.IN_PROGRESS ? IN_PROGRESS_WORK_FACTOR : 1;
      work.set(row.storeId, (work.get(row.storeId) ?? 0) + (row._sum.workSeconds ?? 0) * factor);
    }

    const busyExtra = this.busyExtraWaitSeconds;
    for (const store of stores) {
      const queue = Math.round((work.get(store.id) ?? 0) / Math.max(1, store.kitchenParallelism));
      waits.set(store.id, queue + (isBusy(store) ? busyExtra : 0));
    }
    return waits;
  }

  /**
   * The ASAP quote of many stores at once, for an order with no work of its
   * own — the store list's «готово через N мин» and its open-now badge.
   */
  async asapByStore(stores: readonly AsapFacts[], now: Date = new Date()): Promise<Map<string, EtaQuote>> {
    const quotes = new Map<string, EtaQuote>();
    if (stores.length === 0) return quotes;
    const policy = this.policy;
    const [waits, loads] = await Promise.all([
      this.queueWaitByStore(stores, now),
      this.slotLoadByStore(
        stores.map((s) => s.id),
        now,
        new Date(now.getTime() + policy.maxAsapWaitSeconds * 1000 + SLOT_MS),
      ),
    ]);
    for (const store of stores) {
      quotes.set(store.id, asapPlan(store, waits.get(store.id) ?? 0, loads.get(store.id), 0, 0, now, policy));
    }
    return quotes;
  }

  /**
   * Quote an ASAP order: its own preparation (`prepSeconds`, the longest
   * item) and the kitchen time it costs (`workSeconds`, which decides
   * whether a slot still has room) — from the cart being priced, or from
   * the order being created.
   */
  async quote(storeId: string, prepSeconds: number, workSeconds = 0, now: Date = new Date()): Promise<EtaQuote> {
    const store = await this.capacityFor(storeId);
    const facts = { id: storeId, ...store };
    const policy = this.policy;
    const [queueWait, loads] = await Promise.all([
      this.queueWaitSeconds(facts, now),
      this.slotLoadByStore([storeId], now, new Date(now.getTime() + policy.maxAsapWaitSeconds * 1000 + SLOT_MS)),
    ]);
    return asapPlan(facts, queueWait, loads.get(storeId), prepSeconds, workSeconds, now, policy);
  }

  /**
   * The pre-order slots a customer may pick over the next 24 hours. Times
   * that cannot be booked at all — outside the hours, too soon, right at an
   * opening nobody is there for yet — are left out; slots that are full
   * (by count, or by kitchen work with `workSeconds` of the customer's cart
   * added) come back marked unavailable, so checkout can strike them out
   * and the customer understands the store is busy instead of wondering
   * where the times went.
   */
  async pickupSlots(
    storeId: string,
    {
      from = new Date(),
      hours = PREORDER_HORIZON_HOURS,
      workSeconds = 0,
    }: { from?: Date; hours?: number; workSeconds?: number } = {},
  ): Promise<PickupSlot[]> {
    const store = await this.capacityFor(storeId);
    const policy = this.policy;
    const ctx = {
      now: from,
      hours: hoursAround(store.workingHours, store.timezone, from, { backDays: 1, aheadDays: 2 }),
      shiftOpen: store.shifts.length > 0,
      policy,
    };
    const start = ceilToSlot(from);
    const end = new Date(from.getTime() + hours * 60 * 60 * 1000);
    const loads = (await this.slotLoadByStore([storeId], start, new Date(end.getTime() + SLOT_MS))).get(storeId);

    const slots: PickupSlot[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += SLOT_MS) {
      const startsAt = new Date(t);
      if (slotBlocker(startsAt, ctx)) continue;
      const load = loads?.get(t);
      slots.push({
        startsAt,
        endsAt: new Date(t + SLOT_MS),
        taken: load?.count ?? 0,
        capacity: store.slotCapacity,
        available: slotFits(load, store, workSeconds),
      });
    }
    return slots;
  }

  /**
   * Refuse a pre-order time the store cannot take: too soon or too far
   * ahead (`PICKUP_TIME_OUT_OF_RANGE`), outside the hours or right at an
   * opening nobody is there for yet (`STORE_CLOSED_AT_TIME`), or a slot with
   * no room for this order's work (`PICKUP_SLOT_FULL`). Called on the order
   * path, not just the UI one — the checkout screen can be stale by seconds,
   * and two customers can pick the last slot at the same moment.
   */
  async assertScheduledSlot(
    storeId: string,
    pickupAt: Date,
    workSeconds: number,
    now: Date = new Date(),
  ): Promise<void> {
    const store = await this.capacityFor(storeId);
    const policy = this.policy;
    const blocker = slotBlocker(pickupAt, {
      now,
      hours: hoursAround(store.workingHours, store.timezone, now, { backDays: 1, aheadDays: 2 }),
      shiftOpen: store.shifts.length > 0,
      policy,
    });
    if (blocker === 'TOO_SOON' || blocker === 'TOO_FAR') {
      throw checkoutError(
        'PICKUP_TIME_OUT_OF_RANGE',
        `Scheduled pickup must be between ${MIN_SCHEDULED_LEAD_MINUTES} min and ${PREORDER_HORIZON_HOURS} h from now`,
        { minMinutes: MIN_SCHEDULED_LEAD_MINUTES, maxHours: PREORDER_HORIZON_HOURS },
      );
    }
    if (blocker) {
      throw checkoutError('STORE_CLOSED_AT_TIME', 'The store does not hand orders over at that time');
    }

    const slot = floorToSlot(pickupAt);
    const loads = await this.slotLoadByStore([storeId], slot, new Date(slot.getTime() + SLOT_MS));
    if (!slotFits(loads.get(storeId)?.get(slot.getTime()), store, workSeconds)) {
      throw checkoutError('PICKUP_SLOT_FULL', 'That pickup time has just filled up — please choose another slot');
    }
  }

  /**
   * Split a cart or order's items into the two timings the model needs:
   * what the customer waits, and what the kitchen spends.
   */
  timings(items: readonly { quantity: number; unitPrepSeconds: number }[]): {
    prepSeconds: number;
    workSeconds: number;
  } {
    let prepSeconds = 0;
    let workSeconds = 0;
    for (const item of items) {
      prepSeconds = Math.max(prepSeconds, item.unitPrepSeconds);
      workSeconds += item.unitPrepSeconds * item.quantity;
    }
    return { prepSeconds, workSeconds };
  }

  async capacityFor(storeId: string): Promise<StoreCapacity> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        status: true,
        baseEtaSeconds: true,
        kitchenParallelism: true,
        slotCapacity: true,
        timezone: true,
        workingHours: {
          select: { weekday: true, opensAt: true, closesAt: true, isClosed: true },
        },
        shifts: { where: { closedAt: null }, select: { extendedUntil: true }, take: 1 },
      },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  /** Orders and their kitchen work per slot start (epoch ms), per store, inside [from, to). */
  async slotLoadByStore(
    storeIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, Map<number, SlotLoad>>> {
    const byStore = new Map<string, Map<number, SlotLoad>>();
    if (storeIds.length === 0) return byStore;
    const orders = await this.prisma.order.findMany({
      where: {
        storeId: { in: [...storeIds] },
        pickupAt: { gte: floorToSlot(from), lt: to },
        status: LIVE_ORDER,
      },
      select: { storeId: true, pickupAt: true, workSeconds: true },
    });

    for (const { storeId, pickupAt, workSeconds } of orders) {
      const slots = byStore.get(storeId) ?? new Map<number, SlotLoad>();
      byStore.set(storeId, slots);
      const key = floorToSlot(pickupAt).getTime();
      const load = slots.get(key) ?? { count: 0, workSeconds: 0 };
      load.count += 1;
      load.workSeconds += workSeconds;
      slots.set(key, load);
    }
    return byStore;
  }

  /** A whole number from the environment, at least `min`; anything else falls back. */
  private wholeNumber(key: string, fallback: number, min: number): number {
    const raw = this.config.get<string | number>(key);
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    return typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fallback;
  }
}

/**
 * When an ASAP order placed at `now` is handed over: at its ETA if that
 * slot has room, else at the start of the first later slot that has —
 * within `maxAsapWaitSeconds`. Past that the queue is full.
 */
export function asapPlan(
  store: AsapFacts,
  queueWaitSeconds: number,
  loads: ReadonlyMap<number, SlotLoad> | undefined,
  prepSeconds: number,
  workSeconds: number,
  now: Date,
  policy: Pick<AvailabilityPolicy, 'maxAsapWaitSeconds'>,
): EtaQuote {
  const etaSeconds = store.baseEtaSeconds + queueWaitSeconds + prepSeconds;
  const ready = now.getTime() + etaSeconds * 1000;
  const limit = now.getTime() + policy.maxAsapWaitSeconds * 1000;
  const base = { queueWaitSeconds, prepSeconds, baseEtaSeconds: store.baseEtaSeconds };

  for (let slot = floorToSlot(new Date(ready)).getTime(); slot <= limit; slot += SLOT_MS) {
    if (!slotFits(loads?.get(slot), store, workSeconds)) continue;
    const at = Math.max(ready, slot);
    if (at > limit) break;
    return { ...base, etaSeconds: Math.round((at - now.getTime()) / 1000), pickupAt: new Date(at), queueFull: false };
  }
  return { ...base, etaSeconds, pickupAt: new Date(ready), queueFull: true };
}
