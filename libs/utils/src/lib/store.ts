/**
 * True when the store takes no orders at all right now — switched off, or
 * nothing it could take in the next 24 hours, not even a pre-order. Such a
 * store is shown as closed: no menu, no basket, checkout refused. A store
 * from an API that predates shifts counts as active unless it is closed.
 */
export function isStoreInactive(store: { status: string; acceptingOrders?: boolean }): boolean {
  return store.status === 'CLOSED' || store.acceptingOrders === false;
}

/**
 * How a customer can order from a store right now:
 * - `open` — order for now;
 * - `scheduledOnly` — an order placed now would not be accepted (outside
 *   working hours, no shift started yet, or the queue is full), but a
 *   pre-order for a pickup time later on is — even tomorrow morning while
 *   the shift is closed overnight;
 * - `closed` — nothing: see {@link isStoreInactive}.
 *
 * Since 2026-10-14 working hours win over the shift for `openNow`, and
 * `acceptingOrders` stays true while a pre-order can be booked, so the two
 * diverge every night (owner decision 2026-10-14).
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

/** What a store card or menu header says about the hours, beside the name. */
export type StoreHoursNote =
  /** Closed for orders now; opens at `at`, `days` calendar days from today; pre-orders taken. */
  | { kind: 'opens'; at: string; days: number }
  /** Closed for orders now with no opening time to name (no shift yet); pre-orders taken. */
  | { kind: 'preorder' }
  /** Open, but the queue is too long for «now»; pre-orders taken. */
  | { kind: 'queueFull' }
  /** The kitchen paused the store until `until` («Технический перерыв»); pre-orders for later taken. */
  | { kind: 'paused'; until: string }
  /** Within hours, but an order for now would not be ready before the closing; pre-orders taken. */
  | { kind: 'closingSoon' }
  /** Open for orders now, until `at`. */
  | { kind: 'until'; at: string };

/**
 * The line a store card shows about its hours: «откроется завтра в 9:00 ·
 * можно заказать ко времени» while it takes pre-orders only, «до 21:00»
 * while open. Null when there is nothing to add — a store that takes no
 * orders at all (shown as closed, as before), or an open one without a
 * closing time (24/7, or an API that predates `closesAt`).
 */
export function storeHoursNote(
  store: {
    status: string;
    acceptingOrders?: boolean;
    openNow?: boolean;
    asapBlockedReason?: string | null;
    opensAt?: string | null;
    closesAt?: string | null;
    pausedUntil?: string | null;
    timezone?: string | null;
  },
  now: Date = new Date(),
): StoreHoursNote | null {
  const availability = storeAvailability(store);
  if (availability === 'closed') return null;
  if (availability === 'open') return store.closesAt ? { kind: 'until', at: store.closesAt } : null;
  if (store.asapBlockedReason === 'QUEUE_FULL') return { kind: 'queueFull' };
  if (store.asapBlockedReason === 'PAUSED' && store.pausedUntil) return { kind: 'paused', until: store.pausedUntil };
  if (store.asapBlockedReason === 'CLOSING_SOON') return { kind: 'closingSoon' };
  if (store.opensAt)
    return { kind: 'opens', at: store.opensAt, days: calendarDaysFrom(store.opensAt, now, store.timezone) };
  return { kind: 'preorder' };
}

/**
 * Whole calendar days from `now` to `date` on the store's clock: 0 for later
 * today, 1 for tomorrow, -1 for yesterday. «Завтра в 9:00» must be the
 * café's tomorrow, not the viewer's.
 */
export function calendarDaysFrom(date: Date | string, now: Date = new Date(), timeZone?: string | null): number {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return 0;
  return dayNumber(target, timeZone) - dayNumber(now, timeZone);
}

/** One day of pickup windows: `days` from today (0, 1, …) and its slots in order. */
export interface PickupSlotDay<T> {
  days: number;
  slots: T[];
}

/**
 * Pickup windows split by calendar day on the store's clock, so a picker
 * covering 24 hours can head them «Сегодня» and «Завтра». Keeps the API's
 * order within a day.
 */
export function groupSlotsByDay<T extends { startsAt: string }>(
  slots: readonly T[],
  now: Date = new Date(),
  timeZone?: string | null,
): PickupSlotDay<T>[] {
  const groups: PickupSlotDay<T>[] = [];
  for (const slot of slots) {
    const days = calendarDaysFrom(slot.startsAt, now, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.days === days) last.slots.push(slot);
    else groups.push({ days, slots: [slot] });
  }
  return groups;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Days since the epoch of the calendar date `date` falls on in `timeZone`. */
function dayNumber(date: Date, timeZone?: string | null): number {
  const zone = timeZone || '';
  let format = dayFormatters.get(zone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone: zone || undefined,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });
    } catch {
      // An unknown zone throws; the viewer's own calendar beats nothing.
      format = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
    }
    dayFormatters.set(zone, format);
  }
  const parts = format.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  return Math.round(Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000);
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
