import type {
  OverviewDay,
  OverviewHour,
  OverviewPeriod,
  OverviewRow,
  OverviewTotals,
  OverviewWeekday,
} from '@takeaway/shared-types';

import { addDays, type DateRange } from './analytics-range';
import { percentChange } from './retention';

/**
 * The dashboards' arithmetic, kept apart from SQL so it can be tested as
 * plain numbers. The overview service runs a handful of grouped queries and
 * hands their rows here; nothing in this file touches the database.
 */

/** Every order status, in the order the API lists them. */
export const ORDER_STATUSES = [
  'CREATED',
  'PAID',
  'ACCEPTED',
  'IN_PROGRESS',
  'READY',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
] as const;

/**
 * One store's or brand's figures for one of the two periods, or — with a
 * null `key` — the whole scope's (a `GROUPING SETS` total, so customers are
 * distinct across the scope rather than summed per store).
 */
export interface GroupTotalsRow {
  key: string | null;
  current: boolean;
  orders: number;
  revenue: number;
  commission: number;
  placed: number;
  cancelled: number;
  expired: number;
  pickupSecSum: number;
  pickupCount: number;
  customers: number;
}

/** One local day of the current period. */
export interface DailyRow {
  day: string;
  orders: number;
  revenue: number;
  commission: number;
  customers: number;
  cancelled: number;
  expired: number;
}

/** Customers whose first counted order falls on `day` (either period). */
export interface FirstOrderRow {
  day: string;
  customers: number;
}

/** Counted orders of the current period at one local hour of one weekday. */
export interface LoadRow {
  hour: number;
  weekday: number;
  orders: number;
  revenue: number;
}

export interface Unit {
  id: string;
  name: string;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `part` of `total` in percent, one decimal; 0 when there is no total. */
export function share(part: number, total: number): number {
  return total > 0 ? round1((part / total) * 100) : 0;
}

export function average(sum: number, count: number): number | null {
  return count > 0 ? Math.round(sum / count) : null;
}

export function overviewPeriod(range: DateRange): OverviewPeriod {
  return {
    from: range.from,
    to: range.to,
    days: range.days,
    timeZone: range.timeZone,
    previousFrom: range.previous.from,
    previousTo: range.previous.to,
  };
}

/** New customers of each period, from the days their first orders fall on. */
export function newCustomerTotals(
  range: DateRange,
  rows: readonly FirstOrderRow[],
): { current: number; previous: number } {
  let current = 0;
  let previous = 0;
  for (const row of rows) {
    if (row.day >= range.from && row.day <= range.to) current += row.customers;
    else if (row.day >= range.previous.from && row.day <= range.previous.to) previous += row.customers;
  }
  return { current, previous };
}

/** One period's totals from its scope-wide row. */
export function totalsFrom(row: GroupTotalsRow | undefined, newCustomers: number, activeUnits: number): OverviewTotals {
  const orders = row?.orders ?? 0;
  const revenue = row?.revenue ?? 0;
  const placed = row?.placed ?? 0;
  const cancelled = row?.cancelled ?? 0;
  const expired = row?.expired ?? 0;
  return {
    revenueCents: revenue,
    orders,
    placed,
    customers: row?.customers ?? 0,
    newCustomers,
    avgCheckCents: average(revenue, orders),
    cancelled,
    expired,
    cancelRatePercent: placed > 0 ? share(cancelled + expired, placed) : null,
    avgPickupSeconds: average(row?.pickupSecSum ?? 0, row?.pickupCount ?? 0),
    activeUnits,
    commissionCents: Math.round(row?.commission ?? 0),
  };
}

/** Units with at least one counted order in the period. */
export function countActive(rows: readonly GroupTotalsRow[], current: boolean): number {
  return rows.filter((r) => r.key !== null && r.current === current && r.orders > 0).length;
}

/** Every day of the current period, zero where nothing happened. */
export function dailySeries(
  range: DateRange,
  days: readonly DailyRow[],
  firstOrders: readonly FirstOrderRow[],
): OverviewDay[] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const newByDay = new Map(firstOrders.map((d) => [d.day, d.customers]));
  const out: OverviewDay[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const d = byDay.get(day);
    out.push({
      date: day,
      revenueCents: d?.revenue ?? 0,
      orders: d?.orders ?? 0,
      customers: d?.customers ?? 0,
      newCustomers: newByDay.get(day) ?? 0,
      cancelled: d?.cancelled ?? 0,
      expired: d?.expired ?? 0,
      commissionCents: Math.round(d?.commission ?? 0),
    });
  }
  return out;
}

