import { isOpenAt, localMoment, type WorkingHour } from './opening-hours';

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
