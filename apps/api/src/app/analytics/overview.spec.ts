import { resolveDateRange } from './analytics-range';
import {
  type GroupTotalsRow,
  breakdown,
  countActive,
  dailySeries,
  loadByHour,
  loadByWeekday,
  newCustomerTotals,
  overviewPeriod,
  pickCurrency,
  share,
  statusCounts,
  totalsFrom,
} from './overview';

const WEEK = resolveDateRange({ from: '2026-09-28', to: '2026-10-04' }, 'Europe/Chisinau', 30);

function row(key: string | null, current: boolean, over: Partial<GroupTotalsRow> = {}): GroupTotalsRow {
  return {
    key,
    current,
    orders: 0,
    revenue: 0,
    commission: 0,
    placed: 0,
    cancelled: 0,
    expired: 0,
    pickupSecSum: 0,
    pickupCount: 0,
    customers: 0,
    ...over,
  };
}

describe('overviewPeriod', () => {
  it('names the period and the equal one right before it', () => {
    expect(overviewPeriod(WEEK)).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
      days: 7,
      timeZone: 'Europe/Chisinau',
      previousFrom: '2026-09-21',
      previousTo: '2026-09-27',
    });
  });
});

describe('totalsFrom', () => {
  it('derives the check, the cancel rate and the pickup time', () => {
    const totals = totalsFrom(
      row(null, true, {
        orders: 4,
        revenue: 17_000,
        commission: 2550.4,
        placed: 6,
        cancelled: 1,
        expired: 1,
        pickupSecSum: 300,
        pickupCount: 2,
        customers: 3,
      }),
      2,
      2,
    );
    expect(totals).toEqual({
      revenueCents: 17_000,
      orders: 4,
      placed: 6,
      customers: 3,
      newCustomers: 2,
      avgCheckCents: 4250,
      cancelled: 1,
      expired: 1,
      cancelRatePercent: 33.3,
      avgPickupSeconds: 150,
      activeUnits: 2,
      commissionCents: 2550,
    });
  });

  it('is all zeros and blanks for a period without orders', () => {
    const totals = totalsFrom(undefined, 0, 0);
    expect(totals.revenueCents).toBe(0);
    expect(totals.avgCheckCents).toBeNull();
    expect(totals.cancelRatePercent).toBeNull();
    expect(totals.avgPickupSeconds).toBeNull();
  });
});

describe('newCustomerTotals', () => {
  it('splits first orders between the two periods by local day', () => {
    const totals = newCustomerTotals(WEEK, [
      { day: '2026-09-21', customers: 2 },
      { day: '2026-09-27', customers: 1 },
      { day: '2026-09-28', customers: 3 },
      { day: '2026-10-04', customers: 1 },
      { day: '2026-10-05', customers: 9 },
    ]);
    expect(totals).toEqual({ current: 4, previous: 3 });
  });
});

