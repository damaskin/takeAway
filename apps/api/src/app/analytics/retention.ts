/**
 * Churn and win-back arithmetic, kept apart from SQL so it can be tested as
 * plain numbers.
 *
 * A customer is *lost* once `window` days (7 or 14) pass after an order with
 * no next one. The moment that happens — the last order plus the window —
 * is when the business lost them. "Lost in a period" counts the customers
 * whose moment falls inside it and who have not come back by its end.
 *
 * A customer is *won back* in a period when they were already lost at its
 * start (their last order before it is more than `window` days older than
 * the start) and ordered again inside it.
 */

export const CHURN_WINDOWS = [7, 14] as const;
export type ChurnWindow = (typeof CHURN_WINDOWS)[number];

const DAY_MS = 24 * 60 * 60_000;

/**
 * Last-order bounds of the customers lost during [start, asOf): their last
 * order before `asOf` lies in [lastOrderFrom, lastOrderBefore). `asOf` is the
 * end of the period, or now while it is still running — a customer cannot
 * have been lost in a future that has not happened.
 */
export function churnBounds(
  start: Date,
  end: Date,
  window: ChurnWindow,
  now: Date = new Date(),
): { asOf: Date; lastOrderFrom: Date; lastOrderBefore: Date } {
  const asOf = new Date(Math.min(end.getTime(), now.getTime()));
  return {
    asOf,
    lastOrderFrom: new Date(start.getTime() - window * DAY_MS),
    lastOrderBefore: new Date(asOf.getTime() - window * DAY_MS),
  };
}

/** Last order before a period that leaves a customer already lost at its start. */
export function lapsedBefore(start: Date, window: ChurnWindow): Date {
  return new Date(start.getTime() - window * DAY_MS);
}

/** A customer's history up to the reference moment. */
export interface CustomerTotals {
  userId: string;
  lastOrderAt: Date;
  orders: number;
  totalCents: number;
}

export interface LostCustomer extends CustomerTotals {
  avgCheckCents: number;
  daysSinceLastOrder: number;
}

export interface ChurnSummary {
  count: number;
  /** What the lost customers would have spent on their next visit: the sum of their average checks. */
  lostRevenueCents: number;
  /** Highest-value first. */
  customers: LostCustomer[];
}

export function avgCheck(totals: Pick<CustomerTotals, 'orders' | 'totalCents'>): number {
  return totals.orders > 0 ? Math.round(totals.totalCents / totals.orders) : 0;
}

/**
 * Sums up the customers lost in a period. `rows` may hold anyone whose last
 * order is recent enough; the bounds decide who actually counts.
 */
export function summarizeChurn(
  rows: readonly CustomerTotals[],
  bounds: { asOf: Date; lastOrderFrom: Date; lastOrderBefore: Date },
): ChurnSummary {
  const lost = rows
    .filter(
      (r) =>
        r.orders > 0 &&
        r.lastOrderAt.getTime() >= bounds.lastOrderFrom.getTime() &&
        r.lastOrderAt.getTime() < bounds.lastOrderBefore.getTime(),
    )
    .map<LostCustomer>((r) => ({
      ...r,
      avgCheckCents: avgCheck(r),
      daysSinceLastOrder: Math.floor((bounds.asOf.getTime() - r.lastOrderAt.getTime()) / DAY_MS),
    }))
    .sort((a, b) => b.avgCheckCents - a.avgCheckCents || b.totalCents - a.totalCents);
  return {
    count: lost.length,
    lostRevenueCents: lost.reduce((sum, c) => sum + c.avgCheckCents, 0),
    customers: lost,
  };
}

/** A customer who was lost at the start of a period and ordered inside it. */
export interface ReturnedCustomer {
  userId: string;
  lastOrderBefore: Date;
  returnedAt: Date;
  orders: number;
  revenueCents: number;
}

export interface WinBackSummary {
  /** Customers already lost when the period began — the pool to win back from. */
  lapsedAtStart: number;
  returned: number;
  /** Returned among the lapsed, 0..100 with one decimal; null with nobody to win back. */
  returnRatePercent: number | null;
  orders: number;
  revenueCents: number;
  /** Biggest spenders first. */
  customers: Array<ReturnedCustomer & { daysAway: number }>;
}

export function summarizeWinBack(lapsedAtStart: number, returned: readonly ReturnedCustomer[]): WinBackSummary {
  const customers = returned
    .filter((r) => r.orders > 0)
    .map((r) => ({
      ...r,
      daysAway: Math.floor((r.returnedAt.getTime() - r.lastOrderBefore.getTime()) / DAY_MS),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents || b.orders - a.orders);
  return {
    lapsedAtStart,
    returned: customers.length,
    returnRatePercent: lapsedAtStart > 0 ? Math.round((customers.length / lapsedAtStart) * 1000) / 10 : null,
    orders: customers.reduce((sum, c) => sum + c.orders, 0),
    revenueCents: customers.reduce((sum, c) => sum + c.revenueCents, 0),
    customers,
  };
}

/** Percent change, one decimal; null when there was nothing before to compare with. */
export function percentChange(before: number, after: number): number | null {
  return before > 0 ? Math.round(((after - before) / before) * 1000) / 10 : null;
}
