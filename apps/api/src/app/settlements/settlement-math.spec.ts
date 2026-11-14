import {
  commissionCents,
  computeSettlement,
  directionOf,
  emptyTotals,
  periodFigures,
  planPayout,
  rateSpans,
  settleOrder,
  settlementBalance,
  signedAmount,
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
    takeawayDiscountCents: 0,
    takeawayCompensationCents: 0,
    pointsCompensationCents: 0,
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
 * Transnistrian roubles (kopecks). The guests pay the brand directly.
 */
const EXAMPLE: SettlementOrderRow[] = [
  // A — latte and croissant, 75 руб., paid by card.
  order({ id: 'A', subtotalCents: 7500, totalCents: 7500, capturedCents: 7500, hasCapture: true }),
  // B — a free coffee on the brand's own promo code: 0 руб., no card payment at all.
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
  // D — 60 руб., 10 of them in loyalty points (takeAway's to fund), 50 by card.
  order({
    id: 'D',
    subtotalCents: 6000,
    discountCents: 1000,
    pointsDiscountCents: 1000,
    pointsCompensationCents: 1000,
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
  // F — 100 руб. with a takeAway promo −10 %: the guest paid 90, takeAway owes 10.
  order({
    id: 'F',
    subtotalCents: 10000,
    discountCents: 1000,
    takeawayDiscountCents: 1000,
    takeawayCompensationCents: 1000,
    totalCents: 9000,
    capturedCents: 9000,
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
  it('charges commission on the card money plus what takeAway compensates', () => {
    const [a, b, c, d, e, f] = EXAMPLE.map((row) => settleOrder(row, 1500));
    expect(a).toMatchObject({ cardNetCents: 7500, commissionBaseCents: 7500, commissionCents: 1125, netCents: 1125 });
    // The brand's own promo: the guest paid nothing, nothing is owed either way.
    expect(b).toMatchObject({
      cardOrders: 0,
      zeroTotalOrders: 1,
      salesCents: 4000,
      promoDiscountCents: 4000,
      commissionBaseCents: 0,
      netCents: 0,
    });
    // The gift-card share was paid to the brand when it sold the card: no commission on it.
    expect(c).toMatchObject({
      giftCardCents: 5000,
      commissionBaseCents: 7000,
      commissionCents: 1050,
      netCents: 1050,
    });
    // Points: takeAway owes the brand 10 and takes commission on the full 60.
    expect(d).toMatchObject({
      promoDiscountCents: 0,
      pointsDiscountCents: 1000,
      cardNetCents: 5000,
      pointsCompensationCents: 1000,
      compensationCents: 1000,
      commissionBaseCents: 6000,
      commissionCents: 900,
      netCents: -100,
    });
    expect(e).toMatchObject({
      refundedCents: 1000,
      cardNetCents: 2333,
      commissionBaseCents: 2333,
      commissionCents: 350,
      netCents: 350,
    });
    expect(f).toMatchObject({
      cardNetCents: 9000,
      takeawayCompensationCents: 1000,
      pointsCompensationCents: 0,
      compensationCents: 1000,
      commissionBaseCents: 10000,
      commissionCents: 1500,
      netCents: 500,
    });
  });

  it('takes no commission on an accepted order paid at the counter', () => {
    const settled = settleOrder(order({ subtotalCents: 5000, totalCents: 5000 }), 1500);
    expect(settled).toMatchObject({ unpaidOrders: 1, unpaidTotalCents: 5000, capturedCents: 0, netCents: 0 });
  });

  it('nets a full refund to nothing', () => {
    const settled = settleOrder(
      order({ totalCents: 5000, capturedCents: 5000, refundedCents: 5000, hasCapture: true }),
      1500,
    );
    expect(settled).toMatchObject({ cardOrders: 1, commissionBaseCents: 0, commissionCents: 0, netCents: 0 });
  });

  it('never lets a refund exceed the captured money', () => {
    const settled = settleOrder(order({ capturedCents: 1000, refundedCents: 1500, hasCapture: true }), 1500);
    expect(settled).toMatchObject({ refundedCents: 1000, cardNetCents: 0, commissionBaseCents: 0 });
  });

  // «Учёт акций takeAway»: 100 at 10 % — the guest pays 90, takeAway owes 10.
  it('leaves the brand with what a regular order of the same price brings', () => {
    const regular = settleOrder(
      order({ subtotalCents: 10000, totalCents: 10000, capturedCents: 10000, hasCapture: true }),
      1500,
    );
    const promo = settleOrder(EXAMPLE[5] as SettlementOrderRow, 1500);
    const points = settleOrder(
      order({
        subtotalCents: 10000,
        discountCents: 2500,
        pointsDiscountCents: 2500,
        pointsCompensationCents: 2500,
        totalCents: 7500,
        capturedCents: 7500,
        hasCapture: true,
      }),
      1500,
    );
    // What the brand keeps: the guest's card money − what it owes takeAway (net).
    const keeps = (s: ReturnType<typeof settleOrder>) => s.cardNetCents - s.netCents;
    expect(keeps(regular)).toBe(8500);
    expect(keeps(promo)).toBe(8500);
    expect(keeps(points)).toBe(8500);
    // Points worth more than the commission: takeAway pays the brand the difference.
    expect(points.netCents).toBe(1500 - 2500);
  });

  it('owes nothing for the promo or the points of an order cancelled and refunded', () => {
    // The redemption and the points are gone once the order is cancelled: the SQL reads 0.
    const settled = settleOrder(
      order({
        subtotalCents: 10000,
        discountCents: 1000,
        takeawayDiscountCents: 1000,
        takeawayCompensationCents: 0,
        pointsDiscountCents: 500,
        pointsCompensationCents: 0,
        totalCents: 8500,
        capturedCents: 8500,
        refundedCents: 8500,
        hasCapture: true,
      }),
      1500,
    );
    expect(settled).toMatchObject({ compensationCents: 0, commissionBaseCents: 0, netCents: 0 });
  });

  it('keeps the brand promo and the takeAway promo apart, with points beside them', () => {
    const settled = settleOrder(
      order({ subtotalCents: 5000, discountCents: 700, pointsDiscountCents: 200, takeawayDiscountCents: 0 }),
      1500,
    );
    expect(settled).toMatchObject({ promoDiscountCents: 500, pointsDiscountCents: 200, takeawayCompensationCents: 0 });
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
      orders: 6,
      cardOrders: 5,
      zeroTotalOrders: 1,
      salesCents: 42833,
      promoDiscountCents: 4000,
      pointsDiscountCents: 1000,
      giftCardCents: 5000,
      capturedCents: 31833,
      refundedCents: 1000,
      cardNetCents: 30833,
      takeawayCompensationCents: 1000,
      pointsCompensationCents: 1000,
      compensationCents: 2000,
      commissionBaseCents: 32833,
      commissionCents: 4925,
      netCents: 2925,
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

  it('keeps the net settled before the period for the opening balance', () => {
    const rows = [
      order({ id: 'old', settledAt: at('2026-09-20T10:00:00Z'), capturedCents: 10000, hasCapture: true }),
      order({ id: 'new', settledAt: at('2026-10-02T10:00:00Z'), capturedCents: 2000, hasCapture: true }),
    ];
    const result = computeSettlement(rows, [], 1500, window, utcDay);
    expect(result.accruedBeforeCents).toBe(1500);
    expect(result.accruedBeforeEndCents).toBe(1500 + 300);
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
      compensationCents: 0,
      pointsCompensationCents: 0,
      commissionCents: 225,
    });
  });

  it('keeps the promo and the points compensation out of the card money', () => {
    const rows = [
      order({
        capturedCents: 1555 - 156,
        takeawayDiscountCents: 156,
        takeawayCompensationCents: 156,
        hasCapture: true,
      }),
      order({ capturedCents: 800, pointsDiscountCents: 200, pointsCompensationCents: 200, hasCapture: true }),
    ];
    expect(periodFigures(rows, [], 1000, at('2026-10-02T00:00:00Z'), at('2026-10-03T00:00:00Z'))).toEqual({
      cardNetCents: 1399 + 800,
      compensationCents: 156,
      pointsCompensationCents: 200,
      // 10 % of 15.55 → 1.56, and 10 % of 10.00.
      commissionCents: 156 + 100,
    });
  });
});

describe('signedAmount and directionOf', () => {
  it('signs a settlement the way the balance reads: + the brand pays, − takeAway pays', () => {
    expect(signedAmount('BRAND_TO_TAKEAWAY', 500)).toBe(500);
    expect(signedAmount('TAKEAWAY_TO_BRAND', 500)).toBe(-500);
  });

  it('turns a signed net into who pays and how much', () => {
    expect(directionOf(2925)).toEqual({ direction: 'BRAND_TO_TAKEAWAY', amountCents: 2925 });
    expect(directionOf(-1000)).toEqual({ direction: 'TAKEAWAY_TO_BRAND', amountCents: 1000 });
    expect(directionOf(0)).toEqual({ direction: null, amountCents: 0 });
  });
});

describe('settlementBalance', () => {
  const start = at('2026-10-08T00:00:00Z');
  const end = at('2026-10-15T00:00:00Z');
  const settlement = (periodTo: string, signedCents: number, status: LedgerPayout['status']): LedgerPayout => ({
    periodTo,
    periodEnd: at(`${nextDay(periodTo)}T00:00:00Z`),
    signedCents,
    status,
  });

  it('carries what is still owed into the next period', () => {
    const balance = settlementBalance({
      accruedBeforeCents: 5_000,
      netCents: 2_000,
      payouts: [settlement('2026-09-30', 3_000, 'CONFIRMED'), settlement('2026-10-07', 1_900, 'CONFIRMED')],
      start,
      end,
    });
    // 5 000 owed by the 8th, 4 900 settled for periods up to the 7th: 100 carried in.
    expect(balance).toEqual({
      openingCents: 100,
      netCents: 2_000,
      settledCents: 0,
      openCents: 0,
      closingCents: 2_100,
      closingOpenCents: 0,
    });
  });

  it('counts only a confirmed settlement as settled; paid, pending and disputed are still owed', () => {
    const balance = settlementBalance({
      accruedBeforeCents: 1_000,
      netCents: 2_000,
      payouts: [
        settlement('2026-10-07', 1_000, 'PAID'),
        settlement('2026-10-10', 800, 'DISPUTED'),
        settlement('2026-10-14', 1_200, 'PENDING'),
      ],
      start,
      end,
    });
    expect(balance).toMatchObject({ openingCents: 1_000, settledCents: 0, openCents: 2_000, closingCents: 3_000 });
    expect(balance.closingOpenCents).toBe(3_000);
  });

  it('subtracts a settlement confirmed within the period from the closing balance', () => {
    const balance = settlementBalance({
      accruedBeforeCents: 0,
      netCents: 2_000,
      payouts: [settlement('2026-10-10', 1_200, 'CONFIRMED'), settlement('2026-10-20', 99_999, 'CONFIRMED')],
      start,
      end,
    });
    expect(balance).toMatchObject({ settledCents: 1_200, closingCents: 800 });
  });

  it('nets settlements both ways: what takeAway paid the brand raises what the brand owes', () => {
    // takeAway owed the brand 1 500 (points) and paid it; the brand's commission since is 400.
    const balance = settlementBalance({
      accruedBeforeCents: -1_500,
      netCents: 400,
      payouts: [settlement('2026-10-07', -1_500, 'CONFIRMED')],
      start,
      end,
    });
    expect(balance).toMatchObject({ openingCents: 0, closingCents: 400 });
  });

  it('goes negative when takeAway owes the brand', () => {
    const balance = settlementBalance({ accruedBeforeCents: 0, netCents: -700, payouts: [], start, end });
    expect(balance.closingCents).toBe(-700);
  });
});

describe('planPayout', () => {
  const base = {
    to: '2026-10-07',
    today: '2026-10-10',
    lastSettledDay: null,
    firstSettledDay: '2026-10-02',
    accruedBeforeEndCents: 2_925,
    committedCents: 0,
    nextDay,
  };

  it('starts the first settlement at the first counted order and takes the whole balance', () => {
    expect(planPayout(base)).toEqual({
      periodFrom: '2026-10-02',
      netCents: 2_925,
      direction: 'BRAND_TO_TAKEAWAY',
      amountCents: 2_925,
      blocked: null,
    });
  });

  it('points the other way when the compensation outweighs the commission', () => {
    expect(planPayout({ ...base, accruedBeforeEndCents: -1_000 })).toEqual({
      periodFrom: '2026-10-02',
      netCents: -1_000,
      direction: 'TAKEAWAY_TO_BRAND',
      amountCents: 1_000,
      blocked: null,
    });
  });

  it('picks up the day after the last settlement and takes only what is not fixed yet', () => {
    expect(planPayout({ ...base, to: '2026-10-09', lastSettledDay: '2026-10-07', committedCents: 2_000 })).toEqual({
      periodFrom: '2026-10-08',
      netCents: 925,
      direction: 'BRAND_TO_TAKEAWAY',
      amountCents: 925,
      blocked: null,
    });
    // A settlement takeAway paid (−) leaves more for the brand to pay.
    expect(planPayout({ ...base, to: '2026-10-09', lastSettledDay: '2026-10-07', committedCents: -500 })).toMatchObject(
      { netCents: 3_425, amountCents: 3_425 },
    );
  });

  it('refuses a day an earlier settlement already covers', () => {
    expect(planPayout({ ...base, lastSettledDay: '2026-10-07', committedCents: 2_925 }).blocked).toBe('OVERLAP');
  });

  it('refuses a period that has not ended yet', () => {
    expect(planPayout({ ...base, to: '2026-10-10' }).blocked).toBe('PERIOD_OPEN');
  });

  it('refuses when commission and compensation cancel out', () => {
    expect(planPayout({ ...base, committedCents: 2_925 })).toMatchObject({
      netCents: 0,
      direction: null,
      amountCents: 0,
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