/** All 24 hours, midnight first. */
export function loadByHour(rows: readonly LoadRow[]): OverviewHour[] {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenueCents: 0 }));
  for (const r of rows) {
    const slot = hours[r.hour];
    if (!slot) continue;
    slot.orders += r.orders;
    slot.revenueCents += r.revenue;
  }
  return hours;
}

/** Monday to Sunday. */
export function loadByWeekday(rows: readonly LoadRow[]): OverviewWeekday[] {
  const days = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, orders: 0, revenueCents: 0 }));
  for (const r of rows) {
    const slot = days[r.weekday - 1];
    if (!slot) continue;
    slot.orders += r.orders;
    slot.revenueCents += r.revenue;
  }
  return days;
}

/** Every status present, zero where nothing matched. */
export function statusCounts(rows: ReadonlyArray<{ status: string; count: number }>): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  for (const r of rows) if (r.status in out) out[r.status] = r.count;
  return out;
}

/**
 * Every unit side by side, idle ones included, highest revenue first. Shares
 * are of the scope's total; `detailed` adds the period before and the rest of
 * the PRO comparison.
 */
export function breakdown(units: readonly Unit[], rows: readonly GroupTotalsRow[], detailed: boolean): OverviewRow[] {
  const current = new Map(rows.filter((r) => r.key !== null && r.current).map((r) => [r.key as string, r]));
  const previous = new Map(rows.filter((r) => r.key !== null && !r.current).map((r) => [r.key as string, r]));
  const totalRevenue = [...current.values()].reduce((sum, r) => sum + r.revenue, 0);
  const totalOrders = [...current.values()].reduce((sum, r) => sum + r.orders, 0);

  return units
    .map<OverviewRow>((unit) => {
      const r = current.get(unit.id);
      const p = previous.get(unit.id);
      const revenue = r?.revenue ?? 0;
      const orders = r?.orders ?? 0;
      const base = {
        id: unit.id,
        name: unit.name,
        revenueCents: revenue,
        orders,
        sharePercent: share(revenue, totalRevenue),
        ordersSharePercent: share(orders, totalOrders),
      };
      if (!detailed) {
        return {
          ...base,
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
        };
      }
      const placed = r?.placed ?? 0;
      const cancelled = r?.cancelled ?? 0;
      const expired = r?.expired ?? 0;
      const previousRevenue = p?.revenue ?? 0;
      return {
        ...base,
        detailed: true,
        previousRevenueCents: previousRevenue,
        previousOrders: p?.orders ?? 0,
        revenueDeltaPercent: percentChange(previousRevenue, revenue),
        avgCheckCents: average(revenue, orders),
        customers: r?.customers ?? 0,
        cancelled,
        expired,
        cancelRatePercent: placed > 0 ? share(cancelled + expired, placed) : null,
        avgPickupSeconds: average(r?.pickupSecSum ?? 0, r?.pickupCount ?? 0),
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents || b.orders - a.orders || a.name.localeCompare(b.name));
}

/**
 * The currency the platform view opens in: the one that sold the most in
 * the period, else the one most brands price in. Money is never added up
 * across currencies.
 */
export function pickCurrency(
  brands: ReadonlyArray<{ currency: string; revenue: number }>,
  requested?: string | null,
): string | null {
  const currencies = [...new Set(brands.map((b) => b.currency))];
  if (requested && currencies.includes(requested)) return requested;
  if (currencies.length === 0) return null;
  const revenue = new Map<string, number>();
  const count = new Map<string, number>();
  for (const b of brands) {
    revenue.set(b.currency, (revenue.get(b.currency) ?? 0) + b.revenue);
    count.set(b.currency, (count.get(b.currency) ?? 0) + 1);
  }
  return currencies.sort(
    (a, b) =>
      (revenue.get(b) ?? 0) - (revenue.get(a) ?? 0) || (count.get(b) ?? 0) - (count.get(a) ?? 0) || a.localeCompare(b),
  )[0] as string;
}
