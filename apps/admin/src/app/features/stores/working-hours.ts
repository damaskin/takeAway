import type { StoreWorkingHourDto } from '../../core/catalog/admin-catalog.service';

/**
 * The working-hours editor's model and its translation to the API's rows.
 *
 * The API stores minutes since local midnight per weekday; the kitchen reads
 * *no rows* as "open around the clock". The editor used to pre-fill 09:00–21:00
 * over that, so a store that had never saved hours looked like it had them.
 * It now says so, and 24/7 is saved as seven explicit 00:00–24:00 rows.
 */

/** How a store's saved hours read in the editor. */
export type HoursMode = 'unset' | 'always' | 'schedule';

/** One weekday as `<input type="time">` gives it: `HH:MM`, or '' once cleared. */
export interface DayHours {
  isClosed: boolean;
  opens: string;
  closes: string;
}

export type DayProblem = 'missingTime' | 'sameTime';

/** JS weekday numbers (0 = Sunday), Monday first as the week reads here. */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

const DAYS = 7;
const MIDNIGHT = 24 * 60;

/** Offered when the owner switches an empty week to a schedule. */
export const TEMPLATE_DAY: Readonly<DayHours> = { isClosed: false, opens: '09:00', closes: '21:00' };

export const ALWAYS_OPEN_ROWS: readonly StoreWorkingHourDto[] = Array.from({ length: DAYS }, (_, weekday) => ({
  weekday,
  opensAt: 0,
  closesAt: MIDNIGHT,
  isClosed: false,
}));

export function hoursModeOf(rows: readonly StoreWorkingHourDto[]): HoursMode {
  if (rows.length === 0) return 'unset';
  const allDay =
    rows.length === DAYS &&
    rows.every((r) => !r.isClosed && r.opensAt === 0 && (r.closesAt === MIDNIGHT || r.closesAt === 0));
  return allDay ? 'always' : 'schedule';
}

/**
 * Seven days indexed by weekday. A weekday without a row is closed — that
 * is how the kitchen reads it — so it shows as a day off, not as open.
 */
export function daysFromRows(rows: readonly StoreWorkingHourDto[]): DayHours[] {
  return Array.from({ length: DAYS }, (_, weekday) => {
    if (rows.length === 0 || hoursModeOf(rows) === 'always') return { ...TEMPLATE_DAY };
    const row = rows.find((r) => r.weekday === weekday);
    if (!row) return { ...TEMPLATE_DAY, isClosed: true };
    return { isClosed: row.isClosed, opens: minutesToTime(row.opensAt), closes: minutesToTime(row.closesAt) };
  });
}

/** Closing at 00:00 means midnight at the end of the day (1440), not a zero-length shift. */
export function rowsFromDays(days: readonly DayHours[]): StoreWorkingHourDto[] {
  return days.map((day, weekday) => {
    const opensAt = timeToMinutes(day.opens) ?? 0;
    const closes = timeToMinutes(day.closes);
    const closesAt = closes === null || closes === 0 ? MIDNIGHT : closes;
    return { weekday, isClosed: day.isClosed, opensAt, closesAt };
  });
}

/** Why a day cannot be saved as it is, or null. A day off needs no times. */
export function dayProblem(day: DayHours): DayProblem | null {
  if (day.isClosed) return null;
  const opens = timeToMinutes(day.opens);
  const closes = timeToMinutes(day.closes);
  if (opens === null || closes === null) return 'missingTime';
  if (opens === closes) return 'sameTime';
  return null;
}

/** 22:00–02:00 runs into the next day; closing at 00:00 is midnight, not the next day. */
export function crossesMidnight(day: DayHours): boolean {
  if (day.isClosed) return false;
  const opens = timeToMinutes(day.opens);
  const closes = timeToMinutes(day.closes);
  if (opens === null || closes === null || closes === 0) return false;
  return closes < opens;
}

export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 1440 — midnight at the end of the day — reads as 00:00 again. */
export function minutesToTime(total: number): string {
  const minutes = ((total % MIDNIGHT) + MIDNIGHT) % MIDNIGHT;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
