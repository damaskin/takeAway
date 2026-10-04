import {
  formatMinutesOfDay,
  isStoreInactive,
  sortStoresByAvailability,
  storeAvailability,
  todaysOpeningHours,
} from './store';

describe('isStoreInactive', () => {
  it('is inactive while no shift is open', () => {
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

  it('takes orders for later only with a shift running after hours', () => {
    expect(storeAvailability({ status: 'OPEN', acceptingOrders: true, openNow: false })).toBe('scheduledOnly');
  });

  it('is closed without a shift, whatever the hours say', () => {
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
