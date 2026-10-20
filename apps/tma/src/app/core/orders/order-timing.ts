import { calendarDaysFrom, orderDueAt } from '@takeaway/utils';

/**
 * Past this the order screen names the pickup time («к 09:15 завтра»)
 * instead of counting down: a nine-hour «8:59:41» for tomorrow morning's
 * pre-order reads like a bug, not like a promise.
 */
export const COUNTDOWN_LIMIT_MS = 60 * 60_000;

/** What the big line on the order screen shows while the order is on its way. */
export type PickupClock =
  /** «4:05» to the due time. */
  | { kind: 'countdown'; remainingMs: number }
  /** «к 09:15», «к 09:15 завтра», «к 09:15, 23 окт.»: `days` from today on the store's clock. */
  | { kind: 'at'; at: string; days: number };

/**
 * The countdown, or the clock time for an order more than an hour away. Runs
 * to {@link orderDueAt}: the kitchen's new estimate once it accepted the
 * order late, else the original promise.
 */
export function pickupClock(
  order: { pickupAt: string; readyEstimateAt?: string | null },
  now: Date,
  timeZone?: string | null,
): PickupClock {
  const due = orderDueAt(order);
  const remainingMs = Date.parse(due) - now.getTime();
  if (Number.isFinite(remainingMs) && remainingMs > COUNTDOWN_LIMIT_MS) {
    return { kind: 'at', at: due, days: calendarDaysFrom(due, now, timeZone) };
  }
  return { kind: 'countdown', remainingMs: Math.max(0, remainingMs) };
}

/**
 * Minutes until the kitchen's new estimate, while the order is accepted or
 * being made and the kitchen named one (`readyEstimateAt`, set when it took
 * the order too late for the original time) that has not passed yet: «Готовим
 * · будет готово через 6 мин» instead of «Немного задерживаемся». Null
 * otherwise — then the usual wait note applies.
 */
export function freshEstimateMinutes(
  order: { status: string; readyEstimateAt?: string | null },
  now: Date,
): number | null {
  if (order.status !== 'ACCEPTED' && order.status !== 'IN_PROGRESS') return null;
  if (!order.readyEstimateAt) return null;
  const remainingMs = Date.parse(order.readyEstimateAt) - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  return Math.max(1, Math.ceil(remainingMs / 60_000));
}

/**
 * The customer may cancel the order themselves: the API says so
 * (`canCancel`: not accepted yet, no money taken — owner decision
 * 2026-10-20). An API from before the field: while the order is new or paid
 * and not accepted, as it used to allow.
 */
export function customerCanCancel(order: { status: string; canCancel?: boolean }): boolean {
  if (typeof order.canCancel === 'boolean') return order.canCancel;
  return order.status === 'CREATED' || order.status === 'PAID';
}

/**
 * The order is still on its way but only the store can call it off now —
 * the kitchen accepted it, or the money was taken: «Заказ уже готовят — для
 * отмены позвоните в точку». Not once it is ready: then it is being handed
 * over.
 */
export function cancelNeedsCall(order: { status: string; canCancel?: boolean }): boolean {
  if (['READY', 'PICKED_UP', 'CANCELLED', 'EXPIRED'].includes(order.status)) return false;
  return !customerCanCancel(order);
}
