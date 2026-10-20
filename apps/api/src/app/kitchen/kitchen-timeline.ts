import type { KitchenOrderTimeline } from '@takeaway/shared-types';

/**
 * When the kitchen has to do what for one order — start it, accept it at
 * the latest — worked out from the order and the store, the same way for
 * the board, the reminders and the expiry sweep (docs/kitchen-policy.md).
 */

/** Slack between "should start" and the bare cooking time: plating, handover, a glance at the ticket. */
export const START_BUFFER_SECONDS = 120;

/** A pre-order still unaccepted this long before its pickup time is called off. */
export const SCHEDULED_ACCEPT_LEAD_SECONDS = 10 * 60;

/** How long an order may wait for "Accept" before staff are alerted, and before it is called off. */
export interface AcceptancePolicy {
  /** `ORDER_ACCEPT_ALERT_SECONDS`, 180 by default. */
  acceptAlertSeconds: number;
  /** `ORDER_ACCEPT_TIMEOUT_SECONDS`, 480 by default. */
  acceptTimeoutSeconds: number;
}

export interface TimelineOrder {
  status: string;
  pickupMode: string;
  pickupAt: Date;
  prepSeconds: number;
  workSeconds: number;
  kitchenVisibleAt: Date | null;
}

const AWAITING_ACCEPTANCE: ReadonlySet<string> = new Set(['CREATED', 'PAID']);

/** Not accepted yet: the kitchen board's «Принять» is still on the ticket. */
export function awaitsAcceptance(order: { status: string }): boolean {
  return AWAITING_ACCEPTANCE.has(order.status);
}

/**
 * How long one order takes the kitchen from the first item to the last:
 * max(prep, work ÷ parallelism), whole seconds. Three americanos of five
 * minutes on a one-handed bar take fifteen, not five; on a three-handed bar
 * five. Used for when to start, for the order's own ETA and for the
 * kitchen's new estimate when it accepts an order late.
 */
export function cookingSeconds(
  order: { prepSeconds: number; workSeconds: number },
  kitchenParallelism: number,
): number {
  return Math.round(Math.max(order.prepSeconds, order.workSeconds / Math.max(1, kitchenParallelism)));
}

/**
 * When the kitchen should start: pickupAt − {@link cookingSeconds} −
 * {@link START_BUFFER_SECONDS}. A four-drink order on a two-handed bar
 * starts earlier than a single one, even though each drink takes the same.
 */
export function startBy(
  order: Pick<TimelineOrder, 'pickupAt' | 'prepSeconds' | 'workSeconds'>,
  kitchenParallelism: number,
): Date {
  const cooking = cookingSeconds(order, kitchenParallelism);
  return new Date(order.pickupAt.getTime() - cooking * 1000 - START_BUFFER_SECONDS * 1000);
}

/**
 * The kitchen's new estimate for an order it accepts or starts at `now`:
 * now + {@link cookingSeconds} when that is after the promised `pickupAt`,
 * else null — the promise still holds.
 */
export function readyEstimate(
  order: { pickupAt: Date; prepSeconds: number; workSeconds: number },
  kitchenParallelism: number,
  now: Date,
): Date | null {
  const ready = now.getTime() + cookingSeconds(order, kitchenParallelism) * 1000;
  return ready > order.pickupAt.getTime() ? new Date(ready) : null;
}

/**
 * From when an order nobody has accepted is late to accept: an ASAP order
 * `acceptAlertSeconds` after it reached the board. A pre-order at its start
 * time — but never later than the warning an ASAP order gets before it is
 * called off (timeout − alert before the deadline), and never sooner than
 * an ASAP order would be. Null when the order is accepted, or the clock
 * never started.
 */
export function acceptAlertAt(order: TimelineOrder, kitchenParallelism: number, policy: AcceptancePolicy): Date | null {
  if (!awaitsAcceptance(order) || !order.kitchenVisibleAt) return null;
  const alert = order.kitchenVisibleAt.getTime() + policy.acceptAlertSeconds * 1000;
  if (order.pickupMode !== 'SCHEDULED') return new Date(alert);
  const deadline = acceptDeadline(order, policy)?.getTime() ?? alert;
  const warning = deadline - (policy.acceptTimeoutSeconds - policy.acceptAlertSeconds) * 1000;
  return new Date(Math.max(alert, Math.min(startBy(order, kitchenParallelism).getTime(), warning)));
}

/**
 * When an order nobody has accepted is called off: an ASAP order
 * `acceptTimeoutSeconds` after it reached the board; a pre-order no sooner
 * than that and not before 10 minutes ahead of its pickup time — a
 * pre-order for the morning placed at night waits for the morning shift.
 */
export function acceptDeadline(order: TimelineOrder, policy: AcceptancePolicy): Date | null {
  if (!awaitsAcceptance(order) || !order.kitchenVisibleAt) return null;
  const timeout = order.kitchenVisibleAt.getTime() + policy.acceptTimeoutSeconds * 1000;
  if (order.pickupMode !== 'SCHEDULED') return new Date(timeout);
  return new Date(Math.max(timeout, order.pickupAt.getTime() - SCHEDULED_ACCEPT_LEAD_SECONDS * 1000));
}

/** The timing fields of a board row. */
export function kitchenTimeline(
  order: TimelineOrder,
  kitchenParallelism: number,
  policy: AcceptancePolicy,
): KitchenOrderTimeline {
  return {
    startBy: startBy(order, kitchenParallelism).toISOString(),
    awaitingSince: order.kitchenVisibleAt?.toISOString() ?? null,
    acceptAlertAt: acceptAlertAt(order, kitchenParallelism, policy)?.toISOString() ?? null,
    acceptDeadlineAt: acceptDeadline(order, policy)?.toISOString() ?? null,
  };
}
