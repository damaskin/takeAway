import { formatDate, formatDateTime, formatDayMonth, formatShortDay, formatTime } from './date-time';

// 05:33 in Chișinău (UTC+3 in September), 02:33 UTC.
const AT = '2026-09-23T02:33:00Z';
const CHISINAU = 'Europe/Chisinau';

// Intl puts a narrow no-break space before AM/PM in English.
const ampm = (s: string) => s.replace(/\u202f/g, ' ');

describe('formatTime', () => {
  it('uses the 24-hour clock with a leading zero in Russian', () => {
    expect(formatTime(AT, 'ru', CHISINAU)).toBe('05:33');
    expect(formatTime('2026-09-23T18:00:00Z', 'ru', CHISINAU)).toBe('21:00');
  });

  it('uses the 12-hour clock in English', () => {
    expect(ampm(formatTime(AT, 'en', CHISINAU))).toBe('5:33 AM');
  });

  it('renders in the given zone rather than the viewer’s', () => {
    expect(formatTime(AT, 'ru', 'UTC')).toBe('02:33');
    expect(formatTime(AT, 'ru', 'Asia/Dubai')).toBe('06:33');
  });

  it('accepts dates and epoch milliseconds', () => {
    expect(formatTime(new Date(AT), 'ru', CHISINAU)).toBe('05:33');
    expect(formatTime(Date.parse(AT), 'ru', CHISINAU)).toBe('05:33');
  });

  it('falls back to the viewer’s zone for an unknown one instead of throwing', () => {
    expect(formatTime(AT, 'ru', 'Mars/Olympus')).toMatch(/^\d{2}:33$/);
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatTime('not a date', 'ru')).toBe('');
  });
});

describe('formatDate', () => {
  it('writes the Russian date without the «г.» suffix', () => {
    expect(formatDate(AT, 'ru', CHISINAU)).toBe('23 сент. 2026');
  });

  it('writes the English date the English way', () => {
    expect(formatDate(AT, 'en', CHISINAU)).toBe('Sep 23, 2026');
  });

  it('takes the calendar day from the zone', () => {
    expect(formatDate('2026-09-22T22:30:00Z', 'ru', CHISINAU)).toBe('23 сент. 2026');
    expect(formatDate('2026-09-22T22:30:00Z', 'ru', 'UTC')).toBe('22 сент. 2026');
  });
});

describe('formatDateTime', () => {
  it('joins date and time', () => {
    expect(formatDateTime(AT, 'ru', CHISINAU)).toBe('23 сент. 2026, 05:33');
    expect(ampm(formatDateTime(AT, 'en', CHISINAU))).toBe('Sep 23, 2026, 5:33 AM');
  });
});

describe('formatDayMonth', () => {
  it('leaves the year out', () => {
    expect(formatDayMonth(AT, 'ru', CHISINAU)).toBe('23 сент.');
    expect(formatDayMonth(AT, 'en', CHISINAU)).toBe('Sep 23');
  });
});

describe('formatShortDay', () => {
  it('writes day and month as numbers, in each language’s order', () => {
    expect(formatShortDay('2026-09-03', 'ru', 'UTC')).toBe('03.09');
    expect(formatShortDay('2026-09-03', 'en', 'UTC')).toBe('9/3');
  });
});