describe('dailySeries', () => {
  it('lists every day of the period, zero where nothing happened', () => {
    const days = dailySeries(
      WEEK,
      [{ day: '2026-09-30', orders: 2, revenue: 900, commission: 135.2, customers: 2, cancelled: 1, expired: 0 }],
      [
        { day: '2026-09-30', customers: 1 },
        { day: '2026-09-25', customers: 5 },
      ],
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({
      date: '2026-09-28',
      revenueCents: 0,
      orders: 0,
      customers: 0,
      newCustomers: 0,
      cancelled: 0,
      expired: 0,
      commissionCents: 0,
    });
    expect(days[2]).toEqual({
      date: '2026-09-30',
      revenueCents: 900,
      orders: 2,
      customers: 2,
      newCustomers: 1,
      cancelled: 1,
      expired: 0,
      commissionCents: 135,
    });
    expect(days[6]?.date).toBe('2026-10-04');
  });
});

describe('load buckets', () => {
  const rows = [
    { hour: 8, weekday: 1, orders: 3, revenue: 300 },
    { hour: 8, weekday: 5, orders: 2, revenue: 200 },
    { hour: 23, weekday: 7, orders: 1, revenue: 100 },
  ];

  it('folds weekdays into 24 hours', () => {
    const hours = loadByHour(rows);
    expect(hours).toHaveLength(24);
    expect(hours[8]).toEqual({ hour: 8, orders: 5, revenueCents: 500 });
    expect(hours[23]?.orders).toBe(1);
    expect(hours[0]?.orders).toBe(0);
  });

  it('folds hours into Monday to Sunday', () => {
    const days = loadByWeekday(rows);
    expect(days.map((d) => d.orders)).toEqual([3, 0, 0, 0, 2, 0, 1]);
    expect(days[0]?.weekday).toBe(1);
    expect(days[6]?.weekday).toBe(7);
  });
});

describe('statusCounts', () => {
  it('lists every status, zero where nothing matched', () => {
    const counts = statusCounts([
      { status: 'PICKED_UP', count: 4 },
      { status: 'EXPIRED', count: 1 },
    ]);
    expect(Object.keys(counts)).toHaveLength(10);
    expect(counts['PICKED_UP']).toBe(4);
    expect(counts['EXPIRED']).toBe(1);
    expect(counts['PAID']).toBe(0);
  });
});

describe('breakdown', () => {
  const units = [
    { id: 's1', name: 'Center' },
    { id: 's2', name: 'Mall' },
    { id: 's3', name: 'Idle' },
  ];
  const rows = [
    row(null, true, { orders: 4, revenue: 17_000 }),
    row('s1', true, {
      orders: 3,
      revenue: 10_000,
      placed: 4,
      expired: 1,
      customers: 2,
      pickupSecSum: 120,
      pickupCount: 1,
    }),
    row('s2', true, { orders: 1, revenue: 7_000, placed: 2, cancelled: 1, customers: 1 }),
    row('s1', false, { orders: 2, revenue: 5_000 }),
  ];

  it('puts every unit side by side with its share, highest revenue first', () => {
    const out = breakdown(units, rows, true);
    expect(out.map((r) => [r.name, r.revenueCents, r.sharePercent, r.ordersSharePercent])).toEqual([
      ['Center', 10_000, 58.8, 75],
      ['Mall', 7_000, 41.2, 25],
      ['Idle', 0, 0, 0],
    ]);
    // Shares add up to the whole.
    expect(out.reduce((sum, r) => sum + r.sharePercent, 0)).toBeCloseTo(100, 5);
  });

  it('compares each unit with the period before on PRO', () => {
    const [center, mall, idle] = breakdown(units, rows, true);
    expect(center).toEqual(
      expect.objectContaining({
        detailed: true,
        previousRevenueCents: 5_000,
        previousOrders: 2,
        revenueDeltaPercent: 100,
        avgCheckCents: 3333,
        customers: 2,
        cancelRatePercent: 25,
        avgPickupSeconds: 120,
      }),
    );
    // Nothing before: no percentage to show, but the money is there.
    expect(mall?.revenueDeltaPercent).toBeNull();
    expect(mall?.previousRevenueCents).toBe(0);
    expect(mall?.cancelled).toBe(1);
    expect(idle?.avgCheckCents).toBeNull();
    expect(idle?.cancelRatePercent).toBeNull();
  });

  it('keeps only revenue, orders and shares on BASIC', () => {
    const [center] = breakdown(units, rows, false);
    expect(center).toEqual({
      id: 's1',
      name: 'Center',
      revenueCents: 10_000,
      orders: 3,
      sharePercent: 58.8,
      ordersSharePercent: 75,
      detailed: false,
      previousRevenueCents: null,
      previousOrders: null,
      revenueDeltaPercent: null,
      avgCheckCents: null,
      customers: null,
      cancelled: null,
      expired: null,
      cancelRatePercent: null,
      avgPickupSeconds: null,
    });
  });

  it('counts units with a counted order in each period', () => {
    expect(countActive(rows, true)).toBe(2);
    expect(countActive(rows, false)).toBe(1);
  });
});

describe('share', () => {
  it('is zero of nothing', () => {
    expect(share(5, 0)).toBe(0);
    expect(share(1, 3)).toBe(33.3);
  });
});

describe('pickCurrency', () => {
  const brands = [
    { currency: 'MDL', revenue: 100 },
    { currency: 'MDL', revenue: 0 },
    { currency: 'RUP', revenue: 500 },
  ];

  it('opens on the currency that sold the most', () => {
    expect(pickCurrency(brands)).toBe('RUP');
  });

  it('takes a requested currency that some brand uses', () => {
    expect(pickCurrency(brands, 'MDL')).toBe('MDL');
    expect(pickCurrency(brands, 'EUR')).toBe('RUP');
  });

  it('falls back to the currency most brands use when nothing sold', () => {
    expect(
      pickCurrency([
        { currency: 'RUP', revenue: 0 },
        { currency: 'MDL', revenue: 0 },
        { currency: 'MDL', revenue: 0 },
      ]),
    ).toBe('MDL');
    expect(pickCurrency([])).toBeNull();
  });
});
