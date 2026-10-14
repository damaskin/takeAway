import {
  calendarDaysFrom,
  formatMinutesOfDay,
  groupSlotsByDay,
  isStoreInactive,
  sortStoresByAvailability,
  storeAvailability,
  storeHoursNote,
  todaysOpeningHours,
} from './store';

describe('isStoreInactive', () => {
  it('is inactive while nothing can be booked', () => {
    expect(isStoreInactive({ status: 'OPEN', acceptingOrders: false })).toBe(true);
  });

  it('is inactive when switched off, whatever the shift', () => {
    expect(isStoreInactive({ status: 'CLOSED', acceptingOrders: true })).toBe(true);
  });

  it('is active with a shift running, busy or not', () => {
    expect(isStoreInactive({ status: 'OPEN', acceptingOrders: true })).toBe(false);
    expect(isStoreInactive({ status: 'OVERLOADED', acceptingOrders: true })).toBe(false);
  });

  it('treats an API without shifts as active', () => {
    expect(isStoreInactive({ status: 'OPEN' })).toBe(false);
  });
});

describe('storeAvailability', () => {
  it('is open with a shift running inside working hours', () => {
    expect(storeAvailability({ status: 'OPEN', acceptingOrders: true, openNow: true })).toBe('open');
  });

  it('takes pre-orders only while closed for an order now (after hours, overnight)', () => {
    expect(storeAvailability({ status: 'OPEN', acceptingOrders: true, openNow: false })).toBe('scheduledOnly');
  });

  it('is closed when nothing can be booked, whatever the hours say', () => {
    expect(storeAvailability({ status: 'OPEN', acceptingOrders: false, openNow: false })).toBe('closed');
    expect(storeAvailability({ status: 'CLOSED', acceptingOrders: true, openNow: true })).toBe('closed');
  });

  it('keeps an API without the newer fields open', () => {
    expect(storeAvailability({ status: 'OPEN' })).toBe('open');
  });
});

describe('sortStoresByAvailability', () => {
  it('puts closed stores last and keeps the API order within each group', () => {
    const stores = [
      { id: 'closed-near', status: 'OPEN', acceptingOrders: false, openNow: false },
      { id: 'open-near', status: 'OPEN', acceptingOrders: true, openNow: true },
      { id: 'later', status: 'OPEN', acceptingOrders: true, openNow: false },
      { id: 'switched-off', status: 'CLOSED', openNow: false },
      { id: 'open-far', status: 'OVERLOADED', acceptingOrders: true, openNow: true },
    ];
    expect(sortStoresByAvailability(stores).map((s) => s.id)).toEqual([
      'open-near',
      'open-far',
      'later',
      'closed-near',
      'switched-off',
    ]);
  });

  it('leaves the input untouched', () => {
    const stores = [
      { status: 'CLOSED', openNow: false },
      { status: 'OPEN', openNow: true },
    ];
    sortStoresByAvailability(stores);
    expect(stores[0]?.status).toBe('CLOSED');
  });
});

describe('todaysOpeningHours', () => {
  // Saturday 2026-10-03 23:30 UTC is already Sunday in Tiraspol (UTC+3).
  const now = new Date('2026-10-03T23:30:00Z');
  const week = [
    { weekday: 0, opensAt: 600, closesAt: 1080, isClosed: false },
    { weekday: 6, opensAt: 480, closesAt: 1200, isClosed: false },
  ];

  it("reads today's window on the store's own clock", () => {
    expect(todaysOpeningHours(week, 'Europe/Chisinau', now)).toEqual({ opensAt: 600, closesAt: 1080 });
    expect(todaysOpeningHours(week, 'UTC', now)).toEqual({ opensAt: 480, closesAt: 1200 });
  });

  it('calls a day without hours, or one marked closed, a day off', () => {
    const mondayOnly = [{ weekday: 1, opensAt: 480, closesAt: 1200, isClosed: false }];
    expect(todaysOpeningHours(mondayOnly, 'UTC', now)).toBe('dayOff');
    const saturdayOff = [{ weekday: 6, opensAt: 0, closesAt: 0, isClosed: true }];
    expect(todaysOpeningHours(saturdayOff, 'UTC', now)).toBe('dayOff');
  });

  it('has nothing to say when no hours are on file', () => {
    expect(todaysOpeningHours([], 'UTC', now)).toBeNull();
    expect(todaysOpeningHours(undefined, 'UTC', now)).toBeNull();
  });

  it('falls back to the viewer zone for an unknown one', () => {
    expect(todaysOpeningHours(week, 'Mars/Olympus', now)).not.toBeNull();
  });
});

