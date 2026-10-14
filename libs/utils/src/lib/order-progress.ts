/**
 * What the customer's order screen says while they wait, on top of the bare
 * status. Pure, so the web, the Mini App and their tests agree.
 */

/** The parts of an order (`GET /orders/:id`) these helpers read. */
export interface OrderProgressInput {
  status: string;
  pickupMode?: string;
  /** ISO time the order is promised for. */
  pickupAt: string;
  totalCents?: number;
  /** Where the money stands; absent from an API that predates it. */
  payment?: { state: string } | null;
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

/** See {@link orderWaitNote}. */
export type OrderWaitNote = 'late' | 'preorderAwaitingOpening' | 'awaitingAcceptance';

/**
 * The line that explains the wait:
 * - `late` — accepted or being made, and its time has passed. The customer
 *   may already be at the counter: «Немного задерживаемся»;
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
    const due = Date.parse(order.pickupAt);
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
 *   hold was released, or there was nothing to pay);
 * - `notAcceptedRefunded` — the store never accepted it and the money taken
 *   is on its way back;
 * - `paymentNotCompleted` — the card payment never went through.
 *
 * The order carries no expiry reason: a released hold shows as no payment,
 * a payment that timed out as a pending or failed one.
 */
export function expiredOutcome(order: Pick<OrderProgressInput, 'payment'>): ExpiredOutcome {
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
