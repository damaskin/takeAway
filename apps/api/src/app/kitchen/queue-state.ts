import { OrderStatus, type Prisma } from '@prisma/client';
import {
  type QueueItem,
  type QueueOrder,
  type QueueSettings,
  type QueueState,
  type TimeRange,
  readOrderItemSnapshot,
} from '@takeaway/utils';

import { acceptWindowSeconds } from './kitchen-timeline';
import { hoursAround, type WorkingHour } from './opening-hours';

/**
 * The queue calculator's input (`QueueState`, docs/queue-policy.md 2.2) from
 * database rows: the store's settings and hours, and the orders that still
 * owe its kitchen work. Pure — {@link QueueStateService} reads the rows.
 */

/** Orders that still owe the kitchen work; READY and later, cancelled and expired ones are done with. */
export const QUEUE_STATUSES: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.PAID,
  OrderStatus.ACCEPTED,
  OrderStatus.IN_PROGRESS,
];

/**
 * An order due longer ago than this is one nobody pressed «Готово» for —
 * the same two hours after which the SLA stops pinging about it. Left in,
 * a forgotten ticket from the morning would hold a station for the rest of
 * the day.
 */
export const QUEUE_STALE_SECONDS = 2 * 60 * 60;

/** N when a store row does not say (the column's default): «Загрузка» adds 10 minutes. */
export const DEFAULT_LOAD_EXTRA_SECONDS = 10 * 60;

/** The order columns the state is built from. */
export const QUEUE_ORDER_SELECT = {
  id: true,
  userId: true,
  storeId: true,
  status: true,
  pickupMode: true,
  pickupAt: true,
  readyEstimateAt: true,
  createdAt: true,
  kitchenVisibleAt: true,
  acceptedAt: true,
  startedAt: true,
  placedUnderLoad: true,
  items: { select: { quantity: true, prepSeconds: true, prepParallel: true, productSnapshot: true } },
} as const satisfies Prisma.OrderSelect;

export type QueueOrderRow = Prisma.OrderGetPayload<{ select: typeof QUEUE_ORDER_SELECT }>;

/** What a store contributes: its settings, hours, extension, load and pause. */
export interface QueueStoreFacts {
  id: string;
  status: string;
  timezone: string;
  /** A, «Время для принятия заказа». */
  baseEtaSeconds: number;
  /** C, «Позиций готовится одновременно». */
  kitchenParallelism: number;
  /** N, «Загрузка: +N мин»; absent reads as the default 10 minutes. */
  loadExtraSeconds?: number | null;
  workingHours: readonly WorkingHour[];
  /** The open shift, if any, with the kitchen's extension of the closing. */
  shifts: ReadonlyArray<{ extendedUntil: Date | null }>;
  pausedUntil?: Date | null;
}

/** The store columns {@link QueueStoreFacts} reads; spread into a Prisma `select`. */
export const QUEUE_STORE_SELECT = {
  id: true,
  status: true,
  timezone: true,
  baseEtaSeconds: true,
  kitchenParallelism: true,
  loadExtraSeconds: true,
  pausedUntil: true,
  workingHours: { select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } },
  shifts: { where: { closedAt: null }, select: { extendedUntil: true }, take: 1 },
} as const satisfies Prisma.StoreSelect;

/** A product's B and «Готовится параллельно» as they are now. */
export interface QueueProductFacts {
  prepTimeSeconds: number;
  prepParallel: boolean;
}

/**
 * Which orders the queue holds (2.2): every order not finished yet whose
 * kitchen it is — an ASAP order once its payment landed (or with nothing to
 * pay), since it joins the queue then; a pre-order also while its customer
 * is paying, so the time they picked stays theirs, as a 15-minute slot did.
 * Orders due more than {@link QUEUE_STALE_SECONDS} ago are left out.
 */
export function queueOrdersWhere(storeIds: readonly string[], now: Date): Prisma.OrderWhereInput {
  const stale = new Date(now.getTime() - QUEUE_STALE_SECONDS * 1000);
  return {
    storeId: { in: [...storeIds] },
    status: { in: QUEUE_STATUSES },
    AND: [
      {
        OR: [
          { kitchenVisibleAt: { not: null } },
          { status: { not: OrderStatus.CREATED } },
          { pickupMode: 'SCHEDULED' },
        ],
      },
      { OR: [{ pickupAt: { gte: stale } }, { readyEstimateAt: { gte: stale } }] },
    ],
  };
}

/** The settings A, N and C of a store. A follows the acceptance rules (whole minutes, 10 when unset). */
export function queueSettings(store: QueueStoreFacts): QueueSettings {
  return {
    acceptSeconds: acceptWindowSeconds(store.baseEtaSeconds),
    loadExtraSeconds: loadExtraSecondsOf(store),
    stations: Math.max(1, Math.floor(store.kitchenParallelism) || 1),
  };
}

/** N in seconds: the store's own, whole and not negative; the default when unset. */
export function loadExtraSecondsOf(store: { loadExtraSeconds?: number | null }): number {
  const value = store.loadExtraSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : DEFAULT_LOAD_EXTRA_SECONDS;
}

/**
 * Products to read for lines placed before their B was snapshotted (the
 * flag was off then): their ids from the line snapshots.
 */
