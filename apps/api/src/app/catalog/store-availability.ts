/**
 * When a store counts as "open" for customers — the one place that decides.
 *
 * The shift is the source of truth (owner decision, 2026-10-04): staff
 * pressed "Start work" → the store is open now and takes ASAP orders;
 * the shift is closed or the store is switched off (status CLOSED) → it is
 * closed. Working hours are only displayed and used to offer pre-order
 * slots for later (KitchenLoadService.pickupSlots / assertOpenAt on
 * scheduled orders); they no longer veto "open now".
 *
 * The catalog, the realtime `store.availabilityChanged` broadcast and the
 * admin all read these functions, so changing what "open" means is a
 * change here and nowhere else.
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
 * Whether an ASAP order placed now would be accepted. Since the shift is
 * the source of truth this is exactly {@link acceptingOrders}: a shift
 * running at 23:00 takes orders even if the posted hours end at 22:00.
 * Kept as its own function (and on the DTO) so the clients' "open now"
 * badge has one definition to follow if the rule changes again.
 */
export function openNow(store: AvailabilityFacts): boolean {
  return acceptingOrders(store);
}
