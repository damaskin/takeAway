/**
 * Periods the settlements page offers. Settlement periods are calendar
 * stretches — a week from Monday, a month from the 1st — rather than "the
 * last N days", because a payout covers a closed period.
 */

export const SETTLEMENT_PRESETS = ['lastWeek', 'thisWeek', 'lastMonth', 'thisMonth'] as const;
export type SettlementPreset = (typeof SETTLEMENT_PRESETS)[number];

export interface DayRange {
  from: string;
  to: string;
}

/** The days of `preset` relative to `today` (`YYYY-MM-DD`), both included. */
export function presetRange(preset: SettlementPreset, today: string): DayRange {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (preset) {
    case 'thisWeek':
      return { from: mondayOf(today), to: today };
    case 'lastWeek': {
      const monday = addDays(mondayOf(today), -7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'thisMonth':
      return { from: isoDay(y, m, 1), to: today };
    case 'lastMonth':
      return { from: isoDay(y, m - 1, 1), to: isoDay(y, m, 0) };
  }
}

/** Today on the calendar of `timeZone` (the viewer's own when not given). */
export function todayIn(timeZone?: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone ?? undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return isoDay(y, m, d + n);
}

function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** Month and day may run over; `Date.UTC` carries them into the next unit. */
function isoDay(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}
