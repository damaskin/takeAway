import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AsapBlockedReason } from '@takeaway/shared-types';
import {
  type AsapQuote,
  PREORDER_HORIZON_MS,
  type QueueItem,
  type QueueSchedule,
  type QueueState,
  type ReadyWindow,
  isPreorderTimeAvailable,
  preorderWindows,
  quoteAsap,
  scheduleQueue,
} from '@takeaway/utils';

import { closingBoundary } from '../catalog/store-availability';
import { checkoutError } from '../common/http/checkout-error';
import { FeatureFlagsService } from '../config/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenLoadService, PREORDER_HORIZON_HOURS, type PickupSlot } from './kitchen-load.service';
import { QUEUE_STORE_SELECT, type QueueOrderRow, type QueueStoreFacts, preorderState } from './queue-state';
import { type LoadedQueue, type QueueDb, QueueStateService } from './queue-state.service';
import { SLOT_MS, ceilToSlot } from './slots';

const MINUTE_MS = 60_000;

/** A product's B and «Готовится параллельно», as the cart and the order path read them. */
export interface QueueProduct {
  id: string;
  prepTimeSeconds: number;
  prepParallel: boolean;
}

/** The cart placed now at the end of the queue. */
export interface BasketQuote {
  /** G, rounded up to the whole second. */
  readyAt: Date;
  /** Seconds from now to G — the cart's `etaSeconds`. */
  etaSeconds: number;
  /** The calculator's own answer: hours, «Перерыв», the closing. */
  quote: AsapQuote;
}

/** When the board's ticket starts and is ready (O and G). */
export interface OrderPlan {
  startAt: number;
  readyAt: number;
}

/** What the ASAP verdict reads off the store's availability (`StoreAvailabilityView`). */
export interface AsapStoreView {
  openNow: boolean;
  asapBlockedReason: AsapBlockedReason | null;
  closesAt: Date | null;
  extendedUntil: Date | null;
}

/**
 * Whether an order for now is taken, from the store's availability (hours,
 * «Перерыв», the shift — for a typical order) and this basket's own ready
 * time G: not after the closing (`CLOSING_SOON`, the last order for now is
 * one the kitchen makes before it) and not further than the longest ASAP
 * wait (`QUEUE_FULL`, 45 minutes by default — owner decision 2026-11-09,
 * kept from the old rules). Null when it is taken. The store's own reason is
 * null for a store switched off; `available` is false all the same.
 */
export function asapVerdict(
  view: AsapStoreView,
  readyAt: number,
  now: number,
  maxAsapWaitSeconds: number,
): { available: boolean; reason: AsapBlockedReason | null } {
  if (!view.openNow) return { available: false, reason: view.asapBlockedReason };
  const boundary = closingBoundary(view);
  if (boundary && readyAt > boundary.getTime()) return { available: false, reason: 'CLOSING_SOON' };
  if (readyAt - now > maxAsapWaitSeconds * 1000) return { available: false, reason: 'QUEUE_FULL' };
  return { available: true, reason: null };
}

/** The calculator's positions for lines of products: B is the product's own time, the options left out. */
export function basketOf(
  lines: readonly { productId: string; quantity: number }[],
  products: ReadonlyMap<string, Pick<QueueProduct, 'prepTimeSeconds' | 'prepParallel'>>,
): QueueItem[] {
  return lines.map((line) => {
    const product = products.get(line.productId);
    return {
      prepSeconds: product?.prepTimeSeconds ?? 0,
      parallel: product?.prepParallel ?? false,
      quantity: line.quantity,
    };
  });
}

/** Whether `at` is one of the minutes of the windows (both ends included). */
function inWindows(windows: readonly ReadyWindow[], at: number): boolean {
  return windows.some((w) => w.from <= at && at <= w.to);
}

/**
 * The order-queue policy wired to the database (docs/queue-policy.md,
 * section 2), behind `QUEUE_POLICY_ENABLED`: the ETA of a cart, the store's
 * «N мин», «как можно скорее», the pre-order windows, the booking check
 * under a per-store lock and the kitchen board's times. Callers ask
 * {@link enabled} and keep the kitchen-load rules when it is off.
 */