export function productIdsToLookUp(rows: readonly QueueOrderRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const item of row.items) {
      if (item.prepSeconds !== null && item.prepParallel !== null) continue;
      const id = readOrderItemSnapshot(item.productSnapshot).id;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * The order's positions: B and the flag snapshotted on the line, else the
 * product as it is now, else the line's own preparation time (a product
 * deleted since), else nothing.
 */
export function queueItemsOf(
  row: Pick<QueueOrderRow, 'items'>,
  products: ReadonlyMap<string, QueueProductFacts>,
): QueueItem[] {
  return row.items.map((item) => {
    if (item.prepSeconds !== null && item.prepParallel !== null) {
      return { prepSeconds: item.prepSeconds, parallel: item.prepParallel, quantity: item.quantity };
    }
    const snapshot = readOrderItemSnapshot(item.productSnapshot);
    const product = products.get(snapshot.id);
    return {
      prepSeconds: item.prepSeconds ?? product?.prepTimeSeconds ?? snapshot.unitPrepSeconds,
      parallel: item.prepParallel ?? product?.prepParallel ?? false,
      quantity: item.quantity,
    };
  });
}

/**
 * One order as the calculator sees it. T is when it became the kitchen's
 * (`kitchenVisibleAt`; the creation for orders from before it existed),
 * a pre-order is ready at its `pickupAt`, and an order IN_PROGRESS with no
 * start on record counts as started when it was accepted.
 */
export function toQueueOrder(
  row: QueueOrderRow,
  seq: number,
  products: ReadonlyMap<string, QueueProductFacts>,
): QueueOrder {
  const placedAt = (row.kitchenVisibleAt ?? row.createdAt).getTime();
  const started =
    row.startedAt ?? (row.status === OrderStatus.IN_PROGRESS ? (row.acceptedAt ?? new Date(placedAt)) : null);
  return {
    id: row.id,
    placedAt,
    seq,
    placedUnderLoad: row.placedUnderLoad,
    acceptedAt: row.acceptedAt?.getTime() ?? null,
    startedAt: started?.getTime() ?? null,
    readyBy: row.pickupMode === 'SCHEDULED' ? row.pickupAt.getTime() : null,
    items: queueItemsOf(row, products),
  };
}

/**
 * The working hours as merged UTC windows from a day back to two ahead —
 * null for a store open around the clock. A running extension stretches
 * the window it extends (the one open now, or the one that closed last) to
 * its end.
 */
export function queueHours(store: QueueStoreFacts, now: Date): TimeRange[] | null {
  const around = hoursAround(store.workingHours, store.timezone, now, { backDays: 1, aheadDays: 2 });
  if (around.alwaysOpen) return null;
  const t = now.getTime();
  const windows = around.windows.map((w) => ({ from: w.start.getTime(), to: w.end.getTime() }));
  const extendedUntil = store.shifts[0]?.extendedUntil?.getTime() ?? null;
  if (extendedUntil === null || extendedUntil <= t) return windows;

  const current = windows.find((w) => w.from <= t && t < w.to) ?? windows.filter((w) => w.to <= t).at(-1);
  if (current) current.to = Math.max(current.to, extendedUntil);
  else windows.push({ from: t, to: extendedUntil });
  return mergeRanges(windows);
}

/** Sorted, overlapping and touching ranges joined. */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * The state the calculator answers from: the store's settings, its orders
 * (FIFO by T, then by creation), its hours, «Загрузка» (OVERLOADED) and
 * «Перерыв» (`pausedUntil` in the future). Rows of other stores are left out.
 */
export function buildQueueState(
  store: QueueStoreFacts,
  rows: readonly QueueOrderRow[],
  products: ReadonlyMap<string, QueueProductFacts>,
  now: Date,
): QueueState {
  const own = rows
    .filter((row) => row.storeId === store.id)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return {
    settings: queueSettings(store),
    orders: own.map((row, seq) => toQueueOrder(row, seq, products)),
    hours: queueHours(store, now),
    loadOn: store.status === 'OVERLOADED',
    paused: !!store.pausedUntil && store.pausedUntil > now,
  };
}

/**
 * The state for pre-orders (owner decisions until the manager says
 * otherwise, docs/queue-policy.md 2.7): «Перерыв» does not close them — it
 * is a gap in the hours, so a basket can be booked whose cooking starts
 * after the pause ends; and a window nobody is on shift for yet starts
 * `openingLeadSeconds` later (`PREORDER_OPENING_LEAD_MINUTES`): whoever
 * opens needs a moment before the first handover.
 */
export function preorderState(
  state: QueueState,
  store: Pick<QueueStoreFacts, 'shifts' | 'pausedUntil'>,
  now: Date,
  openingLeadSeconds: number,
): QueueState {
  const t = now.getTime();
  const shiftOpen = store.shifts.length > 0;
  const pausedUntil = store.pausedUntil && store.pausedUntil > now ? store.pausedUntil.getTime() : null;
  const lead = Math.max(0, openingLeadSeconds) * 1000;

  let hours: TimeRange[] | null;
  if (!state.hours) {
    hours = pausedUntil === null ? null : [{ from: pausedUntil, to: t + 3 * 24 * 60 * 60 * 1000 }];
  } else {
    hours = state.hours
      .map((w) => ({ from: !shiftOpen || w.from > t ? w.from + lead : w.from, to: w.to }))
      .map((w) => (pausedUntil === null ? w : { from: Math.max(w.from, pausedUntil), to: w.to }))
      .filter((w) => w.to > w.from);
  }
  return { ...state, hours, paused: false };
}
