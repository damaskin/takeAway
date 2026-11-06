import { daysBetween, localDay } from './analytics-range';

/**
 * Churn and win-back arithmetic, kept apart from SQL so it can be tested as
 * plain numbers.
 *
 * A customer is *inactive* («неактивный», once called lost) when they have
 * ordered at least {@link INACTIVE_MIN_ORDERS} times and `window` days (3,
 * 7 or 14) pass after their last order with no next one. The moment that
 * happens — the last order plus the window — is when the business lost
 * them. "Lost in a period" counts the customers whose moment falls inside
 * it and who have not come back by its end. Somebody who ordered once or
 * twice is not a regular yet, so their silence is not counted as a loss.
 *
 * A customer is *won back* in a period when they were already inactive at
 * its start (their last order before it is more than `window` days older
 * than the start) and ordered again inside it.
 *
 * «Упущенная выручка» is what each of them would have brought coming at
 * their usual pace: R = D ÷ T × A — D days without a visit, T their usual
 * interval between visits, A their average check (see
 * {@link lostRevenueEstimate}). A visit is a calendar day, in the
 * analytics time zone, with at least one counted order.
 */

export const CHURN_WINDOWS = [3, 7, 14] as const;
export type ChurnWindow = (typeof CHURN_WINDOWS)[number];

/** Orders a customer needs before going quiet makes them inactive. */
export const INACTIVE_MIN_ORDERS = 3;

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
  /** Visits: calendar days, in the analytics time zone, with at least one counted order. */
  visits: number;
  /** The first and the last of those days, `YYYY-MM-DD`. */
  firstVisitDay: string;
  lastVisitDay: string;
}

export interface LostCustomer extends CustomerTotals {
  avgCheckCents: number;
  /** D: days without a visit, from the last visit to the last day of the period (today while it runs). */
  daysSinceLastOrder: number;
  /** T: the customer's usual interval between visits, in days; null with a single visit. */
  visitIntervalDays: number | null;
  /** R = D ÷ T × A for this customer, in cents. */
  lostRevenueCents: number;
}

export interface ChurnSummary {
  count: number;
  /** What the lost customers would have brought coming at their usual pace: the sum of their R. */
  lostRevenueCents: number;
  /** Biggest estimate first. */
  customers: LostCustomer[];
}

export interface ChurnBounds {
  asOf: Date;
  lastOrderFrom: Date;
  lastOrderBefore: Date;
}

export interface ChurnEstimateOptions {
  /** The last day of the period in the analytics time zone (today while it runs): see {@link churnAsOfDay}. */
  asOfDay: string;
  /**
   * T for a customer with a single visit, who has none of their own: the
   * average interval of the customers with two visits or more in the same
   * stores. Null when there are none — such a customer then adds 0.
   */
  fallbackIntervalDays: number | null;
}

export function avgCheck(totals: Pick<CustomerTotals, 'orders' | 'totalCents'>): number {
  return totals.orders > 0 ? Math.round(totals.totalCents / totals.orders) : 0;
}

/** The last calendar day before `asOf` in `timeZone`: the period's last day, or today while it runs. */
export function churnAsOfDay(asOf: Date, timeZone: string): string {
  return localDay(new Date(asOf.getTime() - 1), timeZone);
}

/**
 * T: the customer's usual interval between visits, in days, not rounded —
 * (last visit − first visit) ÷ (visits − 1). Null with a single visit.
 * Visits from 24.09 to 07.10, ten of them: 13 ÷ 9 ≈ 1.44.
 */
export function visitInterval(visits: number, firstVisitDay: string, lastVisitDay: string): number | null {
  if (visits < 2) return null;
  const span = daysBetween(firstVisitDay, lastVisitDay);
  return span > 0 ? span / (visits - 1) : null;
}

/**
 * R = D ÷ T × A: what a customer would have brought over the days they
 * stayed away, had they kept coming at their usual pace — D days without a
 * visit, a visit every T days, A each. A forecast, not lost profit. In
 * cents, rounded half up once at the end; 0 without an interval.
 *
 * 11 days away, a visit every 4 days, 1.20 a visit: 3.30.
 */
export function lostRevenueEstimate(input: {
  daysAway: number;
  intervalDays: number | null;
  avgCheckCents: number;
}): number {
  const { daysAway, intervalDays, avgCheckCents } = input;
  if (intervalDays === null || !(intervalDays > 0) || daysAway <= 0 || avgCheckCents <= 0) return 0;
  return roundHalfUp((daysAway / intervalDays) * avgCheckCents);
}

/** Half up to a whole cent. Float noise is cut at six decimals first, so 2.4999999… standing for 2.5 still goes up. */
function roundHalfUp(cents: number): number {
  return Math.floor(Number(cents.toFixed(6)) + 0.5);
}

/** The rows that count as lost in the period: regulars whose window ran out inside it. */
export function lostInPeriod<T extends CustomerTotals>(rows: readonly T[], bounds: ChurnBounds): T[] {
  return rows.filter(
    (r) =>
      r.orders >= INACTIVE_MIN_ORDERS &&
      r.lastOrderAt.getTime() >= bounds.lastOrderFrom.getTime() &&
      r.lastOrderAt.getTime() < bounds.lastOrderBefore.getTime(),
  );
}

/**
 * Sums up the customers lost in a period. `rows` may hold anyone whose last
 * order is recent enough; the bounds decide who actually counts. Each
 * customer's estimate is rounded to the cent before they are summed.
 */
export function summarizeChurn(
  rows: readonly CustomerTotals[],
  bounds: ChurnBounds,
  options: ChurnEstimateOptions,
): ChurnSummary {
  const lost = lostInPeriod(rows, bounds)
    .map<LostCustomer>((r) => {
      const daysAway = Math.max(0, daysBetween(r.lastVisitDay, options.asOfDay));
      const own = visitInterval(r.visits, r.firstVisitDay, r.lastVisitDay);
      return {
        ...r,
        avgCheckCents: avgCheck(r),
        daysSinceLastOrder: daysAway,
        visitIntervalDays: own,
        lostRevenueCents: lostRevenueEstimate({
          daysAway,
          intervalDays: own ?? options.fallbackIntervalDays,
          // The exact average, not the rounded one: the estimate is rounded once.
          avgCheckCents: r.orders > 0 ? r.totalCents / r.orders : 0,
        }),
      };
    })
    .sort(
      (a, b) =>
        b.lostRevenueCents - a.lostRevenueCents || b.avgCheckCents - a.avgCheckCents || b.totalCents - a.totalCents,
    );
  return {
    count: lost.length,
    lostRevenueCents: lost.reduce((sum, c) => sum + c.lostRevenueCents, 0),
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