@Injectable()
export class QueuePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly states: QueueStateService,
    private readonly kitchen: KitchenLoadService,
    private readonly flags: FeatureFlagsService,
  ) {}

  get enabled(): boolean {
    return this.flags.queuePolicyEnabled;
  }

  /** `MAX_ASAP_WAIT_SECONDS`: past it an order for now is refused with `QUEUE_FULL`. */
  get maxAsapWaitSeconds(): number {
    return this.kitchen.policy.maxAsapWaitSeconds;
  }

  /** The positions of cart lines, their products read as they are now. */
  async basket(
    lines: readonly { productId: string; quantity: number }[],
    db: QueueDb = this.prisma,
  ): Promise<QueueItem[]> {
    if (lines.length === 0) return [];
    const products = await db.product.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.productId))] } },
      select: { id: true, prepTimeSeconds: true, prepParallel: true },
    });
    return basketOf(lines, new Map(products.map((p) => [p.id, p])));
  }

  /** The basket placed now at the end of the store's queue. */
  async quoteBasket(
    storeId: string,
    items: readonly QueueItem[],
    now: Date = new Date(),
    db: QueueDb = this.prisma,
  ): Promise<BasketQuote> {
    const { state } = await this.states.loadOne(storeId, now, db);
    return toBasketQuote(quoteAsap(state, items, now.getTime()), now);
  }

  /**
   * Every store's quote for one typical position — the median B of what it
   * sells (`typicalPrepByStore`, kept a few minutes) — for the store's «N мин»
   * (`currentEtaSeconds`) and whether it takes an order for now.
   */
  async typicalQuotes(stores: readonly QueueStoreFacts[], now: Date = new Date()): Promise<Map<string, AsapQuote>> {
    const quotes = new Map<string, AsapQuote>();
    if (stores.length === 0) return quotes;
    const [loaded, typical] = await Promise.all([
      this.states.load(stores, now),
      this.kitchen.typicalPrepByStore(
        stores.map((s) => s.id),
        now,
      ),
    ]);
    for (const store of stores) {
      const queue = loaded.get(store.id);
      if (!queue) continue;
      quotes.set(store.id, quoteAsap(queue.state, [{ prepSeconds: typical.get(store.id) ?? 0 }], now.getTime()));
    }
    return quotes;
  }

  /**
   * `GET /stores/:id/ready-windows`: the runs of whole minutes the basket
   * can be pre-ordered for over the next 24 hours.
   */
  async readyWindows(storeId: string, items: readonly QueueItem[], now: Date = new Date()): Promise<ReadyWindow[]> {
    const queue = await this.states.loadOne(storeId, now);
    return preorderWindows(this.forPreorders(queue, now), items, now.getTime());
  }

  /**
   * `GET /stores/:id/pickup-slots` for the app builds that predate the
   * windows: the 15-minute slot starts of the next 24 hours, those the time
   * rules close (too soon, outside the hours, «Перерыв», the opening lead)
   * left out, the others `available` when the basket can be ready then.
   */
  async pickupSlots(storeId: string, items: readonly QueueItem[], now: Date = new Date()): Promise<PickupSlot[]> {
    const queue = await this.states.loadOne(storeId, now);
    const state = this.forPreorders(queue, now);
    const t = now.getTime();
    const free = preorderWindows(state, items, t);
    const open = preorderWindows({ ...state, orders: [] }, items, t);

    const start = ceilToSlot(now).getTime();
    const end = t + PREORDER_HORIZON_MS;
    const loads = (await this.kitchen.slotLoadByStore([storeId], new Date(start), new Date(end + SLOT_MS))).get(
      storeId,
    );
    const slots: PickupSlot[] = [];
    for (let at = start; at <= end; at += SLOT_MS) {
      if (!inWindows(open, at)) continue;
      slots.push({
        startsAt: new Date(at),
        endsAt: new Date(at + SLOT_MS),
        taken: loads?.get(at)?.count ?? 0,
        available: inWindows(free, at),
      });
    }
    return slots;
  }

  /**
   * Refuses a pre-order time the basket cannot be ready at: further than 24
   * hours or sooner than t + A + N·L + its cooking
   * (`PICKUP_TIME_OUT_OF_RANGE`, with the soonest minute it could be),
   * outside the hours, in «Перерыв» or the opening lead
   * (`STORE_CLOSED_AT_TIME`), or a time the queue and the other pre-orders
   * leave no station time for (`PICKUP_SLOT_FULL`). The order path calls it
   * inside the order's transaction after {@link lockStore}, so two
   * customers cannot both book the last free stretch.
   */
  async assertPreorderTime(
    storeId: string,
    items: readonly QueueItem[],
    pickupAt: Date,
    now: Date = new Date(),
    db: QueueDb = this.prisma,
  ): Promise<void> {
    const queue = await this.states.loadOne(storeId, now, db);
    const state = this.forPreorders(queue, now);
    const t = now.getTime();
    const at = pickupAt.getTime();
    const outOfRange = () => {
      const minMinutes = soonestMinutes(state, items, t);
      return checkoutError(
        'PICKUP_TIME_OUT_OF_RANGE',
        `Scheduled pickup must be between ${minMinutes} min and ${PREORDER_HORIZON_HOURS} h from now`,
        { minMinutes, maxHours: PREORDER_HORIZON_HOURS },
      );
    };
    if (at <= t || at > t + PREORDER_HORIZON_MS) throw outOfRange();
    if (isPreorderTimeAvailable(state, items, at, t)) return;

    const empty: QueueState = { ...state, orders: [] };
    if (isPreorderTimeAvailable(empty, items, at, t)) {
      throw checkoutError('PICKUP_SLOT_FULL', 'That pickup time has just filled up — please choose another time');
    }
    const noLead: QueueState = { ...empty, settings: { ...empty.settings, acceptSeconds: 0, loadExtraSeconds: 0 } };
    if (isPreorderTimeAvailable(noLead, items, at, t)) throw outOfRange();
    throw checkoutError('STORE_CLOSED_AT_TIME', 'The store does not hand orders over at that time');
  }

  /**
   * Holds the store's queue for the rest of the transaction: the order path
   * checks and books under it, so the second of two simultaneous orders
   * sees the first.
   */
  async lockStore(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, storeId: string): Promise<void> {
    const key = `queue-policy:${storeId}`;
    await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS l`;
  }

  /** The store's queue laid out now, with the rows it came from. */
  async schedule(storeId: string, now: Date = new Date()): Promise<{ schedule: QueueSchedule; rows: QueueOrderRow[] }> {
    const queue = await this.states.loadOne(storeId, now);
    return { schedule: scheduleQueue(queue.state, now.getTime()), rows: queue.rows };
  }

  /** O and G of every order in the queues of the stores, by order id (the board, the start reminder). */
  async plans(storeIds: readonly string[], now: Date = new Date()): Promise<Map<string, OrderPlan>> {
    const plans = new Map<string, OrderPlan>();
    const ids = [...new Set(storeIds)];
    if (ids.length === 0) return plans;
    const stores = await this.prisma.store.findMany({
      where: { id: { in: ids } },
      select: QUEUE_STORE_SELECT,
    });
    const loaded = await this.states.load(stores, now);
    for (const queue of loaded.values()) {
      for (const planned of scheduleQueue(queue.state, now.getTime()).orders) {
        plans.set(planned.id, { startAt: planned.startAt, readyAt: planned.readyAt });
      }
    }
    return plans;
  }

  private forPreorders(queue: LoadedQueue, now: Date): QueueState {
    return preorderState(queue.state, queue.store, now, this.kitchen.policy.preorderOpeningLeadSeconds);
  }
}

/** G as the cart and the order carry it: whole seconds, rounded up, so the shown minute is never early. */
export function toBasketQuote(quote: AsapQuote, now: Date): BasketQuote {
  const readyAt = Math.ceil(quote.readyAt / 1000) * 1000;
  return {
    readyAt: new Date(readyAt),
    etaSeconds: Math.max(0, Math.round((readyAt - now.getTime()) / 1000)),
    quote,
  };
}

/**
 * The soonest whole minute from now the basket could be ready at with an
 * empty queue and no hours to keep: A + N·L and its own cooking. For the
 * `PICKUP_TIME_OUT_OF_RANGE` wording.
 */
function soonestMinutes(state: QueueState, items: readonly QueueItem[], now: number): number {
  const open: QueueState = { ...state, orders: [], hours: null, blocked: [] };
  for (let minutes = 1; minutes <= PREORDER_HORIZON_HOURS * 60; minutes++) {
    if (isPreorderTimeAvailable(open, items, now + minutes * MINUTE_MS, now)) return minutes;
  }
  return PREORDER_HORIZON_HOURS * 60;
}
