import type { AsapBlockedReason } from '@takeaway/shared-types';

/**
 * Inputs and outputs of the order-queue calculator (docs/queue-policy.md,
 * spec «Очередь и время готовности»). Instants are epoch milliseconds (UTC),
 * durations are seconds, as everywhere in the API.
 */

/** A stretch of time `[from, to)`, epoch ms. */
export interface TimeRange {
  from: number;
  to: number;
}

/** What the owner sets per store. None of it is fixed in code. */
export interface QueueSettings {
  /** A — «Время на принятие заказа», seconds. Runs alongside the queue, not on top of it. */
  acceptSeconds: number;
  /** N — what «Загрузка» adds to A for orders placed while it is on, seconds. */
  loadExtraSeconds: number;
  /** C — how many positions are made at once («Позиций готовится одновременно»). At least 1. */
  stations: number;
}

/** One line of an order or a cart. */
export interface QueueItem {
  /** B — the product's preparation time, seconds. Variations and modifiers do not change it. */
  prepSeconds: number;
  /** «Готовится параллельно»: takes no station and runs alongside the rest of the order. */
  parallel?: boolean;
  /** How many: every unit is a position of its own (3 americanos are 3 positions). Default 1. */
  quantity?: number;
}

/**
 * An order that still owes the kitchen work: not «Готово», not handed over,
 * not cancelled. Leave out orders that are finished or cancelled — that is
 * what releases their stations and moves everyone behind them forward.
 */
export interface QueueOrder {
  id: string;
  /** T — when the order was placed. The queue is strictly FIFO by it. */
  placedAt: number;
  /** Breaks a tie in `placedAt`: lower goes first (the order number). Without it, the input order. */
  seq?: number;
  /** L — «Загрузка» was on when the order was placed. Switching it later does not move the order. */
  placedUnderLoad?: boolean;
  /** «Принял»: R becomes this moment (it may be earlier than T + A). */
  acceptedAt?: number | null;
  /** «Начать», pressed for the whole order: every position is under way from this moment. */
  startedAt?: number | null;
  /** P — a pre-order's «готово к». Null or absent for an ASAP order. */
  readyBy?: number | null;
  items: readonly QueueItem[];
}

/** Station time that is taken by something the calculator does not know about. */
export interface StationBlock extends TimeRange {
  /** 0-based station index; blocks of stations the store does not have are ignored. */
  station: number;
}

/** Everything the calculator needs about one store at one moment. */
export interface QueueState {
  settings: QueueSettings;
  orders: readonly QueueOrder[];
  /**
   * Working hours as merged UTC windows covering at least the next 24 hours
   * (an extension of the closing included). Null or absent: open around the
   * clock. An empty list: closed throughout.
   */
  hours?: readonly TimeRange[] | null;
  /** «Загрузка» is on now: a new order and the pre-order windows add N to A. */
  loadOn?: boolean;
  /** «Перерыв» is on: no new orders, neither ASAP nor for a time. Orders already taken stay. */
  paused?: boolean;
  /** Reserves kept elsewhere, a broken group head: station time nobody may use. */
  blocked?: readonly StationBlock[];
}

/** How an order is treated. */
export type PlannedOrderKind =
  /** «Начать» pressed: laid out from its start, never moved. */
  | 'started'
  /** An ASAP order not started yet: waits its turn (FIFO). */
  | 'queued'
  /** A pre-order not started yet: holds its reserve, ending at P. */
  | 'reserved';

/** Where and when one position is made. */
export interface PlannedItem {
  /** Position within the order, quantities unfolded, from 0. */
  index: number;
  prepSeconds: number;
  parallel: boolean;
  /** 0-based station; null for a parallel position, which takes none. */
  station: number | null;
  startAt: number;
  endAt: number;
}

export interface PlannedOrder {
  id: string;
  kind: PlannedOrderKind;
  /** 1-based place among the ASAP orders not started yet; null for the others. */
  position: number | null;
  /** R — the kitchen may start it from then (queued orders); null for the others. */
  canStartAt: number | null;
  /** O — when the kitchen takes it: its first position starts. */
  startAt: number;
  /** E (Kᵢ for C = 1) — its last station position ends; O when it has none. */
  stationsFreeAt: number;
  /** G — the whole order is ready (a reserved pre-order: its P). */
  readyAt: number;
  items: PlannedItem[];
}

export interface QueueSchedule {
  now: number;
  /** One entry per input order, in the input order. */
  orders: PlannedOrder[];
  /** fⱼ after the whole queue: when each station is free for the next order. */
  stationFreeAt: number[];
  /** S_пред after the whole queue: the start of its last position; null for an empty queue. */
  lastStartAt: number | null;
  /** Per station, sorted by start: positions of started and queued orders, reserves and blocked time. */
  busy: TimeRange[][];
}

/** Why an ASAP order cannot be taken now — the same codes the store DTO uses. */
export type QueueAsapBlockedReason = Extract<AsapBlockedReason, 'OUTSIDE_HOURS' | 'PAUSED' | 'CLOSING_SOON'>;

/** «Если закажете сейчас — будет готово в 12:11 · ≈ 11 мин». */
export interface AsapQuote {
  available: boolean;
  /** Null when available; else the first that applies: OUTSIDE_HOURS, PAUSED, CLOSING_SOON. */
  reason: QueueAsapBlockedReason | null;
  /** G of the cart placed now at the end of the queue (also when it is not available). */
  readyAt: number;
  /** ⌈G − t⌉ in minutes, never below 0. */
  waitMinutes: number;
  /** O — when the kitchen would take it. */
  startAt: number;
  /** Its place in the queue, 1-based. */
  position: number;
  /** End of the working-hours window it was checked against; null around the clock or outside the hours. */
  closesAt: number | null;
}

/** Pre-order times a customer may pick: every whole minute from `from` to `to`, both included. */
export interface ReadyWindow {
  from: number;
  to: number;
}

export interface PreorderWindowOptions {
  /** How far ahead a pre-order may be placed, ms. Default 24 hours. */
  horizonMs?: number;
}
