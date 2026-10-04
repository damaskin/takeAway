import {
  type CustomerTotals,
  churnBounds,
  lapsedBefore,
  percentChange,
  summarizeChurn,
  summarizeWinBack,
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
  const customer = (userId: string, last: string, orders: number, totalCents: number): CustomerTotals => ({
    userId,
    lastOrderAt: day(last),
    orders,
    totalCents,
  });

  it('counts the lost and what their average checks add up to', () => {
    const summary = summarizeChurn(
      [
        customer('regular', '2026-09-10', 10, 50_000), // avg 5 000, gone since the 10th
        customer('once', '2026-08-25', 1, 3_333), // avg 3 333
        customer('recent', '2026-09-30', 4, 20_000), // came within the last 14 days: not lost
        customer('long-gone', '2026-08-01', 3, 9_000), // was lost before the period
      ],
      bounds,
    );
    expect(summary.count).toBe(2);
    expect(summary.lostRevenueCents).toBe(5_000 + 3_333);
    expect(summary.customers.map((c) => c.userId)).toEqual(['regular', 'once']);
    expect(summary.customers[0]?.daysSinceLastOrder).toBe(24);
  });

  it('rounds each average check to the cent before summing', () => {
    const summary = summarizeChurn([customer('a', '2026-09-10', 3, 1_000)], bounds);
    expect(summary.lostRevenueCents).toBe(333);
  });

  it('is zero without anyone lost', () => {
    expect(summarizeChurn([], bounds)).toEqual({ count: 0, lostRevenueCents: 0, customers: [] });
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
