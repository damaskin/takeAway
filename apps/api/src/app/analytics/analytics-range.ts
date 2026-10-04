import { BadRequestException } from '@nestjs/common';

/** A calendar day, `YYYY-MM-DD`. */
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Longest range one request may cover. */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60_000;

/**
 * A period of whole calendar days in one time zone, and the period of the
 * same length right before it — what every figure is compared with.
 *
 * `from` and `to` are local days, both included; `start`/`end` are the
 * instants they open and close at, `end` exclusive (the local midnight after
 * `to`). A day in a café's zone is not a UTC day: in Chișinău the evening
 * rush after 21:00 UTC already belongs to tomorrow.
 */
export interface DateRange {
  from: string;
  to: string;
  days: number;
  timeZone: string;
  start: Date;
  end: Date;
  previous: { from: string; to: string; start: Date; end: Date };
}

export interface RangeInput {
  from?: string | null;
  to?: string | null;
  days?: number | null;
}

/**
 * Reads `from`/`to` (calendar days in `timeZone`) or, for older clients,
 * `days` — that many days ending today. `from` alone runs to today, `to`
 * alone reaches `days` (or `defaultDays`) back. Out-of-range `days` are
 * clamped as they always were; a malformed or reversed range is a 400.
 */
export function resolveDateRange(
  input: RangeInput,
  timeZone: string,
  defaultDays: number,
  now: Date = new Date(),
): DateRange {
  const from = input.from ? parseDay(input.from, 'from') : null;
  const to = input.to ? parseDay(input.to, 'to') : null;
  const length = clampDays(input.days ?? defaultDays);
  const today = localDay(now, timeZone);

  let first: string;
  let last: string;
  if (from && to) {
    if (from > to) throw new BadRequestException('from must not be after to');
    first = from;
    last = to;
  } else if (from) {
    first = from;
    last = from > today ? from : today;
  } else if (to) {
    last = to;
    first = addDays(to, -(length - 1));
  } else {
    last = today;
    first = addDays(today, -(length - 1));
  }

  const days = daysBetween(first, last) + 1;
  if (days > MAX_RANGE_DAYS) throw new BadRequestException(`A range covers at most ${MAX_RANGE_DAYS} days`);

  const previousTo = addDays(first, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return {
    from: first,
    to: last,
    days,
    timeZone,
    start: startOfDay(first, timeZone),
    end: startOfDay(addDays(last, 1), timeZone),
    previous: {
      from: previousFrom,
      to: previousTo,
      start: startOfDay(previousFrom, timeZone),
      end: startOfDay(first, timeZone),
    },
  };
}

/** The calendar day `instant` falls on in `timeZone`. */
export function localDay(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** The instant local midnight opens `day` in `timeZone`, daylight saving included. */
export function startOfDay(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d);
  // Take the zone's offset at the naive guess, then once more at the result:
  // the second pass settles the days a clock change falls on.
  let instant = asUtc - offsetMs(new Date(asUtc), timeZone);
  const corrected = asUtc - offsetMs(new Date(instant), timeZone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Local wall-clock time minus UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

function parseDay(value: string, field: 'from' | 'to'): string {
  if (!ISO_DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException(`${field} must be a date like 2026-10-04`);
  }
  // Date.parse rolls 2026-02-30 over to March; a day that does not exist is a typo.
  if (addDays(value, 0) !== value) throw new BadRequestException(`${field} must be a date like 2026-10-04`);
  return value;
}

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_RANGE_DAYS, Math.max(1, Math.round(value)));
}
