/**
 * True when the store takes no orders at all right now — switched off, or no
 * shift started ("Start work" in the cabinet). Such a store is shown as
 * closed: no menu, no basket, checkout refused. A store from an API that
 * predates shifts counts as active unless it is closed.
 */
export function isStoreInactive(store: { status: string; acceptingOrders?: boolean }): boolean {
  return store.status === 'CLOSED' || store.acceptingOrders === false;
}

/**
 * How a customer can order from a store right now:
 * - `open` — order for now;
 * - `scheduledOnly` — a shift is running but the API says an order placed
 *   now would not be accepted, so only a pickup time later on works;
 * - `closed` — nothing: see {@link isStoreInactive}.
 *
 * Since 2026-10-04 the API decides `openNow` by the shift alone
 * (`openNow === acceptingOrders`: shift open and status not CLOSED), so a
 * current API never yields `scheduledOnly` — working hours no longer veto
 * "open now". The state stays as a harmless fallback should the two fields
 * ever diverge again.
 */
export type StoreAvailability = 'open' | 'scheduledOnly' | 'closed';

export function storeAvailability(store: {
  status: string;
  acceptingOrders?: boolean;
  openNow?: boolean;
}): StoreAvailability {
  if (isStoreInactive(store)) return 'closed';
  // `=== false`: an API that predates the field keeps ordering for now.
  return store.openNow === false ? 'scheduledOnly' : 'open';
}

const AVAILABILITY_RANK: Record<StoreAvailability, number> = { open: 0, scheduledOnly: 1, closed: 2 };

/**
 * Stores a customer can order from first, closed ones last. Stable: within
 * each group the API's own order (distance, then wait) is kept.
 */
export function sortStoresByAvailability<T extends { status: string; acceptingOrders?: boolean; openNow?: boolean }>(
  stores: readonly T[],
): T[] {
  return stores
    .map((store, index) => ({ store, index, rank: AVAILABILITY_RANK[storeAvailability(store)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.store);
}

/** One day of a store's opening hours, in minutes since local midnight. */
export interface OpeningHoursDay {
  /** 0 = Sunday, 6 = Saturday. */
  weekday: number;
  opensAt: number;
  closesAt: number;
  isClosed: boolean;
}

/**
 * Today's opening hours on the store's own clock: the window, `'dayOff'`
 * when the store does not open today, or null when no hours are on file
 * (the API then treats the store as always open, so there is nothing to say).
 */
export function todaysOpeningHours(
  hours: readonly OpeningHoursDay[] | null | undefined,
  timeZone?: string | null,
  now: Date = new Date(),
): { opensAt: number; closesAt: number } | 'dayOff' | null {
  if (!hours || hours.length === 0) return null;
  const today = hours.find((h) => h.weekday === localWeekday(now, timeZone));
  if (!today || today.isClosed) return 'dayOff';
  return { opensAt: today.opensAt, closesAt: today.closesAt };
}

/** «08:00» for 480 — minutes since midnight as a 24-hour wall-clock time. */
export function formatMinutesOfDay(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localWeekday(date: Date, timeZone?: string | null): number {
  try {
    const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timeZone || undefined }).format(date);
    return WEEKDAYS[name] ?? date.getDay();
  } catch {
    // An unknown zone throws; the viewer's own day beats nothing.
    return date.getDay();
  }
}
