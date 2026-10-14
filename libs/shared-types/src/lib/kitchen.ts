/**
 * The kitchen board and the store's shift (`/kds/*`), as the kitchen
 * operations policy of 2026-10-14 shapes them — see docs/kitchen-policy.md.
 */

import type { AsapBlockedReason } from './catalog';

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

/** `PUT /kds/shift/extend` body: take ASAP orders this much longer past the working hours. */
export type ShiftExtendMinutes = 30 | 60;

export const SHIFT_EXTEND_MINUTES: readonly ShiftExtendMinutes[] = [30, 60];

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
}

/**
 * `GET /kds/shift/close-summary` — what "Finish work" would leave behind.
 * `awaitingAcceptance` blocks the close (409 `SHIFT_HAS_UNACCEPTED_ORDERS`).
 */
export interface ShiftCloseSummary {
  /** Not accepted yet and due within 30 minutes: accept or reject them first. */
  awaitingAcceptance: number;
  /** Accepted or being made, due soon: they stay on the board — finish them. */
  inProgress: number;
  /** Ready and waiting for the customer: they stay on the board. */
  ready: number;
  /** Pre-orders for later: they come to the board in the next shift. */
  later: number;
}

/** Body of the 409 `POST /kds/shift/close` answers while orders wait for acceptance. */
export interface ShiftHasUnacceptedOrdersBody {
  statusCode: 409;
  error: 'Conflict';
  code: 'SHIFT_HAS_UNACCEPTED_ORDERS';
  message: string;
  count: number;
}
