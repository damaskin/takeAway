import { isOpenAt, type WorkingHour } from '../kitchen/opening-hours';

/**
 * When a store counts as "open" for customers — the one place that decides.
 *
 * The catalog, the realtime `store.availabilityChanged` broadcast and the
 * admin all read these two functions, so changing what "open" means (shift
 * only, hours only, both) is a change here and nowhere else.
 */

/** What {@link acceptingOrders} needs: the status and the open shift, if any. */
export interface AvailabilityFacts {
  status: string;
  /** Open shifts only (`closedAt = null`); one row is enough. */
  shifts: readonly unknown[];
}

/**
 * The store takes orders at all right now: it is not switched off and staff
 * have started a shift. False means the clients show it as inactive.
 */
export function acceptingOrders(store: AvailabilityFacts): boolean {
  return store.status !== 'CLOSED' && store.shifts.length > 0;
}

/**
 * Whether an ASAP order placed now would be accepted: the store takes orders
 * (see acceptingOrders), and it is still open when that order would be ready —
 * the same working-hours check order creation enforces. Without this the
 * clients offered ASAP after hours and the customer met a bare 400 at checkout.
 */
export function openNow(
  store: AvailabilityFacts & { timezone: string; workingHours: readonly WorkingHour[] },
  now: Date,
  etaSeconds: number,
): boolean {
  if (!acceptingOrders(store)) return false;
  return isOpenAt(store.workingHours, new Date(now.getTime() + etaSeconds * 1000), store.timezone);
}
