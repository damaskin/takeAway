import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BusinessOverview, PlatformBrandRow, PlatformOverview } from '@takeaway/shared-types';

import { canonicalTimeZone, isLocalTimeZone, prevailingTimeZone } from '../common/time/time-zone';
import { PrismaService } from '../prisma/prisma.service';
import { type DateRange, type RangeInput, resolveDateRange } from './analytics-range';
import type { AnalyticsScope } from './analytics-scope';
import { COUNTED, PICKUP_DONE, createdBetween, num, scopeConditions, storeWhere, utc, whereAll } from './analytics-sql';
import {
  type DailyRow,
  type FirstOrderRow,
  type GroupTotalsRow,
  type LoadRow,
  type Unit,
  breakdown,
  countActive,
  dailySeries,
  loadByHour,
  loadByWeekday,
  newCustomerTotals,
  overviewPeriod,
  pickCurrency,
  statusCounts,
  totalsFrom,
} from './overview';

type Num = bigint | number | string | null;

/** What one overview groups its breakdown by. */
type GroupBy = 'store' | 'brand';

interface StoreZone {
  id: string;
  timezone: string;
}

interface Raw {
  groups: GroupTotalsRow[];
  daily: DailyRow[];
  firstOrders: FirstOrderRow[];
  load: LoadRow[] | null;
  statuses: Record<string, number>;
}

/**
 * The dashboards' data in one request each: the period's figures against
 * the period before, a day-by-day series, the breakdown by store (business)
 * or brand (platform), order statuses and — on PRO — the load by hour and
 * weekday. Five grouped queries run side by side; nothing is fetched order
 * by order.
 */
