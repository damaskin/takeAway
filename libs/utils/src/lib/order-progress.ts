/**
 * What the customer's order screen says while they wait, on top of the bare
 * status. Pure, so the web, the Mini App and their tests agree.
 */

import { readCancelMoney } from './order-cancel-money';

/** The parts of an order (`GET /orders/:id`) these helpers read. */
export interface OrderProgressInput {
  status: string;
  pickupMode?: string;
  /** ISO time the order is promised for. */
  pickupAt: string;
  /**
   * ISO time the kitchen expects it ready after accepting or starting it too
   * late for `pickupAt`; absent or null otherwise (and from older APIs).
   */
  readyEstimateAt?: string | null;
  totalCents?: number;
  /** Where the money stands; absent from an API that predates it. */
  payment?: { state: string } | null;
  /**
   * Where the money of a CANCELLED or EXPIRED order went, as the API
   * recorded it (`NOT_CHARGED`, `RELEASED`, `REFUNDED`, `PENDING`); absent
   * or null on older orders and from older APIs.
   */
  cancelMoney?: string | null;
}

/** The parts of the store (`GET /stores/:id`) that tell whether it is open now. */
export interface OrderStoreInput {
  openNow?: boolean;
  asapBlockedReason?: string | null;
}

/**
 * The order is on the kitchen board and nobody has accepted it yet: its card
 * hold went through (or there was nothing to pay), or — from before
 * charge-on-accept — it was paid outright. A new order whose card has not
 * gone through is not on the board, so it is not waiting for the store.
 */
export function isAwaitingAcceptance(order: OrderProgressInput): boolean {
  if (order.status === 'PAID') return true;
  if (order.status !== 'CREATED') return false;
  const state = order.payment?.state ?? 'NONE';
  if (state === 'HELD' || state === 'PAID') return true;
  return state === 'NONE' && order.totalCents === 0;
}

/**
 * The time the customer's countdown runs to: the kitchen's new estimate once
 * it accepted or started the order too late for the original promise, else
 * the promise itself (`pickupAt`).
 */
export function orderDueAt(order: Pick<OrderProgressInput, 'pickupAt' | 'readyEstimateAt'>): string {
  return order.readyEstimateAt ?? order.pickupAt;
}

/** See {@link orderWaitNote}. */
export type OrderWaitNote = 'late' | 'preorderAwaitingOpening' | 'awaitingAcceptance';

/**
 * The line that explains the wait:
 * - `late` — accepted or being made, and its time ({@link orderDueAt}) has
 *   passed. The customer may already be at the counter: «Немного
 *   задерживаемся». An order the kitchen accepted late carries a new
 *   estimate and counts down to it instead of reading as late;
 * - `preorderAwaitingOpening` — a pre-order on the board while the store is
 *   closed (overnight, or before the shift): it is accepted once it opens;
 * - `awaitingAcceptance` — on the board, not accepted yet;
 * - null — nothing beyond the status.
 *
 * `store` is the store as it is now; without it a pre-order reads as simply
 * awaiting acceptance.
 */
export function orderWaitNote(
  order: OrderProgressInput,
  store: OrderStoreInput | null | undefined,
  now: Date = new Date(),
): OrderWaitNote | null {
  if (order.status === 'ACCEPTED' || order.status === 'IN_PROGRESS') {
    const due = Date.parse(orderDueAt(order));
    return Number.isFinite(due) && due < now.getTime() ? 'late' : null;
  }
  if (!isAwaitingAcceptance(order)) return null;
  const closed = store?.openNow === false && store.asapBlockedReason !== 'QUEUE_FULL';
  return order.pickupMode === 'SCHEDULED' && closed ? 'preorderAwaitingOpening' : 'awaitingAcceptance';
}

/** See {@link expiredOutcome}. */
export type ExpiredOutcome = 'notAccepted' | 'notAcceptedRefunded' | 'paymentNotCompleted';

/**
 * Why an EXPIRED order ended, as far as the order itself tells:
 * - `notAccepted` — the store never accepted it and nothing was taken (the
 *   hold was released or is coming off, or there was nothing to pay);
 * - `notAcceptedRefunded` — the store never accepted it and the money taken
 *   is on its way back;
 * - `paymentNotCompleted` — the card payment never went through.
 *
 * The money the API recorded when it let the order go (`cancelMoney`) says
 * which of the first two it is. Without it (older orders, older APIs) the
 * payment as it is now decides: a payment that timed out shows as a pending
 * or failed one, and a released hold reads like a refund.
 */
export function expiredOutcome(order: Pick<OrderProgressInput, 'payment' | 'cancelMoney'>): ExpiredOutcome {
  switch (readCancelMoney(order.cancelMoney)) {
    case 'REFUNDED':
      return 'notAcceptedRefunded';
    case 'NOT_CHARGED':
    case 'RELEASED':
    case 'PENDING':
      return 'notAccepted';
    default:
      break;
  }
  switch (order.payment?.state ?? 'NONE') {
    case 'PENDING':
    case 'FAILED':
      return 'paymentNotCompleted';
    case 'REFUNDED':
    case 'PAID':
      return 'notAcceptedRefunded';
    default:
      return 'notAccepted';
  }
}