describe('formatMinutesOfDay', () => {
  it('writes a 24-hour wall-clock time', () => {
    expect(formatMinutesOfDay(480)).toBe('08:00');
    expect(formatMinutesOfDay(1305)).toBe('21:45');
    expect(formatMinutesOfDay(0)).toBe('00:00');
    expect(formatMinutesOfDay(1440)).toBe('00:00');
  });
});

describe('calendarDaysFrom', () => {
  // 22:30 UTC on the 14th is already 01:30 on the 15th in Tiraspol (UTC+3).
  const now = new Date('2026-10-14T22:30:00Z');

  it("counts days on the store's clock, not the viewer's", () => {
    expect(calendarDaysFrom('2026-10-15T06:00:00Z', now, 'Europe/Chisinau')).toBe(0);
    expect(calendarDaysFrom('2026-10-15T06:00:00Z', now, 'UTC')).toBe(1);
    expect(calendarDaysFrom('2026-10-16T06:00:00Z', now, 'Europe/Chisinau')).toBe(1);
    expect(calendarDaysFrom('2026-10-14T10:00:00Z', now, 'Europe/Chisinau')).toBe(-1);
  });

  it('reads a bad date as today', () => {
    expect(calendarDaysFrom('soon', now, 'UTC')).toBe(0);
  });
});

describe('storeHoursNote', () => {
  // 01:00 in Tiraspol on Thursday 15 October.
  const now = new Date('2026-10-14T22:00:00Z');
  const base = { status: 'OPEN', timezone: 'Europe/Chisinau' };

  it('names the opening time while closed and taking pre-orders', () => {
    expect(
      storeHoursNote(
        {
          ...base,
          acceptingOrders: true,
          openNow: false,
          asapBlockedReason: 'OUTSIDE_HOURS',
          opensAt: '2026-10-15T06:00:00Z',
        },
        now,
      ),
    ).toEqual({ kind: 'opens', at: '2026-10-15T06:00:00Z', days: 0 });
  });

  it('says tomorrow when the store opens on the next calendar day', () => {
    const evening = new Date('2026-10-14T19:30:00Z');
    expect(
      storeHoursNote(
        {
          ...base,
          acceptingOrders: true,
          openNow: false,
          asapBlockedReason: 'OUTSIDE_HOURS',
          opensAt: '2026-10-15T06:00:00Z',
        },
        evening,
      ),
    ).toEqual({ kind: 'opens', at: '2026-10-15T06:00:00Z', days: 1 });
  });

  it('offers pre-orders when the queue is full, and without an opening time', () => {
    expect(
      storeHoursNote({ ...base, acceptingOrders: true, openNow: false, asapBlockedReason: 'QUEUE_FULL' }, now),
    ).toEqual({
      kind: 'queueFull',
    });
    expect(
      storeHoursNote({ ...base, acceptingOrders: true, openNow: false, asapBlockedReason: 'SHIFT_CLOSED' }, now),
    ).toEqual({
      kind: 'preorder',
    });
  });

  it('says until when while open, and nothing without a closing time', () => {
    expect(
      storeHoursNote({ ...base, acceptingOrders: true, openNow: true, closesAt: '2026-10-15T18:00:00Z' }, now),
    ).toEqual({
      kind: 'until',
      at: '2026-10-15T18:00:00Z',
    });
    expect(storeHoursNote({ ...base, acceptingOrders: true, openNow: true, closesAt: null }, now)).toBeNull();
    expect(storeHoursNote({ ...base, openNow: true }, now)).toBeNull();
  });

  it('adds nothing for a store that takes no orders at all', () => {
    expect(
      storeHoursNote({ ...base, acceptingOrders: false, openNow: false, opensAt: '2026-10-17T06:00:00Z' }, now),
    ).toBeNull();
    expect(storeHoursNote({ status: 'CLOSED', acceptingOrders: true, openNow: false }, now)).toBeNull();
  });
});

describe('groupSlotsByDay', () => {
  it("splits the 24-hour window at midnight on the store's clock", () => {
    const now = new Date('2026-10-14T19:00:00Z'); // 22:00 in Tiraspol
    const slots = ['2026-10-14T19:30:00Z', '2026-10-14T20:45:00Z', '2026-10-15T06:00:00Z', '2026-10-15T06:15:00Z'].map(
      (startsAt) => ({ startsAt }),
    );
    expect(groupSlotsByDay(slots, now, 'Europe/Chisinau').map((d) => [d.days, d.slots.length])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(groupSlotsByDay([], now, 'UTC')).toEqual([]);
  });
});