@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A business's dashboard. `storeComparison` adds the per-store comparison,
   * `deep` the hourly and weekday load.
   */
  async business(
    scope: AnalyticsScope,
    range: DateRange,
    features: { storeComparison: boolean; deep: boolean },
  ): Promise<BusinessOverview> {
    const stores = await this.prisma.store.findMany({
      where: storeWhere(scope),
      select: { id: true, name: true, timezone: true },
    });
    const raw = await this.collect(scope, range, 'store', features.deep ? stores : null);
    const units: Unit[] = stores.map((s) => ({ id: s.id, name: s.name }));
    const result = this.totals(range, raw);
    return {
      ...result,
      byStore: breakdown(units, raw.groups, features.storeComparison),
      storeComparison: features.storeComparison,
      byHour: raw.load ? loadByHour(raw.load) : null,
      byWeekday: raw.load ? loadByWeekday(raw.load) : null,
    };
  }

  /**
   * The platform's dashboard: every brand of one currency side by side, with
   * the commission each brought in at its current rate. Days are counted in
   * the zone most of those brands' stores keep.
   */
  async platform(input: RangeInput, requestedCurrency?: string | null, now = new Date()): Promise<PlatformOverview> {
    const brands = await this.prisma.brand.findMany({
      select: {
        id: true,
        name: true,
        currency: true,
        plan: true,
        commissionBps: true,
        moderationStatus: true,
        stores: { select: { id: true, timezone: true } },
      },
      orderBy: { name: 'asc' },
    });
    const currencies = [...new Set(brands.map((b) => b.currency as string))].sort();

    // The currency first: by what each sold in the period, read in UTC — the
    // exact local days only matter once we know whose days they are.
    let currency = requestedCurrency && currencies.includes(requestedCurrency) ? requestedCurrency : null;
    if (!currency && currencies.length > 1) {
      const rough = resolveDateRange(input, 'UTC', 30, now);
      const sold = await this.prisma.$queryRaw<Array<{ brandId: string; revenue: Num }>>`
        SELECT s."brandId" AS "brandId", COALESCE(SUM(o."totalCents"), 0)::bigint AS "revenue"
        FROM "Order" o
        JOIN "Store" s ON s.id = o."storeId"
        ${whereAll([COUNTED, ...createdBetween(rough.start, rough.end)])}
        GROUP BY 1
      `;
      const revenue = new Map(sold.map((r) => [r.brandId, num(r.revenue)]));
      currency = pickCurrency(brands.map((b) => ({ currency: b.currency, revenue: revenue.get(b.id) ?? 0 })));
    }
    currency ??= currencies[0] ?? null;

    const inCurrency = brands.filter((b) => b.currency === currency);
    const stores = inCurrency.flatMap((b) => b.stores);
    const timeZone = prevailingTimeZone(stores.map((s) => s.timezone)) ?? 'UTC';
    const range = resolveDateRange(input, timeZone, 30, now);
    const scope: AnalyticsScope = { brandIds: inCurrency.map((b) => b.id), storeIds: null };

    const raw = await this.collect(scope, range, 'brand', stores);
    const rows = breakdown(
      inCurrency.map((b) => ({ id: b.id, name: b.name })),
      raw.groups,
      true,
    );
    const byId = new Map(inCurrency.map((b) => [b.id, b]));
    const commission = (current: boolean) =>
      new Map(raw.groups.filter((g) => g.key && g.current === current).map((g) => [g.key as string, g.commission]));
    const commissionNow = commission(true);
    const commissionBefore = commission(false);
    const byBrand = rows.map<PlatformBrandRow>((row) => {
      const brand = byId.get(row.id);
      return {
        ...row,
        currency: brand?.currency ?? (currency as string),
        plan: brand?.plan ?? 'BASIC',
        commissionBps: brand?.commissionBps ?? 0,
        commissionCents: Math.round(commissionNow.get(row.id) ?? 0),
        previousCommissionCents: Math.round(commissionBefore.get(row.id) ?? 0),
        stores: brand?.stores.length ?? 0,
        moderationStatus: brand?.moderationStatus ?? 'PENDING',
      };
    });

    return {
      ...this.totals(range, raw),
      currency,
      currencies,
      byBrand,
      byHour: loadByHour(raw.load ?? []),
      byWeekday: loadByWeekday(raw.load ?? []),
    };
  }

  private totals(range: DateRange, raw: Raw) {
    const fresh = newCustomerTotals(range, raw.firstOrders);
    const scopeRow = (current: boolean) => raw.groups.find((g) => g.key === null && g.current === current);
    return {
      period: overviewPeriod(range),
      current: totalsFrom(scopeRow(true), fresh.current, countActive(raw.groups, true)),
      previous: totalsFrom(scopeRow(false), fresh.previous, countActive(raw.groups, false)),
      daily: dailySeries(range, raw.daily, raw.firstOrders),
      statuses: raw.statuses,
    };
  }

  /**
   * The grouped queries behind both views. `zones` are the stores whose own
   * time zone buckets the hourly load; null skips that query.
   */
  private async collect(
    scope: AnalyticsScope,
    range: DateRange,
    groupBy: GroupBy,
    zones: readonly StoreZone[] | null,
  ): Promise<Raw> {
    const key = groupBy === 'store' ? Prisma.raw('o."storeId"') : Prisma.raw('s."brandId"');
    const scoped = scopeConditions(scope);
    const tz = range.timeZone;
    const localDay = (column: Prisma.Sql) =>
      Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
    // Commission at each brand's current rate, in cents with fractions.
    const commission = Prisma.sql`o."totalCents"::numeric * b."commissionBps" / 10000`;

    const [groups, daily, firstOrders, load, statuses] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          key: string | null;
          current: boolean;
          orders: Num;
          revenue: Num;
          commission: Num;
          placed: Num;
          cancelled: Num;
          expired: Num;
          pickupSecSum: Num;
          pickupCount: Num;
          customers: Num;
        }>
      >`
        SELECT x."key" AS "key",
               x."current" AS "current",
               COUNT(*) FILTER (WHERE x."counted")::int AS "orders",
               COALESCE(SUM(x."totalCents") FILTER (WHERE x."counted"), 0)::bigint AS "revenue",
               COALESCE(SUM(x."commission") FILTER (WHERE x."counted"), 0)::float8 AS "commission",
               COUNT(*)::int AS "placed",
               COUNT(*) FILTER (WHERE x."status" = 'CANCELLED')::int AS "cancelled",
               COUNT(*) FILTER (WHERE x."status" = 'EXPIRED')::int AS "expired",
               COALESCE(SUM(x."pickupSec") FILTER (WHERE x."pickedUp"), 0)::float8 AS "pickupSecSum",
               COUNT(*) FILTER (WHERE x."pickedUp")::int AS "pickupCount",
               COUNT(DISTINCT x."userId") FILTER (WHERE x."counted")::int AS "customers"
        FROM (
          SELECT ${key} AS "key",
                 o."createdAt" >= ${utc(range.start)} AS "current",
                 ${COUNTED} AS "counted",
                 o."status"::text AS "status",
                 o."totalCents" AS "totalCents",
                 ${commission} AS "commission",
                 o."userId" AS "userId",
                 (${PICKUP_DONE}) AS "pickedUp",
                 EXTRACT(EPOCH FROM (o."pickedUpAt" - o."readyAt")) AS "pickupSec"
          FROM "Order" o
          JOIN "Store" s ON s.id = o."storeId"
          JOIN "Brand" b ON b.id = s."brandId"
          ${whereAll([...scoped, ...createdBetween(range.previous.start, range.end)])}
        ) x
        GROUP BY GROUPING SETS ((x."current", x."key"), (x."current"))
      `,
      this.prisma.$queryRaw<
        Array<{ day: string; orders: Num; revenue: Num; commission: Num; customers: Num; cancelled: Num; expired: Num }>
      >`
        SELECT ${localDay(Prisma.raw('o."createdAt"'))} AS "day",
               COUNT(*) FILTER (WHERE ${COUNTED})::int AS "orders",
               COALESCE(SUM(o."totalCents") FILTER (WHERE ${COUNTED}), 0)::bigint AS "revenue",
               COALESCE(SUM(${commission}) FILTER (WHERE ${COUNTED}), 0)::float8 AS "commission",
               COUNT(DISTINCT o."userId") FILTER (WHERE ${COUNTED})::int AS "customers",
               COUNT(*) FILTER (WHERE o."status" = 'CANCELLED')::int AS "cancelled",
               COUNT(*) FILTER (WHERE o."status" = 'EXPIRED')::int AS "expired"
        FROM "Order" o
        JOIN "Store" s ON s.id = o."storeId"
        JOIN "Brand" b ON b.id = s."brandId"
        ${whereAll([...scoped, ...createdBetween(range.start, range.end)])}
        GROUP BY 1
      `,
      // New to this business (or the platform): the customer's first counted
      // order in the scope, ever, falls on that day.
      this.prisma.$queryRaw<Array<{ day: string; customers: Num }>>`
        SELECT ${localDay(Prisma.raw('f."firstAt"'))} AS "day", COUNT(*)::int AS "customers"
        FROM (
          SELECT o."userId", MIN(o."createdAt") AS "firstAt"
          FROM "Order" o
          JOIN "Store" s ON s.id = o."storeId"
          ${whereAll([...scoped, COUNTED, Prisma.sql`o."createdAt" < ${utc(range.end)}`])}
          GROUP BY o."userId"
          HAVING MIN(o."createdAt") >= ${utc(range.previous.start)}
        ) f
        GROUP BY 1
      `,
      zones ? this.load(scope, range, zones) : Promise.resolve(null),
      this.prisma.$queryRaw<Array<{ status: string; count: Num }>>`
        SELECT o."status"::text AS "status", COUNT(*)::int AS "count"
        FROM "Order" o
        JOIN "Store" s ON s.id = o."storeId"
        ${whereAll([...scoped, ...createdBetween(range.start, range.end)])}
        GROUP BY 1
      `,
    ]);

    return {
      groups: groups.map((g) => ({
        key: g.key,
        current: g.current,
        orders: num(g.orders),
        revenue: num(g.revenue),
        commission: num(g.commission),
        placed: num(g.placed),
        cancelled: num(g.cancelled),
        expired: num(g.expired),
        pickupSecSum: num(g.pickupSecSum),
        pickupCount: num(g.pickupCount),
        customers: num(g.customers),
      })),
      daily: daily.map((d) => ({
        day: d.day,
        orders: num(d.orders),
        revenue: num(d.revenue),
        commission: num(d.commission),
        customers: num(d.customers),
        cancelled: num(d.cancelled),
        expired: num(d.expired),
      })),
      firstOrders: firstOrders.map((f) => ({ day: f.day, customers: num(f.customers) })),
      load,
      statuses: statusCounts(statuses.map((s) => ({ status: s.status, count: num(s.count) }))),
    };
  }

  /**
   * Counted orders of the period by local hour and weekday, each order in
   * its own store's zone — a café's 8 a.m. rush is at 8 wherever it is. A
   * store still on the UTC placeholder borrows the period's zone.
   */
  private async load(scope: AnalyticsScope, range: DateRange, stores: readonly StoreZone[]): Promise<LoadRow[]> {
    if (stores.length === 0) return [];
    const ids = stores.map((s) => s.id);
    const zones = stores.map((s) => (isLocalTimeZone(s.timezone) ? canonicalTimeZone(s.timezone) : range.timeZone));
    const local = Prisma.sql`(o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE z."tz"`;
    const rows = await this.prisma.$queryRaw<Array<{ hour: Num; weekday: Num; orders: Num; revenue: Num }>>`
      SELECT EXTRACT(HOUR FROM ${local})::int AS "hour",
             EXTRACT(ISODOW FROM ${local})::int AS "weekday",
             COUNT(*)::int AS "orders",
             COALESCE(SUM(o."totalCents"), 0)::bigint AS "revenue"
      FROM "Order" o
      JOIN "Store" s ON s.id = o."storeId"
      JOIN unnest(${ids}::text[], ${zones}::text[]) AS z("storeId", "tz") ON z."storeId" = o."storeId"
      ${whereAll([...scopeConditions(scope), COUNTED, ...createdBetween(range.start, range.end)])}
      GROUP BY 1, 2
    `;
    return rows.map((r) => ({
      hour: num(r.hour),
      weekday: num(r.weekday),
      orders: num(r.orders),
      revenue: num(r.revenue),
    }));
  }
}
