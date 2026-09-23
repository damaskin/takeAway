/**
 * Dates and times for people to read, in the UI language: Russian gets
 * 24-hour times ("09:00") and «23 сент. 2026, 05:33», English its own
 * "Sep 23, 2026, 5:33 AM".
 *
 * Every helper takes an optional IANA time zone. Pass the store's zone for
 * anything that happens at the store — a pickup time, an opening hour — so a
 * customer browsing from elsewhere sees the time on the café's clock. Without
 * one the viewer's own zone is used.
 */

import { isRussian } from './money';

export type DateInput = Date | string | number;

type DateStyle = 'time' | 'date' | 'dateTime' | 'dayMonth' | 'shortDay';

/** "09:00" / "9:00 AM". */
export function formatTime(value: DateInput, lang = 'ru', timeZone?: string | null): string {
  return format(value, 'time', lang, timeZone);
}

/** «23 сент. 2026» / "Sep 23, 2026". */
export function formatDate(value: DateInput, lang = 'ru', timeZone?: string | null): string {
  return format(value, 'date', lang, timeZone);
}

/** «23 сент. 2026, 05:33» / "Sep 23, 2026, 5:33 AM". */
export function formatDateTime(value: DateInput, lang = 'ru', timeZone?: string | null): string {
  return format(value, 'dateTime', lang, timeZone);
}

/** «23 сент.» / "Sep 23" — for lists and chart labels where the year goes without saying. */
export function formatDayMonth(value: DateInput, lang = 'ru', timeZone?: string | null): string {
  return format(value, 'dayMonth', lang, timeZone);
}

/** «23.09» / "9/23" — chart axes and other tight spots. */
export function formatShortDay(value: DateInput, lang = 'ru', timeZone?: string | null): string {
  return format(value, 'shortDay', lang, timeZone);
}

function format(value: DateInput, style: DateStyle, lang: string, timeZone: string | null | undefined): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const russian = isRussian(lang);
  const parts = formatter(style, lang, russian, timeZone ?? '').formatToParts(date);
  if (!russian) return parts.map((p) => p.value).join('');
  // CLDR writes a Russian year as «2026 г.»; in a compact date the suffix is noise.
  return parts
    .map((p, i) => (p.type === 'literal' && parts[i - 1]?.type === 'year' ? p.value.replace(/^\s*г\./, '') : p.value))
    .join('');
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(style: DateStyle, lang: string, russian: boolean, timeZone: string): Intl.DateTimeFormat {
  const key = `${lang}|${style}|${timeZone}`;
  let result = formatters.get(key);
  if (!result) {
    const options = styleOptions(style, russian);
    try {
      result = new Intl.DateTimeFormat(lang || 'ru', { ...options, timeZone: timeZone || undefined });
    } catch {
      // An unknown zone or language tag throws; the viewer's zone beats a blank.
      result = new Intl.DateTimeFormat(russian ? 'ru' : 'en', options);
    }
    formatters.set(key, result);
  }
  return result;
}

function styleOptions(style: DateStyle, russian: boolean): Intl.DateTimeFormatOptions {
  const time: Intl.DateTimeFormatOptions = { hour: russian ? '2-digit' : 'numeric', minute: '2-digit' };
  switch (style) {
    case 'time':
      return time;
    case 'date':
      return { day: 'numeric', month: 'short', year: 'numeric' };
    case 'dateTime':
      return { day: 'numeric', month: 'short', year: 'numeric', ...time };
    case 'dayMonth':
      return { day: 'numeric', month: 'short' };
    case 'shortDay':
      return russian ? { day: '2-digit', month: '2-digit' } : { day: 'numeric', month: 'numeric' };
  }
}
