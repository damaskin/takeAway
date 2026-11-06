import { resolveDateRange } from './analytics-range';
import {
  CHURN_WINDOWS,
  type CustomerTotals,
  INACTIVE_MIN_ORDERS,
  churnAsOfDay,
  churnBounds,
  lapsedBefore,
  lostRevenueEstimate,
  percentChange,
  summarizeChurn,
  summarizeWinBack,
  visitInterval,
} from './retention';

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('churnBounds', () => {
  const start = new Date('2026-09-05T00:00:00Z');
  const end = new Date('2026-10-05T00:00:00Z');

  it('counts customers whose window ran out inside the period', () => {
    const bounds = churnBounds(start, end, 14, new Date('2026-12-01T00:00:00Z'));
    expect(bounds.asOf).toEqual(end);
    expect(bounds.lastOrderFrom.toISOString()).toBe('2026-08-22T00:00:00.000Z');
    expect(bounds.lastOrderBefore.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('stops at now while the period is still running', () => {
    const now = new Date('2026-10-01T09:00:00Z');
    const bounds = churnBounds(start, end, 7, now);
    expect(bounds.asOf).toEqual(now);
    expect(bounds.lastOrderBefore.toISOString()).toBe('2026-09-24T09:00:00.000Z');
  });

  it('puts the win-back line a window before the start', () => {
    expect(lapsedBefore(start, 7).toISOString()).toBe('2026-08-29T00:00:00.000Z');
  });
});

describe('summarizeChurn', () => {
  const bounds = churnBounds(new Date('2026-09-05T00:00:00Z'), new Date('2026-10-05T00:00:00Z'), 14, day('2026-12-01'));
  /** The period's last day in UTC: 4 October. */
  const asOfDay = churnAsOfDay(bounds.asOf, 'UTC');
  const options = { asOfDay, fallbackIntervalDays: null };
  const customer = (
    userId: string,
    last: string,
    orders: number,
    totalCents: number,
    visits = orders,
    firstVisitDay = last,
  ): CustomerTotals => ({
    userId,
    lastOrderAt: day(last),
    orders,
    totalCents,
    visits,
    firstVisitDay,
    lastVisitDay: last,
  });

  it('counts the lost, and each one’s days away ÷ usual interval × average check', () => {
    expect(asOfDay).toBe('2026-10-04');
    const summary = summarizeChurn(
      [
        // Every 40/9 days since 1 August, 5 000 a visit, 24 days away: 24 ÷ 4.44 × 5 000 = 27 000.
        customer('regular', '2026-09-10', 10, 50_000, 10, '2026-08-01'),
        // Every 10 days, 3 333 a visit, 40 days away: 4 visits missed = 13 332.
        customer('thrice', '2026-08-25', 3, 9_999, 3, '2026-08-05'),
        customer('recent', '2026-09-30', 4, 20_000, 4, '2026-09-01'), // came within the last 14 days: not lost
        customer('long-gone', '2026-08-01', 3, 9_000, 3, '2026-07-01'), // was lost before the period
      ],
      bounds,
      options,
    );
    expect(summary.count).toBe(2);
    expect(summary.customers.map((c) => [c.userId, c.lostRevenueCents])).toEqual([
      ['regular', 27_000],
      ['thrice', 13_332],
    ]);
    expect(summary.lostRevenueCents).toBe(27_000 + 13_332);
    expect(summary.customers[0]).toMatchObject({ daysSinceLastOrder: 24, avgCheckCents: 5_000, visits: 10 });
    expect(summary.customers[0]?.visitIntervalDays).toBeCloseTo(40 / 9, 10);
  });

  it('ports Maxim’s customer: ten visits from 24.09 to 07.10, 1.20 a check, eleven days away', () => {
    const period = churnBounds(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-19T00:00:00Z'),
      7,
      day('2026-12-01'),
    );
    const summary = summarizeChurn([customer('maxim', '2026-10-07', 10, 1_200, 10, '2026-09-24')], period, {
      asOfDay: churnAsOfDay(period.asOf, 'UTC'),
      fallbackIntervalDays: null,
    });
    const [only] = summary.customers;
    expect(only?.daysSinceLastOrder).toBe(11);
    expect(only?.visitIntervalDays).toBeCloseTo(13 / 9, 10);
    // 11 ÷ (13 ÷ 9) × 1.20 = 9.138… → 9.14
    expect(summary.lostRevenueCents).toBe(914);
  });

  it('counts several orders on one day as one visit for the interval, and averages the check per order', () => {
    // Six orders on three days from 21 August to 10 September: a visit every 10 days, 600 an order.
    const summary = summarizeChurn([customer('pairs', '2026-09-10', 6, 3_600, 3, '2026-08-21')], bounds, options);
    const [only] = summary.customers;
    expect(only?.visitIntervalDays).toBe(10);
    expect(only?.avgCheckCents).toBe(600);
    // 24 days away ÷ 10 × 600
    expect(only?.lostRevenueCents).toBe(1_440);
  });

  it('gives a customer who came once the stores’ usual interval, and 0 when nobody came twice', () => {
    // Three orders on the same day: a regular by orders, one visit.
    const once = customer('once', '2026-09-10', 3, 3_000, 1);
    const withBrand = summarizeChurn([once], bounds, { asOfDay, fallbackIntervalDays: 6 });
    expect(withBrand.customers[0]).toMatchObject({ visitIntervalDays: null, lostRevenueCents: 4_000 }); // 24 ÷ 6 × 1 000
    const withoutBrand = summarizeChurn([once], bounds, options);
    expect(withoutBrand.count).toBe(1);
    expect(withoutBrand.lostRevenueCents).toBe(0);
  });

  it('does not count somebody who ordered fewer than 3 times as inactive', () => {
    const summary = summarizeChurn(
      [customer('once', '2026-09-10', 1, 3_000), customer('twice', '2026-09-10', 2, 6_000)],
      bounds,
      options,
    );
    expect(INACTIVE_MIN_ORDERS).toBe(3);
    expect(summary).toEqual({ count: 0, lostRevenueCents: 0, customers: [] });
  });

  it('works with the 3-day window too', () => {
    const short = churnBounds(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z'), 3, day('2026-12-01'));
    expect(CHURN_WINDOWS).toEqual([3, 7, 14]);
    const summary = summarizeChurn(
      [customer('a', '2026-10-02', 5, 5_000, 5, '2026-09-20'), customer('b', '2026-10-06', 5, 5_000, 5, '2026-09-20')],
      short,
      { asOfDay: churnAsOfDay(short.asOf, 'UTC'), fallbackIntervalDays: null },
    );
    expect(summary.customers.map((c) => c.userId)).toEqual(['a']);
  });

  it('puts the biggest estimate first, not the biggest check', () => {
    const summary = summarizeChurn(
      [
        customer('rare-big', '2026-09-10', 3, 30_000, 3, '2026-07-12'), // every 30 days, 10 000: 8 000
        customer('daily-small', '2026-09-10', 20, 10_000, 20, '2026-08-22'), // daily, 500: 12 000
      ],
      bounds,
      options,
    );
    expect(summary.customers.map((c) => c.userId)).toEqual(['daily-small', 'rare-big']);
  });

  it('rounds each customer to the cent before summing', () => {
    // 24 days, every 7 days, 1 000 ÷ 3 a check: 1 142.857… → 1 143, twice.
    const row = (id: string) => customer(id, '2026-09-10', 3, 1_000, 3, '2026-08-27');
    const summary = summarizeChurn([row('a'), row('b')], bounds, options);
    expect(summary.customers.map((c) => c.lostRevenueCents)).toEqual([1_143, 1_143]);
    expect(summary.lostRevenueCents).toBe(2_286);
  });

  it('is zero without anyone lost', () => {
    expect(summarizeChurn([], bounds, options)).toEqual({ count: 0, lostRevenueCents: 0, customers: [] });
  });
});

describe('lostRevenueEstimate — Maxim’s numbers', () => {
  it('11 days away, a visit every 4 days, 1.20 a check: 3.30', () => {
    expect(lostRevenueEstimate({ daysAway: 11, intervalDays: 4, avgCheckCents: 120 })).toBe(330);
  });

  it('every 1.4 days instead: ≈ 9.43', () => {
    expect(lostRevenueEstimate({ daysAway: 11, intervalDays: 1.4, avgCheckCents: 120 })).toBe(943);
  });

  it('ten visits from 24.09.2026 to 07.10.2026: T = 13 ÷ 9 ≈ 1.44, not rounded', () => {
    const t = visitInterval(10, '2026-09-24', '2026-10-07');
    expect(t).toBeCloseTo(1.4444444444, 9);
    expect(lostRevenueEstimate({ daysAway: 11, intervalDays: t, avgCheckCents: 120 })).toBe(914);
  });

  it('rounds half up to the cent, through float noise', () => {
    expect(lostRevenueEstimate({ daysAway: 1, intervalDays: 2, avgCheckCents: 1 })).toBe(1);
    // 1 ÷ (10 ÷ 7) × 45 = 31.5 exactly, which floats compute as 31.499999…
    expect((1 / (10 / 7)) * 45).toBeLessThan(31.5);
    expect(lostRevenueEstimate({ daysAway: 1, intervalDays: 10 / 7, avgCheckCents: 45 })).toBe(32);
  });

  it('is 0 without an interval, days away or a check', () => {
    expect(lostRevenueEstimate({ daysAway: 11, intervalDays: null, avgCheckCents: 120 })).toBe(0);
    expect(lostRevenueEstimate({ daysAway: 0, intervalDays: 4, avgCheckCents: 120 })).toBe(0);
    expect(lostRevenueEstimate({ daysAway: 11, intervalDays: 4, avgCheckCents: 0 })).toBe(0);
  });
});

describe('visitInterval and churnAsOfDay', () => {
  it('has no interval for a single visit', () => {
    expect(visitInterval(1, '2026-10-07', '2026-10-07')).toBeNull();
    expect(visitInterval(2, '2026-10-01', '2026-10-05')).toBe(4);
  });

  it('takes the last day of a finished period, and today in the café’s zone while it runs', () => {
    const range = resolveDateRange({ from: '2026-09-28', to: '2026-10-04' }, 'Europe/Chisinau', 7);
    expect(churnAsOfDay(range.end, range.timeZone)).toBe('2026-10-04');
    // 00:30 in Chișinău on the 2nd is still the 1st in UTC.
    expect(churnAsOfDay(new Date('2026-10-01T21:30:00Z'), 'Europe/Chisinau')).toBe('2026-10-02');
  });
});

describe('summarizeWinBack', () => {
  it('counts who came back, their money and the share of the lapsed pool', () => {
    const summary = summarizeWinBack(40, [
      {
        userId: 'a',
        lastOrderBefore: day('2026-07-01'),
        returnedAt: day('2026-09-10'),
        orders: 3,
        revenueCents: 9_000,
      },
      {
        userId: 'b',
        lastOrderBefore: day('2026-08-01'),
        returnedAt: day('2026-09-02'),
        orders: 1,
        revenueCents: 12_000,
      },
    ]);
    expect(summary).toEqual(
      expect.objectContaining({
        lapsedAtStart: 40,
        returned: 2,
        returnRatePercent: 5,
        orders: 4,
        revenueCents: 21_000,
      }),
    );
    expect(summary.customers.map((c) => [c.userId, c.daysAway])).toEqual([
      ['b', 32],
      ['a', 71],
    ]);
  });

  it('has no rate with nobody to win back', () => {
    expect(summarizeWinBack(0, []).returnRatePercent).toBeNull();
  });
});

describe('percentChange', () => {
  it('compares with the period before, one decimal', () => {
    expect(percentChange(200, 250)).toBe(25);
    expect(percentChange(3, 2)).toBe(-33.3);
    expect(percentChange(0, 5)).toBeNull();
  });
});
