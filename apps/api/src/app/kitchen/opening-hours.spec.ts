import {
  closingAfter,
  closingBefore,
  hoursAround,
  isOpenAt,
  localMoment,
  localToUtc,
  openingAfter,
  wallClock,
  withinHours,
  type WorkingHour,
} from './opening-hours';

/** 08:00–20:00 every day. */
function daily(opensAt: number, closesAt: number): WorkingHour[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt, closesAt, isClosed: false }));
}

describe('localMoment', () => {
  it('reads the wall clock in the store timezone, not UTC', () => {
    // 06:30 UTC is 10:30 in Dubai (UTC+4).
    const at = new Date('2026-08-22T06:30:00.000Z');
    expect(localMoment(at, 'Asia/Dubai')).toEqual({ weekday: 6, minutes: 10 * 60 + 30 });
    expect(localMoment(at, 'UTC')).toEqual({ weekday: 6, minutes: 6 * 60 + 30 });
  });

  it('follows daylight saving rather than a fixed offset', () => {
    // London is UTC+1 in August and UTC+0 in January.
    const summer = new Date('2026-08-22T12:00:00.000Z');
    const winter = new Date('2026-01-22T12:00:00.000Z');

    expect(localMoment(summer, 'Europe/London').minutes).toBe(13 * 60);
    expect(localMoment(winter, 'Europe/London').minutes).toBe(12 * 60);
  });

  it('rolls the weekday over when the timezone crosses midnight', () => {
    // Saturday 22:00 UTC is already Sunday 02:00 in Dubai.
    const at = new Date('2026-08-22T22:00:00.000Z');
    expect(localMoment(at, 'Asia/Dubai')).toEqual({ weekday: 0, minutes: 120 });
  });

  it('renders local midnight as minute zero, not 1440', () => {
    const at = new Date('2026-08-22T20:00:00.000Z'); // 00:00 Friday+1 in Dubai
    expect(localMoment(at, 'Asia/Dubai').minutes).toBe(0);
  });

  it('falls back to UTC for a timezone Node does not know', () => {
    const at = new Date('2026-08-22T06:30:00.000Z');
    expect(localMoment(at, 'Mars/Olympus')).toEqual({ weekday: 6, minutes: 6 * 60 + 30 });
  });
});

describe('isOpenAt', () => {
  it('treats a store with no hours on file as always open', () => {
    expect(isOpenAt([], new Date('2026-08-22T03:00:00.000Z'), 'UTC')).toBe(true);
  });

  it('accepts a time inside the window and rejects one outside', () => {
    const hours = daily(8 * 60, 20 * 60);
    expect(isOpenAt(hours, new Date('2026-08-22T09:00:00.000Z'), 'UTC')).toBe(true);
    expect(isOpenAt(hours, new Date('2026-08-22T03:00:00.000Z'), 'UTC')).toBe(false);
    expect(isOpenAt(hours, new Date('2026-08-22T21:00:00.000Z'), 'UTC')).toBe(false);
  });

  it('judges the window in the store timezone', () => {
    const hours = daily(8 * 60, 20 * 60);
    // 05:00 UTC is 09:00 in Dubai — open there, shut in London.
    const at = new Date('2026-08-22T05:00:00.000Z');
    expect(isOpenAt(hours, at, 'Asia/Dubai')).toBe(true);
    expect(isOpenAt(hours, at, 'Europe/London')).toBe(false);
  });

  it('is closed on a day flagged isClosed', () => {
    const hours = daily(8 * 60, 20 * 60).map((h) => (h.weekday === 0 ? { ...h, isClosed: true } : h));
    expect(isOpenAt(hours, new Date('2026-08-23T09:00:00.000Z'), 'UTC')).toBe(false); // Sunday
    expect(isOpenAt(hours, new Date('2026-08-24T09:00:00.000Z'), 'UTC')).toBe(true); // Monday
  });

  it('is closed on a weekday with no row at all', () => {
    const weekdaysOnly: WorkingHour[] = [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      opensAt: 8 * 60,
      closesAt: 20 * 60,
      isClosed: false,
    }));
    expect(isOpenAt(weekdaysOnly, new Date('2026-08-22T09:00:00.000Z'), 'UTC')).toBe(false); // Saturday
    expect(isOpenAt(weekdaysOnly, new Date('2026-08-21T09:00:00.000Z'), 'UTC')).toBe(true); // Friday
  });

  it('excludes the closing minute itself', () => {
    const hours = daily(8 * 60, 20 * 60);
    expect(isOpenAt(hours, new Date('2026-08-22T19:59:00.000Z'), 'UTC')).toBe(true);
    expect(isOpenAt(hours, new Date('2026-08-22T20:00:00.000Z'), 'UTC')).toBe(false);
  });

  it('includes the opening minute', () => {
    const hours = daily(8 * 60, 20 * 60);
    expect(isOpenAt(hours, new Date('2026-08-22T08:00:00.000Z'), 'UTC')).toBe(true);
    expect(isOpenAt(hours, new Date('2026-08-22T07:59:00.000Z'), 'UTC')).toBe(false);
  });

  describe('overnight shifts', () => {
    // 22:00 to 02:00 — closesAt is numerically below opensAt.
    const nightly = daily(22 * 60, 2 * 60);

    it('is open late on the same day', () => {
      expect(isOpenAt(nightly, new Date('2026-08-22T23:30:00.000Z'), 'UTC')).toBe(true);
    });

    it('is still open in the small hours of the next day', () => {
      expect(isOpenAt(nightly, new Date('2026-08-23T01:00:00.000Z'), 'UTC')).toBe(true);
    });

    it('is shut once the overnight window ends', () => {
      expect(isOpenAt(nightly, new Date('2026-08-23T03:00:00.000Z'), 'UTC')).toBe(false);
      expect(isOpenAt(nightly, new Date('2026-08-22T12:00:00.000Z'), 'UTC')).toBe(false);
    });

    it('does not carry over from a day the store was closed', () => {
      // Friday closed; Saturday 01:00 must not inherit Friday's night shift.
      const hours = nightly.map((h) => (h.weekday === 5 ? { ...h, isClosed: true } : h));
      expect(isOpenAt(hours, new Date('2026-08-22T01:00:00.000Z'), 'UTC')).toBe(false);
    });
  });
});

