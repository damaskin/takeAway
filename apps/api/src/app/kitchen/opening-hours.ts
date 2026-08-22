/**
 * Opening-hours arithmetic in a store's own timezone.
 *
 * `StoreWorkingHour` stores minutes since *local* midnight, but every
 * timestamp we compare against is UTC. Doing that conversion by hand with
 * offsets breaks twice a year, so the local wall clock is read out of
 * `Intl.DateTimeFormat` — the only timezone database Node ships that already
 * knows about daylight saving in every market we plan to open in.
 */

export interface WorkingHour {
  /** 0 = Sunday, 6 = Saturday (JS getDay convention). */
  weekday: number;
  /** Minutes since local midnight, e.g. 08:30 = 510. */
  opensAt: number;
  closesAt: number;
  isClosed: boolean;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface LocalMoment {
  /** 0 = Sunday. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

/**
 * The wall clock at `date` as seen from `timeZone`. Falls back to UTC when
 * the store carries a timezone Node does not recognise — better a slightly
 * wrong opening check than a 500 on the checkout path.
 */
export function localMoment(date: Date, timeZone: string): LocalMoment {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
  } catch {
    return { weekday: date.getUTCDay(), minutes: date.getUTCHours() * 60 + date.getUTCMinutes() };
  }

  const lookup = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';

  // `hour12: false` renders midnight as "24" in some ICU versions.
  const hour = Number(lookup('hour')) % 24;
  const minute = Number(lookup('minute'));
  const weekday = WEEKDAY_INDEX[lookup('weekday')] ?? date.getUTCDay();

  return { weekday, minutes: hour * 60 + minute };
}

/**
 * Whether the store is serving at `date`.
 *
 * A store with no hours on file is treated as always open — that is the
 * state every store starts in, and refusing orders for a row nobody has
 * filled in yet would be a worse failure than accepting one.
 *
 * Overnight shifts are handled: when `closesAt <= opensAt` the window runs
 * past midnight, so 22:00–02:00 covers both a Friday 23:30 and the tail of
 * it at 01:00 on Saturday.
 */
export function isOpenAt(hours: readonly WorkingHour[], date: Date, timeZone: string): boolean {
  if (hours.length === 0) return true;

  const { weekday, minutes } = localMoment(date, timeZone);

  const today = hours.find((h) => h.weekday === weekday);
  if (today && !today.isClosed && withinSameDay(today, minutes)) return true;

  // Still inside yesterday's overnight window?
  const yesterdayIndex = (weekday + 6) % 7;
  const yesterday = hours.find((h) => h.weekday === yesterdayIndex);
  if (yesterday && !yesterday.isClosed && spansMidnight(yesterday) && minutes < yesterday.closesAt) {
    return true;
  }

  return false;
}

function spansMidnight(hour: WorkingHour): boolean {
  return hour.closesAt <= hour.opensAt;
}

function withinSameDay(hour: WorkingHour, minutes: number): boolean {
  if (spansMidnight(hour)) return minutes >= hour.opensAt;
  return minutes >= hour.opensAt && minutes < hour.closesAt;
}