/** The parts of a CANCELLED order {@link orderCancellation} reads. */
export interface OrderCancellationInput {
  status: string;
  totalCents?: number;
  payment?: { state: string } | null;
  /** `CUSTOMER` or `STORE`; absent or null on orders that do not say (and from older APIs). */
  cancelledBy?: string | null;
  cancelReason?: string | null;
  cancelComment?: string | null;
  /** See {@link OrderProgressInput.cancelMoney}. */
  cancelMoney?: string | null;
}

/**
 * Who called the order off, as the customer reads it: `customer` — they did;
 * `store` — the kitchen turned it down; `cardDeclined` — the bank declined
 * the card when the kitchen accepted it.
 */
export type OrderCancelledParty = 'customer' | 'store' | 'cardDeclined';

/** The kitchen's reasons for turning an order down. */
export type StoreCancelReason = 'OUT_OF_STOCK' | 'TOO_BUSY' | 'CLOSING' | 'OTHER';

/**
 * Where the money of a cancelled or expired order is, in the push's words
 * (`ORDER_CANCEL_MONEY_TEXT`) — the API's `cancelMoney`, as a translation key:
 * - `notCharged` — nothing was taken from the card (`NOT_CHARGED`);
 * - `released` — the card hold is lifted (`RELEASED`);
 * - `refunded` — the money is on its way back to the card (`REFUNDED`);
 * - `holdPending` — the hold is still on the card and comes off by itself
 *   (`PENDING`).
 */
export type OrderCancelledMoney = 'notCharged' | 'released' | 'refunded' | 'holdPending';

const CANCEL_MONEY_KEYS = {
  NOT_CHARGED: 'notCharged',
  RELEASED: 'released',
  REFUNDED: 'refunded',
  PENDING: 'holdPending',
} as const satisfies Record<string, OrderCancelledMoney>;

/** What the order screen says about a CANCELLED order — see {@link orderCancellation}. */
export interface OrderCancellation {
  /** Null when the order does not say who cancelled it (cancelled before 2026-11-05). */
  by: OrderCancelledParty | null;
  /** The kitchen's reason; only when `by` is `store`. */
  reason: StoreCancelReason | null;
  /** The kitchen's own words, as typed; only when `by` is `store`. */
  comment: string | null;
  /** Null when there was no card money to speak of (a zero total, a payment never confirmed). */
  money: OrderCancelledMoney | null;
}

const STORE_CANCEL_REASONS: readonly string[] = ['OUT_OF_STOCK', 'TOO_BUSY', 'CLOSING', 'OTHER'];

/**
 * Who called a CANCELLED order off, why, and where the money is — the same
 * story the push told. Null for any other status. The money is
 * {@link endedOrderMoney}.
 */
export function orderCancellation(order: OrderCancellationInput): OrderCancellation | null {
  if (order.status !== 'CANCELLED') return null;
  const by = cancelledParty(order);
  const reason =
    by === 'store' && order.cancelReason && STORE_CANCEL_REASONS.includes(order.cancelReason)
      ? (order.cancelReason as StoreCancelReason)
      : null;
  const comment = by === 'store' ? order.cancelComment?.trim() || null : null;
  return { by, reason, comment, money: endedOrderMoney(order) };
}

/**
 * Where the money of a CANCELLED or EXPIRED order went, in the push's
 * words; null for any other status, and when there is nothing to say (a
 * zero total, a payment the bank has not confirmed either way).
 *
 * The money the API recorded when it called the order off (`cancelMoney`)
 * is the push's own outcome and wins. Without it (older orders, older APIs)
 * it is read off the payment as it is now: a deferred charge called off
 * shows as no payment, a released hold and a refund both as REFUNDED — told
 * apart only by who cancelled, as the customer's own cancel never follows a
 * capture — and a hold the bank has not let go of yet as HELD.
 */
export function endedOrderMoney(order: OrderCancellationInput): OrderCancelledMoney | null {
  if (order.status !== 'CANCELLED' && order.status !== 'EXPIRED') return null;
  const recorded = readCancelMoney(order.cancelMoney);
  if (recorded) return CANCEL_MONEY_KEYS[recorded];
  switch (order.payment?.state ?? 'NONE') {
    case 'NONE':
    case 'FAILED':
      return order.totalCents === 0 ? null : 'notCharged';
    case 'HELD':
      return 'holdPending';
    case 'REFUNDED':
      return order.cancelledBy === 'CUSTOMER' ? 'released' : 'refunded';
    case 'PAID':
      return 'refunded';
    default:
      // PENDING: the bank has not said yet whether anything was taken.
      return null;
  }
}

function cancelledParty(order: OrderCancellationInput): OrderCancelledParty | null {
  if (order.cancelledBy === 'CUSTOMER') return 'customer';
  if (order.cancelledBy !== 'STORE') return null;
  return order.cancelReason === 'CARD_DECLINED' ? 'cardDeclined' : 'store';
}

/**
 * Time left on an order's countdown: «4:05», and «13:05:00» once it is an
 * hour or more away — a pre-order for tomorrow morning is not «780:00».
 * Never negative.
 */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}
