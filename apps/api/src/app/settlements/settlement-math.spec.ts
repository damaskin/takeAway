import {
  commissionCents,
  computeSettlement,
  emptyTotals,
  periodFigures,
  planPayout,
  rateSpans,
  settleOrder,
  settlementBalance,
  type LedgerPayout,
  type SettlementOrderRow,
} from './settlement-math';

const at = (iso: string) => new Date(iso);
/** Days in UTC keep the tests readable; the service passes the brand's zone. */
const utcDay = (instant: Date) => instant.toISOString().slice(0, 10);
const nextDay = (day: string) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000));

function order(overrides: Partial<SettlementOrderRow> = {}): SettlementOrderRow {
  return {
    id: 'o',
    settledAt: at('2026-10-02T10:00:00Z'),
    subtotalCents: 0,
    discountCents: 0,
    pointsDiscountCents: 0,
    giftCardCents: 0,
    deliveryFeeCents: 0,
    totalCents: 0,
    capturedCents: 0,
    refundedCents: 0,
    hasCapture: false,
    ...overrides,
  };
}

/**
 * The worked example of docs/settlements.md, a PRO brand at 15 %, prices in
 * Transnistrian roubles (kopecks).
 */
const EXAMPLE: SettlementOrderRow[] = [
  // A — latte and croissant, 75 руб., paid by card.
  order({ id: 'A', subtotalCents: 7500, totalCents: 7500, capturedCents: 7500, hasCapture: true }),
  // B — a free coffee on a promo code: shows as 0 руб., no card payment at all.
  order({ id: 'B', subtotalCents: 4000, discountCents: 4000, totalCents: 0 }),
  // C — 120 руб., 50 of them from a gift card the brand sold, 70 by card.
  order({
    id: 'C',
    subtotalCents: 12000,
    giftCardCents: 5000,
    totalCents: 7000,
    capturedCents: 7000,
    hasCapture: true,
  }),
  // D — 60 руб., 10 of them in loyalty points, 50 by card.
  order({
    id: 'D',
    subtotalCents: 6000,
    discountCents: 1000,
    pointsDiscountCents: 1000,
    totalCents: 5000,
    capturedCents: 5000,
    hasCapture: true,
  }),
  // E — 33,33 руб. by card, 10 руб. of it refunded.
  order({
    id: 'E',
    subtotalCents: 3333,
    totalCents: 3333,
    capturedCents: 3333,
    refundedCents: 1000,
    hasCapture: true,
  }),
];

describe('commissionCents', () => {
  it('rounds half up to a whole cent', () => {
    expect(commissionCents(7500, 1500)).toBe(1125);
    expect(commissionCents(2333, 1500)).toBe(350); // 349.95
    expect(commissionCents(10, 1500)).toBe(2); // 1.5
    expect(commissionCents(3, 1500)).toBe(0); // 0.45
    expect(commissionCents(1, 5000)).toBe(1); // 0.5
    expect(commissionCents(0, 1500)).toBe(0);
  });

  it('stays exact on large amounts', () => {
    // 9 999 999,99 at 12.5 %: 1 249 999,99875 → 1 250 000,00.
    expect(commissionCents(999_999_999, 1250)).toBe(125_000_000);
  });

  it('refuses a fractional or negative base and an impossible rate', () => {
    expect(() => commissionCents(10.5, 1500)).toThrow(RangeError);
    expect(() => commissionCents(-1, 1500)).toThrow(RangeError);
    expect(() => commissionCents(100, 10_001)).toThrow(RangeError);
    expect(() => commissionCents(100, 12.5)).toThrow(RangeError);
  });
});

