import { computeTax } from '@takeaway/utils';

import { type OrderAmounts, type SoldLine, orderMoney, productRevenue, sumMoney } from './money';

/**
 * One customer's week, like the tester's on «Кофейни Качели»: an Americano
 * at 14 roubles bought plainly, with a promo code, with a gift card and with
 * points, and one order cancelled. Amounts are in kopecks.
 */
const AMERICANO = 1400;
const CROISSANT = 2000;

interface TestOrder extends OrderAmounts {
  status: 'PICKED_UP' | 'CANCELLED';
  /** What checkout charged to the card — computed as the order flow does. */
  totalCents: number;
  lines: Array<{ name: string; quantity: number; unitPriceCents: number }>;
}

function order(
  status: TestOrder['status'],
  lines: TestOrder['lines'],
  discounts: { promo?: number; points?: number; giftCard?: number } = {},
): TestOrder {
  const subtotalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const discountCents = (discounts.promo ?? 0) + (discounts.points ?? 0);
  const giftCardCents = discounts.giftCard ?? 0;
  const { totalCents } = computeTax({
    subtotalCents,
    discountCents,
    deliveryFeeCents: 0,
    giftCardCents,
    taxRateBps: 0,
    taxIncludedInPrice: true,
  });
  return { status, subtotalCents, discountCents, giftCardCents, totalCents, lines };
}

const WEEK: TestOrder[] = [
  order('PICKED_UP', [{ name: 'Американо', quantity: 2, unitPriceCents: AMERICANO }]),
  // A promo code for the whole price: the receipt says 0.
  order('PICKED_UP', [{ name: 'Американо', quantity: 1, unitPriceCents: AMERICANO }], { promo: AMERICANO }),
  // Paid in full with a gift card: nothing charged to the card either.
  order('PICKED_UP', [{ name: 'Американо', quantity: 1, unitPriceCents: AMERICANO }], { giftCard: AMERICANO }),
  order(
    'PICKED_UP',
    [
      { name: 'Американо', quantity: 1, unitPriceCents: AMERICANO },
      { name: 'Круассан', quantity: 1, unitPriceCents: CROISSANT },
    ],
    { points: 500 },
  ),
  order('CANCELLED', [{ name: 'Американо', quantity: 3, unitPriceCents: AMERICANO }]),
];

/** What `COUNTED` keeps. */
const counted = WEEK.filter((o) => o.status !== 'CANCELLED');

function lines(orders: readonly TestOrder[]): SoldLine[] {
  return orders.flatMap((o) =>
    o.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      totalCents: l.unitPriceCents * l.quantity,
      order: { subtotalCents: o.subtotalCents, discountCents: o.discountCents },
    })),
  );
}

describe('money definitions', () => {
  it('shows the old mismatch: the card charges are less than one product at menu price', () => {
    // What the dashboards summed before: Order.totalCents.
    const charged = counted.reduce((sum, o) => sum + o.totalCents, 0);
    const americanoAtMenuPrice = lines(counted)
      .filter((l) => l.name === 'Американо')
      .reduce((sum, l) => sum + l.totalCents, 0);
    expect(charged).toBe(5_700);
    expect(americanoAtMenuPrice).toBe(7_000);
    expect(americanoAtMenuPrice).toBeGreaterThan(charged);
  });

  it('reconciles: revenue = sales − discounts, gift cards are part of the revenue', () => {
    const money = sumMoney(counted);
    expect(money).toEqual({
      salesCents: 9_000,
      // The promo code (14) and the points (5) — the business gave those away.
      discountCents: 1_900,
      // The gift-card order counts in full: the café was paid when the card was sold.
      revenueCents: 7_100,
      giftCardCents: 1_400,
    });
    expect(money.revenueCents).toBe(money.salesCents - money.discountCents);
    expect(money.giftCardCents).toBeLessThanOrEqual(money.revenueCents);
    // Card charges plus gift cards are the revenue when nothing is added on top.
    expect(counted.reduce((sum, o) => sum + o.totalCents + o.giftCardCents, 0)).toBe(money.revenueCents);
  });

  it('counts a fully discounted order as an order with no revenue', () => {
    expect(orderMoney(counted[1] as TestOrder)).toEqual({
      salesCents: 1_400,
      discountCents: 1_400,
      revenueCents: 0,
      giftCardCents: 0,
    });
  });

  it('never lets a discount take an order below zero', () => {
    expect(orderMoney({ subtotalCents: 1000, discountCents: 1500, giftCardCents: 200 })).toEqual({
      salesCents: 1000,
      discountCents: 1000,
      revenueCents: 0,
      giftCardCents: 0,
    });
  });
});

describe('productRevenue', () => {
  it('ranks products on the revenue basis, adding up to no more than the revenue', () => {
    const products = productRevenue(lines(counted));
    expect(products).toEqual([
      // 28 + 0 + 14 + 14 × 29/34 (the points spread by price), rounded down.
      { name: 'Американо', unitsSold: 5, salesCents: 7_000, revenueCents: 5_394 },
      { name: 'Круассан', unitsSold: 1, salesCents: 2_000, revenueCents: 1_705 },
    ]);
    const revenue = sumMoney(counted).revenueCents;
    const total = products.reduce((sum, p) => sum + p.revenueCents, 0);
    expect(total).toBeLessThanOrEqual(revenue);
    // Rounding down loses less than a kopeck per product.
    expect(revenue - total).toBeLessThan(products.length);
    // And before discounts they are the sales, exactly.
    expect(products.reduce((sum, p) => sum + p.salesCents, 0)).toBe(sumMoney(counted).salesCents);
  });

  it('gives a free line nothing and survives an order without a subtotal', () => {
    expect(
      productRevenue([{ name: 'Вода', quantity: 1, totalCents: 0, order: { subtotalCents: 0, discountCents: 0 } }]),
    ).toEqual([{ name: 'Вода', unitsSold: 1, salesCents: 0, revenueCents: 0 }]);
  });
});
