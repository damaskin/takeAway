/**
 * The kitchen board and the store's shift (`/kds/*`), as the kitchen
 * operations policy shapes them — see docs/kitchen-policy.md. Since
 * 2026-10-20 the working hours open and close the shift by themselves; the
 * kitchen can only extend the closing and pause the store.
 */

import type { AsapBlockedReason, StorePauseReason } from './catalog';

/** Timing fields of a kitchen board row (`GET /kds/orders`, `kds.orderChanged`). */
export interface KitchenOrderTimeline {
  /**
   * ISO UTC: when the kitchen should start for the order to be ready by
   * `pickupAt` — pickupAt − max(prep, kitchen work ÷ parallelism) − 2 min.
   * A pre-order whose start is more than 15 minutes away waits in the
   * «Предзаказы» group.
   */
  startBy: string;
  /** ISO UTC: the order reached the board and the acceptance clock started. Null for orders from before 2026-10-14. */
  awaitingSince: string | null;
  /**
   * ISO UTC: from here an order nobody has accepted pulses on the board and
   * staff and the owner get a Telegram alert. Null once accepted.
   */
  acceptAlertAt: string | null;
  /** ISO UTC: an order still unaccepted then is cancelled (EXPIRED) and the customer's money released. Null once accepted. */
  acceptDeadlineAt: string | null;
}

/**
 * `PUT /kds/shift/extend` body: take ASAP orders this much longer past the
 * working hours. Offered only in the last hour before the closing (or while
 * an extension runs) — see `KitchenShiftState.canExtend`.
 */
export type ShiftExtendMinutes = 30 | 60;

export const SHIFT_EXTEND_MINUTES: readonly ShiftExtendMinutes[] = [30, 60];

/** The longest comment `PUT /kds/pause` takes. */
export const KITCHEN_PAUSE_COMMENT_MAX = 120;

/** How long a kitchen pause lasts; `null` in the request = until the store closes today. */
export type KitchenPauseMinutes = 15 | 30 | 60 | 120;

export const KITCHEN_PAUSE_MINUTES: readonly KitchenPauseMinutes[] = [15, 30, 60, 120];

/** `PUT /kds/pause?storeId=` body. */
export interface KitchenPauseRequest {
  /** Null: until the end of the current working-hours window (or the extension). */
  minutes: KitchenPauseMinutes | null;
  reason: StorePauseReason;
  /** Free text for the owner and staff, e.g. «кофемашина». Up to 120 characters. */
  comment?: string | null;
}

/** `GET /kds/shift` — the store's shift and what it means for ASAP orders right now. */
export interface KitchenShiftState {
  storeId: string;
  /** A shift is open. ASAP orders also need the working hours (or an extension); pre-orders do not need the shift. */
  open: boolean;
  /** When the current shift started; the last one's start when closed. Null if there never was one. */
  openedAt: string | null;
  openedByName: string | null;
  /** When the last shift ended. Null while open or if there never was one. */
  closedAt: string | null;
  closedByName: string | null;
  /** The kitchen marked the store «Загружены» (status OVERLOADED). */
  busy: boolean;
  /** ISO UTC: ASAP orders are taken past the working hours until then (an open shift's extension); null without one. */
  extendedUntil: string | null;
  /** ISO UTC end of the current working-hours window; null outside the hours and around the clock. */
  closesAt: string | null;
  /** ISO UTC start of the next working-hours window while outside the hours. */
  opensAt: string | null;
  /** An ASAP order placed now would be taken — the store's `openNow`. */
  asapOpen: boolean;
  asapBlockedReason: AsapBlockedReason | null;
  /** The last shift was closed by the schedule after the working hours ended, not by a person. */
  closedAutomatically: boolean;
  /** The current (or last) shift was opened by the schedule, not by a person. */
  openedAutomatically: boolean;
  /**
   * «Продлить на 30 мин / 1 ч» may be offered now: a shift is open, within
   * the working hours and the closing is at most 60 minutes away, or an
   * extension is running and still below its cap.
   */
  canExtend: boolean;
  /** ISO UTC: the store is paused until then; null when not paused. */
  pausedUntil: string | null;
  pauseReason: StorePauseReason | null;
  pauseComment: string | null;
  pausedByName: string | null;
}

/**
 * Why `PUT /kds/shift/extend` was refused (409 `SHIFT_EXTENSION_NOT_ALLOWED`,
 * in `reason`): no shift is open, the store is open around the clock, it is
 * outside the working hours with no extension running, the closing is more
 * than an hour away, or the extension reached its cap (four hours past the
 * closing).
 */
export type ShiftExtensionRefusal = 'NO_SHIFT' | 'AROUND_THE_CLOCK' | 'OUTSIDE_HOURS' | 'TOO_EARLY' | 'LIMIT';

/**
 * Why a ticket left the kitchen board without the kitchen moving it on —
 * `reason` of a `kds.orderChanged` with kind `removed` (absent from older
 * API builds and from the board's own transitions): the customer cancelled
 * it before it was accepted, the store rejected it, nobody accepted it in
 * time (the SLA auto-cancel), or it expired otherwise (a payment that never
 * came, the old backstops).
 */
export type KitchenOrderRemovedReason = 'CANCELLED_BY_CUSTOMER' | 'REJECTED' | 'NOT_ACCEPTED' | 'EXPIRED';
