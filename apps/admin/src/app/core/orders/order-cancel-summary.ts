import type { AdminOrderDetail } from './orders.service';

/**
 * What the order detail says about a cancelled or expired order, as
 * translation keys and the kitchen's and the bank's own words.
 */
export interface OrderCancelSummary {
  /** Translation key of the section title. */
  title: string;
  /** Translation key of who called it off; null when the order does not say (older orders, expiry). */
  by: string | null;
  /** Translation key of the kitchen's reason; null for the customer's own cancel and a declined card. */
  reason: string | null;
  /** The kitchen's comment, as the customer saw it. */
  comment: string | null;
  /** Translation key of where the money went — the outcome the customer's push stated. */
  money: string | null;
  /** What the bank said on a card declined on the accept; never shown to the customer. */
  bankMessage: string | null;
}

const STORE_REASONS: readonly string[] = ['OUT_OF_STOCK', 'TOO_BUSY', 'CLOSING', 'OTHER'];
const MONEY: readonly string[] = ['NOT_CHARGED', 'RELEASED', 'REFUNDED', 'PENDING'];

/**
 * Who cancelled the order, why, what the kitchen wrote and where the money
 * went — what a manager answering the customer needs first. Null for an
 * order still alive, and for an expired or older cancelled one with nothing
 * on record beyond its status.
 */
export function orderCancelSummary(
  order: Pick<AdminOrderDetail, 'status' | 'cancelledBy' | 'cancelReason' | 'cancelComment' | 'cancelMoney' | 'events'>,
): OrderCancelSummary | null {
  if (order.status !== 'CANCELLED' && order.status !== 'EXPIRED') return null;
  const cancelled = order.status === 'CANCELLED';
  const declined = cancelled && order.cancelReason === 'CARD_DECLINED';
  const storeReason = cancelled && order.cancelledBy === 'STORE' && STORE_REASONS.includes(order.cancelReason ?? '');
  const summary: OrderCancelSummary = {
    title: cancelled ? 'admin.orderDetail.cancel.title' : 'admin.orderDetail.cancel.expiredTitle',
    by: cancelled ? cancelledByKey(order) : null,
    reason: storeReason ? `admin.orderDetail.cancel.reasons.${order.cancelReason}` : null,
    comment: (cancelled && order.cancelComment?.trim()) || null,
    money: MONEY.includes(order.cancelMoney ?? '')
      ? `admin.orderDetail.cancel.moneyOutcome.${order.cancelMoney}`
      : null,
    bankMessage: declined ? bankMessage(order.events) : null,
  };
  const said = summary.by || summary.reason || summary.comment || summary.money || summary.bankMessage;
  return said ? summary : null;
}

function cancelledByKey(order: Pick<AdminOrderDetail, 'cancelledBy' | 'cancelReason'>): string | null {
  if (order.cancelReason === 'CARD_DECLINED') return 'admin.orderDetail.cancel.byCardDeclined';
  if (order.cancelledBy === 'CUSTOMER') return 'admin.orderDetail.cancel.byCustomer';
  if (order.cancelledBy === 'STORE') return 'admin.orderDetail.cancel.byStore';
  return null;
}

/** The bank's words on the latest CANCELLED event, when it kept any. */
function bankMessage(events: AdminOrderDetail['events']): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type !== 'CANCELLED') continue;
    const payload = event.payload;
    if (!payload || typeof payload !== 'object') return null;
    const message = (payload as Record<string, unknown>)['bankMessage'];
    return typeof message === 'string' && message.trim() ? message.trim() : null;
  }
  return null;
}