describe('settleOrder', () => {
  it('charges commission on the card money only', () => {
    const [a, b, c, d, e] = EXAMPLE.map((row) => settleOrder(row, 1500));
    expect(a).toMatchObject({ commissionBaseCents: 7500, commissionCents: 1125, payableCents: 6375 });
    // A promo order the customer paid nothing for: nothing came in, nothing is owed.
    expect(b).toMatchObject({
      cardOrders: 0,
      zeroTotalOrders: 1,
      salesCents: 4000,
      promoDiscountCents: 4000,
      commissionBaseCents: 0,
      payableCents: 0,
    });
    // The gift-card share was paid to the brand when it sold the card.
    expect(c).toMatchObject({
      giftCardCents: 5000,
      commissionBaseCents: 7000,
      commissionCents: 1050,
      payableCents: 5950,
    });
    // Points are a discount of their own, not a promo.
    expect(d).toMatchObject({
      promoDiscountCents: 0,
      pointsDiscountCents: 1000,
      commissionCents: 750,
      payableCents: 4250,
    });
    expect(e).toMatchObject({
      refundedCents: 1000,
      commissionBaseCents: 2333,
      commissionCents: 350,
      payableCents: 1983,
    });
  });

  it('counts an accepted order with nothing paid through the platform as unpaid', () => {
    const settled = settleOrder(order({ subtotalCents: 5000, totalCents: 5000 }), 1500);
    expect(settled).toMatchObject({ unpaidOrders: 1, unpaidTotalCents: 5000, capturedCents: 0, payableCents: 0 });
  });

  it('nets a full refund to nothing', () => {
    const settled = settleOrder(
      order({ totalCents: 5000, capturedCents: 5000, refundedCents: 5000, hasCapture: true }),
      1500,
    );
    expect(settled).toMatchObject({ cardOrders: 1, commissionBaseCents: 0, commissionCents: 0, payableCents: 0 });
  });

  it('never lets a refund exceed the captured money', () => {
    const settled = settleOrder(order({ capturedCents: 1000, refundedCents: 1500, hasCapture: true }), 1500);
    expect(settled).toMatchObject({ refundedCents: 1000, commissionBaseCents: 0 });
  });
});

describe('computeSettlement', () => {
  const window = {
    start: at('2026-10-01T00:00:00Z'),
    end: at('2026-10-04T00:00:00Z'),
    days: ['2026-10-01', '2026-10-02', '2026-10-03'],
  };

  it('adds up the worked example', () => {
    const result = computeSettlement(EXAMPLE, [], 1500, window, utcDay);
    expect(result.totals).toEqual({
      ...emptyTotals(),
      orders: 5,
      cardOrders: 4,
      zeroTotalOrders: 1,
      salesCents: 32833,
      promoDiscountCents: 4000,
      pointsDiscountCents: 1000,
      giftCardCents: 5000,
      capturedCents: 22833,
      refundedCents: 1000,
      commissionBaseCents: 21833,
      commissionCents: 3275,
      payableCents: 18558,
    });
  });

  it('lists every day, empty ones too, and the days add up to the period', () => {
    const rows = [
      order({ id: '1', settledAt: at('2026-10-01T09:00:00Z'), capturedCents: 333, hasCapture: true }),
      order({ id: '2', settledAt: at('2026-10-01T18:00:00Z'), capturedCents: 333, hasCapture: true }),
      order({ id: '3', settledAt: at('2026-10-03T09:00:00Z'), capturedCents: 333, hasCapture: true }),
    ];
    const result = computeSettlement(rows, [], 1500, window, utcDay);
    expect(result.days.map((d) => [d.date, d.orders, d.commissionCents])).toEqual([
      ['2026-10-01', 2, 100],
      ['2026-10-02', 0, 0],
      ['2026-10-03', 1, 50],
    ]);
    // Each order rounds on its own (49.95 → 50), so the days add up to exactly what the period says.
    expect(result.totals.commissionCents).toBe(150);
    expect(result.totals.commissionCents).toBe(result.days.reduce((s, d) => s + d.commissionCents, 0));
  });

  it('charges each order the rate in force when it settled', () => {
    const timeline = [
      { effectiveFrom: at('2026-09-01T00:00:00Z'), bps: 1500 },
      { effectiveFrom: at('2026-10-02T00:00:00Z'), bps: 1000 },
    ];
    const rows = [
      order({ id: 'before', settledAt: at('2026-10-01T23:59:00Z'), capturedCents: 10000, hasCapture: true }),
      order({ id: 'after', settledAt: at('2026-10-02T00:01:00Z'), capturedCents: 10000, hasCapture: true }),
    ];
    const result = computeSettlement(rows, timeline, 9999, window, utcDay);
    expect(result.days[0]?.commissionCents).toBe(1500);
    expect(result.days[1]?.commissionCents).toBe(1000);
  });

  it('keeps what was settled before the period for the opening balance', () => {
    const rows = [
      order({ id: 'old', settledAt: at('2026-09-20T10:00:00Z'), capturedCents: 10000, hasCapture: true }),
      order({ id: 'new', settledAt: at('2026-10-02T10:00:00Z'), capturedCents: 2000, hasCapture: true }),
    ];
    const result = computeSettlement(rows, [], 1500, window, utcDay);
    expect(result.accruedBeforeCents).toBe(8500);
    expect(result.accruedBeforeEndCents).toBe(8500 + 1700);
    expect(result.totals.orders).toBe(1);
    expect(result.firstSettledDay).toBe('2026-09-20');
  });

  it('ignores orders settled after the period', () => {
    const rows = [order({ settledAt: at('2026-10-04T00:00:00Z'), capturedCents: 1000, hasCapture: true })];
    const result = computeSettlement(rows, [], 1500, window, utcDay);
    expect(result.totals.orders).toBe(0);
    expect(result.accruedBeforeEndCents).toBe(0);
    expect(result.firstSettledDay).toBeNull();
  });
});