describe('working-hours windows', () => {
  const at = (iso: string) => new Date(iso);

  it('says when the current window closes and the next one opens, in the store timezone', () => {
    // 09:00–21:00 in Tiraspol (UTC+3 in October): 06:00–18:00 UTC.
    const hours = daily(9 * 60, 21 * 60);
    const noon = at('2026-10-14T09:00:00.000Z');
    const around = hoursAround(hours, 'Europe/Chisinau', noon);

    expect(withinHours(around, noon)).toBe(true);
    expect(closingAfter(around, noon)?.toISOString()).toBe('2026-10-14T18:00:00.000Z');

    const late = at('2026-10-14T20:50:00.000Z'); // 23:50 local — the manager's example
    const night = hoursAround(hours, 'Europe/Chisinau', late);
    expect(withinHours(night, late)).toBe(false);
    expect(closingAfter(night, late)).toBeNull();
    expect(openingAfter(night, late)?.toISOString()).toBe('2026-10-15T06:00:00.000Z');
    expect(closingBefore(night, late)?.toISOString()).toBe('2026-10-14T18:00:00.000Z');
  });

  it('runs an overnight window into the next day and merges back-to-back days into one', () => {
    const nightly = daily(22 * 60, 2 * 60);
    const around = hoursAround(nightly, 'UTC', at('2026-08-22T23:30:00.000Z'));
    expect(closingAfter(around, at('2026-08-22T23:30:00.000Z'))?.toISOString()).toBe('2026-08-23T02:00:00.000Z');

    // Open until midnight and from midnight: one window, closing at 02:00.
    const lateAndEarly: WorkingHour[] = [
      { weekday: 6, opensAt: 9 * 60, closesAt: 0, isClosed: false },
      { weekday: 0, opensAt: 0, closesAt: 2 * 60, isClosed: false },
    ];
    const saturday = at('2026-08-22T23:00:00.000Z');
    expect(closingAfter(hoursAround(lateAndEarly, 'UTC', saturday), saturday)?.toISOString()).toBe(
      '2026-08-23T02:00:00.000Z',
    );
  });

  it('has no closing for a store open around the clock, by default or by its hours', () => {
    const now = at('2026-08-22T12:00:00.000Z');
    const none = hoursAround([], 'UTC', now);
    expect(none.alwaysOpen).toBe(true);
    expect(withinHours(none, now)).toBe(true);
    expect(closingAfter(none, now)).toBeNull();

    const allDay = hoursAround(daily(0, 0), 'UTC', now);
    expect(withinHours(allDay, now)).toBe(true);
    expect(closingAfter(allDay, now)).toBeNull();
  });

  it('agrees with isOpenAt across a daylight-saving change', () => {
    const hours = daily(8 * 60, 20 * 60);
    // London leaves summer time on 2026-10-25: 08:00 local is 07:00 UTC before, 08:00 UTC after.
    const before = hoursAround(hours, 'Europe/London', at('2026-10-24T12:00:00.000Z'));
    expect(openingAfter(before, at('2026-10-24T20:00:00.000Z'))?.toISOString()).toBe('2026-10-25T08:00:00.000Z');
    for (const iso of ['2026-10-25T07:30:00.000Z', '2026-10-25T08:30:00.000Z', '2026-10-24T07:30:00.000Z']) {
      expect(withinHours(before, at(iso))).toBe(isOpenAt(hours, at(iso), 'Europe/London'));
    }
  });

  it('turns a local wall-clock time into an instant and back', () => {
    expect(localToUtc(2026, 10, 14, 9 * 60 + 15, 'Asia/Dubai').toISOString()).toBe('2026-10-14T05:15:00.000Z');
    expect(wallClock(at('2026-10-14T05:15:00.000Z'), 'Asia/Dubai')).toBe('09:15');
  });
});
