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
 * One `Intl.DateTimeFormat` per timezone: building one is the expensive
 * part, and the store list reads the hours of every store on every request.
 * `null` records a zone Node does not know, so it is not retried each time.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  if (FORMATTERS.has(timeZone)) return FORMATTERS.get(timeZone) ?? null;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    formatter = null;
  }
  FORMATTERS.set(timeZone, formatter);
  return formatter;
}

/** The local calendar date and wall clock at an instant. */
interface LocalDateTime extends LocalMoment {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  seconds: number;
}

function localDateTime(date: Date, timeZone: string): LocalDateTime {
  const formatter = formatterFor(timeZone);
  if (!formatter) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      weekday: date.getUTCDay(),
      minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
      seconds: date.getUTCSeconds(),
    };
  }
  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';

  // `hour12: false` renders midnight as "24" in some ICU versions.
  const hour = Number(lookup('hour')) % 24;
  return {
    year: Number(lookup('year')),
    month: Number(lookup('month')),
    day: Number(lookup('day')),
    weekday: WEEKDAY_INDEX[lookup('weekday')] ?? date.getUTCDay(),
    minutes: hour * 60 + Number(lookup('minute')),
    seconds: Number(lookup('second')),
  };
}

/**
 * The wall clock at `date` as seen from `timeZone`. Falls back to UTC when
 * the store carries a timezone Node does not recognise — better a slightly
 * wrong opening check than a 500 on the checkout path.
 */
export function localMoment(date: Date, timeZone: string): LocalMoment {
  const { weekday, minutes } = localDateTime(date, timeZone);
  return { weekday, minutes };
}

/** The first local midnight after `date` in `timeZone` — "the end of the day" on the store's clock. */
export function nextLocalMidnight(date: Date, timeZone: string): Date {
  const { year, month, day } = localDateTime(date, timeZone);
  return localToUtc(year, month, day + 1, 0, timeZone);
}

/** The wall clock at `date` in `timeZone` as "HH:mm" — for staff messages. */
export function wallClock(date: Date, timeZone: string): string {
  const { minutes } = localMoment(date, timeZone);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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

/** A stretch of working hours as UTC instants, `[start, end)`. */
export interface HoursWindow {
  start: Date;
  end: Date;
}

/**
 * The working hours around one moment, as merged UTC windows. Built once
 * and asked many questions: is the store within hours, when does the
 * current window close, when does the next one open, when did the last one
 * end.
 */
export interface HoursAround {
  /** No hours on file: the store counts as open around the clock. */
  alwaysOpen: boolean;
  /** Sorted and merged: back-to-back days (09:00–24:00, 00:00–02:00) are one window. */
  windows: HoursWindow[];
  /** The span that was looked at. A window reaching an edge was cut there, so that end is not a real closing. */
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far {@link hoursAround} looks back and ahead by default. */
const DEFAULT_BACK_DAYS = 7;
const DEFAULT_AHEAD_DAYS = 8;

/**
 * The UTC offset of `timeZone` at `date`, in milliseconds (positive east of
 * Greenwich), read off the local wall clock rather than a table.
 */
function offsetMs(date: Date, timeZone: string): number {
  const local = localDateTime(date, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    Math.floor(local.minutes / 60),
    local.minutes % 60,
    local.seconds,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in `timeZone`. `minutes` may run
 * past 1440 (an overnight window closing "tomorrow"). Two passes settle the
 * offset across a daylight-saving change; a time that does not exist (the
 * hour skipped in spring) lands next to the jump.
 */
export function localToUtc(year: number, month: number, day: number, minutes: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  let instant = wall - offsetMs(new Date(wall), timeZone);
  instant = wall - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/**
 * The working-hours windows around `at`, from `backDays` before it to
 * `aheadDays` after, merged and sorted, in UTC. The same rules as
 * {@link isOpenAt}: a window whose close is not after its open runs past
 * midnight into the next day.
 */
export function hoursAround(
  hours: readonly WorkingHour[],
  timeZone: string,
  at: Date,
  { backDays = DEFAULT_BACK_DAYS, aheadDays = DEFAULT_AHEAD_DAYS }: { backDays?: number; aheadDays?: number } = {},
): HoursAround {
  const from = new Date(at.getTime() - backDays * DAY_MS);
  const to = new Date(at.getTime() + aheadDays * DAY_MS);
  if (hours.length === 0) return { alwaysOpen: true, windows: [], from, to };

  const today = localDateTime(at, timeZone);
  const raw: HoursWindow[] = [];
  // One extra day each side: yesterday's overnight window reaches into today.
  for (let offset = -backDays - 1; offset <= aheadDays + 1; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const row = hours.find((h) => h.weekday === date.getUTCDay());
    if (!row || row.isClosed) continue;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const closes = spansMidnight(row) ? row.closesAt + 24 * 60 : row.closesAt;
    raw.push({
      start: localToUtc(year, month, day, row.opensAt, timeZone),
      end: localToUtc(year, month, day, closes, timeZone),
    });
  }

  raw.sort((a, b) => a.start.getTime() - b.start.getTime());
  const windows: HoursWindow[] = [];
  for (const w of raw) {
    if (w.end <= from || w.start >= to) continue;
    const last = windows[windows.length - 1];
    if (last && w.start.getTime() <= last.end.getTime()) {
      if (w.end > last.end) last.end = w.end;
    } else {
      windows.push({ start: w.start, end: w.end });
    }
  }
  return { alwaysOpen: false, windows, from, to };
}

/** Whether `at` falls inside the hours; always true for a store with none on file. */
export function withinHours(around: HoursAround, at: Date): boolean {
  return around.alwaysOpen || windowAt(around, at) !== null;
}

/** The window `at` falls in; null outside the hours and for a store open around the clock. */
export function windowAt(around: HoursAround, at: Date): HoursWindow | null {
  return around.windows.find((w) => w.start <= at && at < w.end) ?? null;
}

/**
 * When the window `at` falls in closes: null outside the hours, for a store
 * open around the clock and for one whose hours do not close within the
 * span looked at.
 */
export function closingAfter(around: HoursAround, at: Date): Date | null {
  const current = windowAt(around, at);
  if (!current || current.end >= around.to) return null;
  return current.end;
}

/** When the next window opens after `at`; null when nothing opens within the span looked at. */
export function openingAfter(around: HoursAround, at: Date): Date | null {
  return around.windows.find((w) => w.start > at)?.start ?? null;
}

/** When the last window ended at or before `at`; null when none did within the span looked at. */
export function closingBefore(around: HoursAround, at: Date): Date | null {
  let last: Date | null = null;
  for (const w of around.windows) {
    if (w.end <= at && w.end > around.from) last = w.end;
  }
  return last;
}