describe('periodFigures', () => {
  it('sums card money and commission inside the window only', () => {
    const rows = [
      order({ settledAt: at('2026-09-30T10:00:00Z'), capturedCents: 1000, hasCapture: true }),
      order({ settledAt: at('2026-10-01T10:00:00Z'), capturedCents: 2000, refundedCents: 500, hasCapture: true }),
    ];
    expect(periodFigures(rows, [], 1500, at('2026-10-01T00:00:00Z'), at('2026-10-02T00:00:00Z'))).toEqual({
      cardNetCents: 1500,
      commissionCents: 225,
    });
  });
});

describe('settlementBalance', () => {
  const start = at('2026-10-08T00:00:00Z');
  const end = at('2026-10-15T00:00:00Z');
  const payout = (periodTo: string, amountCents: number, status: 'PENDING' | 'PAID'): LedgerPayout => ({
    periodTo,
    periodEnd: at(`${nextDay(periodTo)}T00:00:00Z`),
    amountCents,
    status,
  });

  it('carries what is still owed into the next period', () => {
    const balance = settlementBalance({
      accruedBeforeCents: 50_000,
      payableCents: 20_000,
      payouts: [payout('2026-09-30', 30_000, 'PAID'), payout('2026-10-07', 19_000, 'PAID')],
      start,
      end,
    });
    // 50 000 earned by the 8th, 49 000 paid for periods up to the 7th: 1 000 carried in
    // (a refund on an order paid out before shows up exactly like that, with the other sign).
    expect(balance).toEqual({
      openingCents: 1_000,
      payableCents: 20_000,
      paidCents: 0,
      pendingCents: 0,
      closingCents: 21_000,
      closingPendingCents: 0,
    });
  });

  it('counts a payout against the period it settles, and a pending one as still owed', () => {
    const balance = settlementBalance({
      accruedBeforeCents: 10_000,
      payableCents: 20_000,
      payouts: [payout('2026-10-07', 10_000, 'PAID'), payout('2026-10-14', 20_000, 'PENDING')],
      start,
      end,
    });
    expect(balance).toMatchObject({ openingCents: 0, paidCents: 0, pendingCents: 20_000, closingCents: 20_000 });
    expect(balance.closingPendingCents).toBe(20_000);
  });

  it('subtracts a payout made within the period from the closing balance', () => {
    const balance = settlementBalance({
      accruedBeforeCents: 0,
      payableCents: 20_000,
      payouts: [payout('2026-10-10', 12_000, 'PAID'), payout('2026-10-20', 99_999, 'PAID')],
      start,
      end,
    });
    expect(balance).toMatchObject({ paidCents: 12_000, closingCents: 8_000 });
  });

  it('goes negative when refunds outweigh the money owed', () => {
    const balance = settlementBalance({
      accruedBeforeCents: 9_000,
      payableCents: 0,
      payouts: [payout('2026-10-07', 10_000, 'PAID')],
      start,
      end,
    });
    expect(balance.closingCents).toBe(-1_000);
  });
});

