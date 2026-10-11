/**
 * What an order is worth, one way for every screen a business reads money
 * on — the dashboard, analytics, customers, the platform view.
 *
 *   sales («Продажи»)     the items at menu price — `subtotalCents`
 *   discounts («Скидки»)  promo codes and loyalty points: the business gives
 *                         that money away, so it is not revenue
 *   revenue («Выручка»)   sales − discounts: what the goods earned, whether the
 *                         customer paid by card or with a gift card
 *   gift cards            the part of the revenue a gift card paid for
 *
 * `totalCents` is what was charged to the card. It is not revenue: a gift
 * card is a way of paying for goods, not a discount on them, and the café
 * got that money when the card was sold. Cards are issued in the admin and
 * sold, if at all, outside takeAway, so the sale itself is counted nowhere
 * and the purchase it pays for is counted once, here. Delivery fees and tax
 * added on top of menu prices are not revenue from goods either.
 *
 * The SQL twins (`SALES`, `DISCOUNTS`, `REVENUE`, `GIFT_CARDS`) live in
 * `analytics-sql.ts`; the two have to stay the same arithmetic.
 */

export interface OrderAmounts {
  subtotalCents: number;
  discountCents: number;
  giftCardCents: number;
}

export interface Money {
  salesCents: number;
  discountCents: number;
  revenueCents: number;
  giftCardCents: number;
}

export const NO_MONEY: Money = { salesCents: 0, discountCents: 0, revenueCents: 0, giftCardCents: 0 };

/** One order's money; a discount never takes the order below zero. */
export function orderMoney(order: OrderAmounts): Money {
  const revenue = Math.max(order.subtotalCents - order.discountCents, 0);
  return {
    salesCents: order.subtotalCents,
    discountCents: Math.min(order.discountCents, order.subtotalCents),
    revenueCents: revenue,
    giftCardCents: Math.min(order.giftCardCents, revenue),
  };
}

export function addMoney(a: Money, b: Money): Money {
  return {
    salesCents: a.salesCents + b.salesCents,
    discountCents: a.discountCents + b.discountCents,
    revenueCents: a.revenueCents + b.revenueCents,
    giftCardCents: a.giftCardCents + b.giftCardCents,
  };
}

export function sumMoney(orders: readonly OrderAmounts[]): Money {
  return orders.reduce<Money>((sum, o) => addMoney(sum, orderMoney(o)), NO_MONEY);
}

/** One line of an order, for the products ranking. */
export interface SoldLine {
  name: string;
  quantity: number;
  /** The line at menu price: unit price × quantity. */
  totalCents: number;
  order: Pick<OrderAmounts, 'subtotalCents' | 'discountCents'>;
}

export interface ProductMoney {
  name: string;
  unitsSold: number;
  salesCents: number;
  revenueCents: number;
}

/**
 * Products by revenue, on the same basis as the order totals: an order's
 * discount is spread over its lines by price, and each product's sum is
 * rounded down, so the products never add up to more than the revenue.
 * The SQL in `AnalyticsService.topProducts` does the same.
 */
export function productRevenue(lines: readonly SoldLine[]): ProductMoney[] {
  const byName = new Map<string, { units: number; sales: number; revenue: number }>();
  for (const line of lines) {
    const acc = byName.get(line.name) ?? { units: 0, sales: 0, revenue: 0 };
    const { revenueCents } = orderMoney({ ...line.order, giftCardCents: 0 });
    acc.units += line.quantity;
    acc.sales += line.totalCents;
    acc.revenue += line.order.subtotalCents > 0 ? (line.totalCents * revenueCents) / line.order.subtotalCents : 0;
    byName.set(line.name, acc);
  }
  return [...byName.entries()]
    .map(([name, p]) => ({ name, unitsSold: p.units, salesCents: p.sales, revenueCents: Math.floor(p.revenue) }))
    .sort((a, b) => b.revenueCents - a.revenueCents || b.unitsSold - a.unitsSold);
}
