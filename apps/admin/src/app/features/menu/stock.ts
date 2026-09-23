import { formatTime } from '@takeaway/utils';
import type { StopListEntryDto } from '../../core/catalog/admin-catalog.service';

/**
 * Whether a stop-list entry still keeps the product off sale. An entry with
 * a past `expiresAt` has restocked on its own — the customer menu and the
 * cart already treat it that way, so the editor must too.
 */
export function isStopActive(entry: Pick<StopListEntryDto, 'expiresAt'>, now: Date = new Date()): boolean {
  return entry.expiresAt === null || new Date(entry.expiresAt).getTime() > now.getTime();
}

/**
 * The next midnight in the store's own time zone, as an instant: when a
 * "sold out for today" mark should lift. The admin's browser may sit in
 * another zone than the café, so its local midnight would be wrong. Falls
 * back to the browser's midnight for an unknown zone.
 */
export function nextMidnightIn(timeZone: string | null | undefined, now: Date = new Date()): Date {
  try {
    const wall = wallClock(timeZone || 'UTC', now);
    const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
    return new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1) - offsetMs);
  } catch {
    const local = new Date(now);
    local.setHours(24, 0, 0, 0);
    return local;
  }
}

/** "23:59"-style time of an instant in the store's zone. */
export function formatStoreTime(iso: string, timeZone: string | null | undefined, locale: string): string {
  return formatTime(iso, locale, timeZone || 'UTC');
}

function wallClock(timeZone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}