describe('planPayout', () => {
  const base = {
    to: '2026-10-07',
    today: '2026-10-10',
    lastSettledDay: null,
    firstSettledDay: '2026-10-02',
    accruedBeforeEndCents: 18_558,
    committedCents: 0,
    nextDay,
  };

  it('starts the first payout at the first counted order and pays the whole balance', () => {
    expect(planPayout(base)).toEqual({ periodFrom: '2026-10-02', amountCents: 18_558, blocked: null });
  });

  it('picks up the day after the last payout and pays only what is not covered yet', () => {
    expect(planPayout({ ...base, to: '2026-10-09', lastSettledDay: '2026-10-07', committedCents: 18_000 })).toEqual({
      periodFrom: '2026-10-08',
      amountCents: 558,
      blocked: null,
    });
  });

  it('refuses a day an earlier payout already settles', () => {
    expect(planPayout({ ...base, lastSettledDay: '2026-10-07', committedCents: 18_558 }).blocked).toBe('OVERLAP');
  });

  it('refuses a period that has not ended yet', () => {
    expect(planPayout({ ...base, to: '2026-10-10' }).blocked).toBe('PERIOD_OPEN');
  });

  it('refuses when nothing is owed — a negative balance is carried forward', () => {
    expect(planPayout({ ...base, committedCents: 20_000 })).toMatchObject({
      amountCents: -1_442,
      blocked: 'NOTHING_DUE',
    });
    expect(planPayout({ ...base, firstSettledDay: null, accruedBeforeEndCents: 0 }).blocked).toBe('NOTHING_DUE');
  });
});

describe('rateSpans', () => {
  const start = at('2026-10-01T00:00:00Z');
  const end = at('2026-11-01T00:00:00Z');

  it('falls back to the current rate without history', () => {
    expect(rateSpans([], { bps: 1500, source: 'PLAN' }, start, end, utcDay)).toEqual([
      { bps: 1500, source: 'PLAN', from: '2026-10-01', to: '2026-10-31' },
    ]);
  });

  it('splits the period where the rate changes and merges equal neighbours', () => {
    const timeline = [
      { effectiveFrom: at('2026-09-01T00:00:00Z'), bps: 1500, source: 'PLAN' as const },
      { effectiveFrom: at('2026-10-10T00:00:00Z'), bps: 1200, source: 'INDIVIDUAL' as const },
      { effectiveFrom: at('2026-10-20T00:00:00Z'), bps: 1200, source: 'INDIVIDUAL' as const },
      { effectiveFrom: at('2026-12-01T00:00:00Z'), bps: 1500, source: 'PLAN' as const },
    ];
    expect(rateSpans(timeline, { bps: 0, source: 'PLAN' }, start, end, utcDay)).toEqual([
      { bps: 1500, source: 'PLAN', from: '2026-10-01', to: '2026-10-09' },
      { bps: 1200, source: 'INDIVIDUAL', from: '2026-10-10', to: '2026-10-31' },
    ]);
  });

  it('extends the first rate back to the start of the period', () => {
    const timeline = [{ effectiveFrom: at('2026-10-15T00:00:00Z'), bps: 1200, source: 'INDIVIDUAL' as const }];
    expect(rateSpans(timeline, { bps: 0, source: 'PLAN' }, start, end, utcDay)).toEqual([
      { bps: 1200, source: 'INDIVIDUAL', from: '2026-10-01', to: '2026-10-31' },
    ]);
  });
});
