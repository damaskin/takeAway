import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { addDays, type DateRange } from './analytics-range';
import type { AnalyticsScope } from './analytics-scope';
import {
  COUNTED,
  PICKUP_DONE,
  createdBetween,
  num,
  orderWhere,
  scopeConditions,
  storeWhere,
  utc,
  whereAll,
} from './analytics-sql';
import { customerLabels } from './customer-labels';
import {
  BrandPerformanceDto,
  ChurnDto,
  CohortStatsDto,
  DashboardSummaryDto,
  OrderStatusStatsDto,
  RevenuePointDto,
  RevenueSeriesDto,
  StaffPerformanceDto,
  StorePerformanceDto,
  TopProductDto,
  WinBackDto,
  WinBackPeriodDto,
} from './dto/analytics.dto';
import {
  type ChurnWindow,
  type CustomerTotals,
  type ReturnedCustomer,
  type WinBackSummary,
  churnBounds,
  lapsedBefore,
  percentChange,
  summarizeChurn,
  summarizeWinBack,
} from './retention';

/** Daily roll-up shape from the `mv_orders_daily` materialized view. */
interface OrdersDailyRow {
  brandId: string;
  storeId: string;
  day: Date;
  orderCount: bigint;
  revenueCents: bigint;
}

const SQL_DATE_DAY = (d: Date): string => d.toISOString().slice(0, 10);

const DAY_MS = 24 * 60 * 60_000;

/** UTC midnight opening a period of `days` calendar days that ends today. */
function periodStart(days: number, now = new Date()): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return new Date(start.getTime() - (days - 1) * DAY_MS);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function share(part: number, total: number): number {
  return total > 0 ? round1((part / total) * 100) : 0;
}

function average(sum: number, count: number): number | null {
  return count > 0 ? Math.round(sum / count) : null;
}

/**
 * M5 — analytics.
 *
 * A brand's figures come from the `Order` table directly, between the two
 * instants the requested calendar days open and close at in the brand's
 * time zone (index `Order(storeId, createdAt)`). The `mv_orders_daily`
 * materialized view buckets by UTC day, which is off by hours for a café
 * east or west of Greenwich, so it only feeds the platform-wide brand list.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async revenueSeries(scope: AnalyticsScope, range: DateRange): Promise<RevenueSeriesDto> {
    const rows = await this.prisma.$queryRaw<Array<{ day: string; orders: number; revenue: bigint }>>`
      SELECT to_char((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone}, 'YYYY-MM-DD') AS "day",
             COUNT(*)::int AS "orders",
             COALESCE(SUM(o."totalCents"), 0)::bigint AS "revenue"
      FROM "Order" o
      JOIN "Store" s ON s.id = o."storeId"
      ${whereAll([...scopeConditions(scope), COUNTED, ...createdBetween(range.previous.start, range.end)])}
      GROUP BY 1
    `;

    const byDay = new Map(rows.map((r) => [r.day, { revenue: num(r.revenue), orders: num(r.orders) }]));
    const points: RevenuePointDto[] = [];
    for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
      const b = byDay.get(day);
      points.push({ date: day, revenueCents: b?.revenue ?? 0, orderCount: b?.orders ?? 0 });
    }
    const totalRevenueCents = points.reduce((sum, p) => sum + p.revenueCents, 0);
    const totalOrders = points.reduce((sum, p) => sum + p.orderCount, 0);
    const previousRevenueCents = rows.filter((r) => r.day < range.from).reduce((sum, r) => sum + num(r.revenue), 0);

    // Only report a "best day" if there's actual revenue to compare against.
    const bestDay = points.reduce<RevenuePointDto | null>(
      (best, p) => (p.revenueCents > 0 && (!best || p.revenueCents > best.revenueCents) ? p : best),
      null,
    );

    return {
      from: range.from,
      to: range.to,
      timeZone: range.timeZone,
      totalRevenueCents,
      totalOrders,
      avgBasketCents: totalOrders ? Math.round(totalRevenueCents / totalOrders) : 0,
      bestDay,
      revenueDeltaPercent: percentChange(previousRevenueCents, totalRevenueCents) ?? (totalRevenueCents > 0 ? 100 : 0),
      previousRevenueCents,
      points,
    };
  }

  async topProducts(scope: AnalyticsScope, range: DateRange, take = 10): Promise<TopProductDto[]> {
    // Grouped by the name in the order snapshot, so a renamed product still
    // rolls up under the label it was sold with.
    const rows = await this.prisma.$queryRaw<Array<{ name: string; units: number; revenue: bigint }>>`
      SELECT COALESCE(oi."productSnapshot"->>'name', 'Unknown') AS "name",
             COALESCE(SUM(oi."quantity"), 0)::int AS "units",
             COALESCE(SUM(oi."totalCents"), 0)::bigint AS "revenue"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "Store" s ON s.id = o."storeId"
      ${whereAll([...scopeConditions(scope), COUNTED, ...createdBetween(range.start, range.end)])}
      GROUP BY 1
      ORDER BY 3 DESC, 2 DESC
      LIMIT ${take}
    `;
    return rows.map((r) => ({ name: r.name, unitsSold: num(r.units), revenueCents: num(r.revenue) }));
  }

  async cohort(scope: AnalyticsScope, range: DateRange): Promise<CohortStatsDto> {
    const where: Prisma.OrderWhereInput = {
      ...orderWhere(scope),
      createdAt: { gte: range.start, lt: range.end },
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.EXPIRED] },
    };

    const orders = await this.prisma.order.findMany({
      where,
      select: { userId: true, totalCents: true, acceptedAt: true, readyAt: true, createdAt: true },
    });

    const byUser = new Map<string, number>();
    let sum = 0;
    let slaHits = 0;
    let slaTotal = 0;
    for (const o of orders) {
      byUser.set(o.userId, (byUser.get(o.userId) ?? 0) + 1);
      sum += o.totalCents;
      if (o.readyAt) {
        slaTotal++;
        const secs = (o.readyAt.getTime() - (o.acceptedAt ?? o.createdAt).getTime()) / 1000;
        if (secs <= 7 * 60) slaHits++;
      }
    }

    const userIds = [...byUser.keys()];
    const repeatCount = userIds.filter((id) => (byUser.get(id) ?? 0) > 1).length;
    const repeatRate = userIds.length ? (repeatCount / userIds.length) * 100 : 0;

    // New to *this* business: their first order here falls in the range.
    const firstOrders = await this.prisma.order.groupBy({
      by: ['userId'],
      where: {
        ...orderWhere(scope),
        userId: { in: userIds },
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.EXPIRED] },
      },
      _min: { createdAt: true },
    });
    const newCustomers = firstOrders.filter((row) => row._min.createdAt && row._min.createdAt >= range.start).length;

    return {
      repeatRatePercent: Math.round(repeatRate),
      avgBasketCents: orders.length ? Math.round(sum / orders.length) : 0,
      newCustomers,
      pickupSlaPercent: slaTotal ? Math.round((slaHits / slaTotal) * 100) : 0,
    };
  }

  /**
   * The platform view: every brand with its figures for the period, busiest
   * first. Brands without a single order are listed too — a platform admin
   * looks here for the ones that signed up and never took off.
   */
  async brandPerformance(days = 7): Promise<BrandPerformanceDto[]> {
    const since = SQL_DATE_DAY(periodStart(days));
    const [rows, brands] = await Promise.all([
      this.prisma.$queryRaw<OrdersDailyRow[]>`
        SELECT "brandId", "storeId", "day", "orderCount", "revenueCents"
        FROM "mv_orders_daily"
        WHERE "day" >= ${since}::date
      `,
      this.prisma.brand.findMany({
        select: {
          id: true,
          name: true,
          currency: true,
          moderationStatus: true,
          plan: true,
          commissionBps: true,
          _count: { select: { stores: true } },
        },
      }),
    ]);

    const byBrand = new Map<string, { orders: number; revenue: number }>();
    for (const r of rows) {
      const acc = byBrand.get(r.brandId) ?? { orders: 0, revenue: 0 };
      acc.orders += Number(r.orderCount);
      acc.revenue += Number(r.revenueCents);
      byBrand.set(r.brandId, acc);
    }

    return brands
      .map((b) => ({
        brandId: b.id,
        brandName: b.name,
        currency: b.currency,
        moderationStatus: b.moderationStatus,
        plan: b.plan,
        commissionBps: b.commissionBps,
        stores: b._count.stores,
        orders: byBrand.get(b.id)?.orders ?? 0,
        revenueCents: byBrand.get(b.id)?.revenue ?? 0,
      }))
      .sort((a, b) => b.orders - a.orders || b.revenueCents - a.revenueCents || a.brandName.localeCompare(b.brandName));
  }

  /**
   * Every store in scope over the period, busiest first, idle ones included.
   * Revenue and orders on every plan; `detailed` adds the comparison a PRO
   * brand gets — shares, average check, pickup and prep times, cancellations,
   * staff — and the change against the period before.
   */
  async storePerformance(scope: AnalyticsScope, range: DateRange, detailed: boolean): Promise<StorePerformanceDto[]> {
    const current = Prisma.sql`o."createdAt" >= ${utc(range.start)}`;
    const previous = Prisma.sql`o."createdAt" < ${utc(range.start)}`;
    const [stores, rows, staffRows] = await Promise.all([
      this.prisma.store.findMany({ where: storeWhere(scope), select: { id: true, name: true } }),
      this.prisma.$queryRaw<
        Array<{
          storeId: string;
          orders: number;
          revenue: bigint;
          previousRevenue: bigint;
          placed: number;
          cancelled: number;
          expired: number;
          pickupSecSum: number;
          pickupCount: number;
          prepSecSum: number;
          prepCount: number;
          customers: number;
        }>
      >`
        SELECT o."storeId" AS "storeId",
               COUNT(*) FILTER (WHERE ${current} AND ${COUNTED})::int AS "orders",
               COALESCE(SUM(o."totalCents") FILTER (WHERE ${current} AND ${COUNTED}), 0)::bigint AS "revenue",
               COALESCE(SUM(o."totalCents") FILTER (WHERE ${previous} AND ${COUNTED}), 0)::bigint AS "previousRevenue",
               COUNT(*) FILTER (WHERE ${current})::int AS "placed",
               COUNT(*) FILTER (WHERE ${current} AND o."status" = 'CANCELLED')::int AS "cancelled",
               COUNT(*) FILTER (WHERE ${current} AND o."status" = 'EXPIRED')::int AS "expired",
               COALESCE(SUM(EXTRACT(EPOCH FROM (o."pickedUpAt" - o."readyAt")))
                 FILTER (WHERE ${current} AND ${PICKUP_DONE}), 0)::float8 AS "pickupSecSum",
               COUNT(*) FILTER (WHERE ${current} AND ${PICKUP_DONE})::int AS "pickupCount",
               COALESCE(SUM(EXTRACT(EPOCH FROM (o."readyAt" - COALESCE(o."acceptedAt", o."createdAt"))))
                 FILTER (WHERE ${current} AND o."readyAt" IS NOT NULL), 0)::float8 AS "prepSecSum",
               COUNT(*) FILTER (WHERE ${current} AND o."readyAt" IS NOT NULL)::int AS "prepCount",
               COUNT(DISTINCT o."userId") FILTER (WHERE ${current} AND ${COUNTED})::int AS "customers"
        FROM "Order" o
        JOIN "Store" s ON s.id = o."storeId"
        ${whereAll([...scopeConditions(scope), ...createdBetween(range.previous.start, range.end)])}
        GROUP BY 1
      `,
      detailed
        ? this.prisma.$queryRaw<Array<{ storeId: string; staff: number }>>`
            SELECT o."storeId" AS "storeId", COUNT(DISTINCT e."actorId")::int AS "staff"
            FROM "OrderEvent" e
            JOIN "Order" o ON o.id = e."orderId"
            JOIN "Store" s ON s.id = o."storeId"
            JOIN "User" u ON u.id = e."actorId"
            ${whereAll([
              ...scopeConditions(scope),
              Prisma.sql`e."type" = 'STATUS_CHANGED'`,
              Prisma.sql`u."role" <> 'CUSTOMER'`,
              ...createdBetween(range.start, range.end),
            ])}
            GROUP BY 1
          `
        : Promise.resolve([]),
    ]);

    const byStore = new Map(rows.map((r) => [r.storeId, r]));
    const staffByStore = new Map(staffRows.map((r) => [r.storeId, num(r.staff)]));
    const totalRevenue = rows.reduce((sum, r) => sum + num(r.revenue), 0);
    const totalOrders = rows.reduce((sum, r) => sum + num(r.orders), 0);

    return stores
      .map<StorePerformanceDto>((store) => {
        const r = byStore.get(store.id);
        const orders = num(r?.orders);
        const revenue = num(r?.revenue);
        const base = {
          storeId: store.id,
          storeName: store.name,
          revenueCents: revenue,
          orders,
          sharePercent: share(revenue, totalRevenue),
        };
        if (!detailed) {
          return {
            ...base,
            detailed: false,
            ordersSharePercent: null,
            avgCheckCents: null,
            avgPickupSeconds: null,
            avgPrepSeconds: null,
            cancelled: null,
            expired: null,
            cancelRatePercent: null,
            customers: null,
            staff: null,
            ordersPerStaff: null,
            previousRevenueCents: null,
            revenueDeltaPercent: null,
          };
        }
        const placed = num(r?.placed);
        const cancelled = num(r?.cancelled);
        const expired = num(r?.expired);
        const staff = staffByStore.get(store.id) ?? 0;
        const previousRevenue = num(r?.previousRevenue);
        return {
          ...base,
          detailed: true,
          ordersSharePercent: share(orders, totalOrders),
          avgCheckCents: average(revenue, orders) ?? 0,
          avgPickupSeconds: average(num(r?.pickupSecSum), num(r?.pickupCount)),
          avgPrepSeconds: average(num(r?.prepSecSum), num(r?.prepCount)),
          cancelled,
          expired,
          cancelRatePercent: placed > 0 ? share(cancelled + expired, placed) : null,
          customers: num(r?.customers),
          staff,
          ordersPerStaff: staff > 0 ? round1(orders / staff) : null,
          previousRevenueCents: previousRevenue,
          revenueDeltaPercent: percentChange(previousRevenue, revenue),
        };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents || b.orders - a.orders || a.storeName.localeCompare(b.storeName));
  }

  /**
   * Who moved the period's orders along, from the order timeline, and the
   * shifts they opened. A shift is the store's, opened by one person, so its
   * hours are credited to whoever opened it — a fair proxy while there is no
   * clock-in per employee.
   */
  async staffPerformance(scope: AnalyticsScope, range: DateRange, now = new Date()): Promise<StaffPerformanceDto[]> {
    const shiftEnd = Prisma.sql`COALESCE(sh."closedAt", ${utc(now)})`;
    const [events, shifts] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ userId: string; accepted: number; ready: number; completed: number; handled: number }>
      >`
        SELECT e."actorId" AS "userId",
               COUNT(*) FILTER (WHERE e."payload"->>'to' = 'ACCEPTED')::int AS "accepted",
               COUNT(*) FILTER (WHERE e."payload"->>'to' = 'READY')::int AS "ready",
               COUNT(*) FILTER (WHERE e."payload"->>'to' IN ('PICKED_UP', 'DELIVERED'))::int AS "completed",
               COUNT(DISTINCT e."orderId")::int AS "handled"
        FROM "OrderEvent" e
        JOIN "Order" o ON o.id = e."orderId"
        JOIN "Store" s ON s.id = o."storeId"
        JOIN "User" u ON u.id = e."actorId"
        ${whereAll([
          ...scopeConditions(scope),
          Prisma.sql`e."type" = 'STATUS_CHANGED'`,
          Prisma.sql`u."role" <> 'CUSTOMER'`,
          ...createdBetween(range.start, range.end),
        ])}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ userId: string; shifts: number; seconds: number }>>`
        SELECT sh."openedById" AS "userId",
               COUNT(*)::int AS "shifts",
               COALESCE(SUM(EXTRACT(EPOCH FROM (
                 LEAST(${shiftEnd}, ${utc(range.end)}) - GREATEST(sh."openedAt", ${utc(range.start)})
               ))), 0)::float8 AS "seconds"
        FROM "StoreShift" sh
        JOIN "Store" s ON s.id = sh."storeId"
        ${whereAll([
          ...scopeConditions(scope, Prisma.raw('sh."storeId"')),
          Prisma.sql`sh."openedById" IS NOT NULL`,
          Prisma.sql`sh."openedAt" < ${utc(range.end)}`,
          Prisma.sql`${shiftEnd} > ${utc(range.start)}`,
        ])}
        GROUP BY 1
      `,
    ]);

    const userIds = [...new Set([...events.map((e) => e.userId), ...shifts.map((s) => s.userId)])];
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, role: { not: 'CUSTOMER' } },
      select: { id: true, name: true, email: true, role: true },
    });
    const eventsBy = new Map(events.map((e) => [e.userId, e]));
    const shiftsBy = new Map(shifts.map((s) => [s.userId, s]));

    return users
      .map((user) => {
        const e = eventsBy.get(user.id);
        const sh = shiftsBy.get(user.id);
        const completed = num(e?.completed);
        const hours = round1(Math.max(0, num(sh?.seconds)) / 3600);
        return {
          userId: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          accepted: num(e?.accepted),
          ready: num(e?.ready),
          completed,
          handled: num(e?.handled),
          shifts: num(sh?.shifts),
          shiftHours: hours,
          ordersPerHour: hours > 0 ? round1(completed / hours) : null,
        };
      })
      .sort((a, b) => b.handled - a.handled || b.shiftHours - a.shiftHours);
  }

  /**
   * Where the orders stand: how many sit in each open status right now, and
   * how the orders placed in the period ended up. `live` ignores the period
   * on purpose — an order accepted yesterday and still on the board matters
   * today.
   */
  async orderStatuses(scope: AnalyticsScope, range: DateRange): Promise<OrderStatusStatsDto> {
    const base = orderWhere(scope);
    const [live, period] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { ...base, status: { in: LIVE_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { ...base, createdAt: { gte: range.start, lt: range.end } },
        _count: { _all: true },
      }),
    ]);

    const liveCounts = countByStatus(live, LIVE_STATUSES);
    const byStatus = countByStatus(period, Object.values(OrderStatus));
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    const completed = byStatus.PICKED_UP + byStatus.DELIVERED;
    // Only orders that have finished one way or another count towards the
    // rate; the ones still in the kitchen have not failed yet.
    const settled = completed + byStatus.CANCELLED + byStatus.EXPIRED;

    return {
      from: range.from,
      to: range.to,
      timeZone: range.timeZone,
      days: range.days,
      live: liveCounts,
      liveTotal: Object.values(liveCounts).reduce((sum, n) => sum + n, 0),
      period: {
        total,
        completed,
        cancelled: byStatus.CANCELLED,
        expired: byStatus.EXPIRED,
        completionRatePercent: settled > 0 ? Math.round((completed / settled) * 1000) / 10 : null,
        byStatus,
      },
    };
  }

  /** The dashboard's KPI cards: the range against as many days right before it. */
  async dashboardSummary(scope: AnalyticsScope, range: DateRange): Promise<DashboardSummaryDto> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        bucket: 'current' | 'previous';
        orders: number;
        revenue: bigint;
        pickupSecSum: number;
        pickupCount: number;
      }>
    >`
      SELECT CASE WHEN o."createdAt" >= ${utc(range.start)} THEN 'current' ELSE 'previous' END AS "bucket",
             COUNT(*)::int AS "orders",
             COALESCE(SUM(o."totalCents"), 0)::bigint AS "revenue",
             COALESCE(SUM(EXTRACT(EPOCH FROM (o."pickedUpAt" - o."readyAt"))) FILTER (WHERE ${PICKUP_DONE}), 0)::float8
               AS "pickupSecSum",
             COUNT(*) FILTER (WHERE ${PICKUP_DONE})::int AS "pickupCount"
      FROM "Order" o
      JOIN "Store" s ON s.id = o."storeId"
      ${whereAll([...scopeConditions(scope), COUNTED, ...createdBetween(range.previous.start, range.end)])}
      GROUP BY 1
    `;

    const pick = (bucket: 'current' | 'previous') => {
      const r = rows.find((row) => row.bucket === bucket);
      return {
        orders: num(r?.orders),
        revenue: num(r?.revenue),
        pickup: average(num(r?.pickupSecSum), num(r?.pickupCount)),
      };
    };
    const current = pick('current');
    const previous = pick('previous');
    const avgCheck = average(current.revenue, current.orders) ?? 0;
    const avgCheckBefore = average(previous.revenue, previous.orders) ?? 0;

    return {
      from: range.from,
      to: range.to,
      timeZone: range.timeZone,
      days: range.days,
      revenueCents: current.revenue,
      orders: current.orders,
      avgCheckCents: avgCheck,
      avgPickupSeconds: current.pickup ?? 0,
      // No ratings are collected yet. A made-up score on a business's own
      // dashboard is worse than an honest blank.
      nps: null,
      revenueDeltaPercent: percentChange(previous.revenue, current.revenue),
      ordersDeltaPercent: percentChange(previous.orders, current.orders),
      avgCheckDeltaPercent: percentChange(avgCheckBefore, avgCheck),
      pickupDeltaSeconds: current.pickup !== null && previous.pickup !== null ? current.pickup - previous.pickup : null,
    };
  }

  /**
   * Customers lost during the range — see `retention.ts` for the rule — with
   * the same for the period before. `withList` names them (PRO).
   */
  async churn(
    scope: AnalyticsScope,
    range: DateRange,
    window: ChurnWindow,
    withList: boolean,
    take = 20,
    now = new Date(),
  ): Promise<ChurnDto> {
    const currentBounds = churnBounds(range.start, range.end, window, now);
    const previousBounds = churnBounds(range.previous.start, range.previous.end, window, now);
    const [currentRows, previousRows] = await Promise.all([
      this.lastOrders(scope, currentBounds),
      this.lastOrders(scope, previousBounds),
    ]);
    const current = summarizeChurn(currentRows, currentBounds);
    const previous = summarizeChurn(previousRows, previousBounds);

    let customers: ChurnDto['customers'] = null;
    if (withList) {
      const listed = current.customers.slice(0, take);
      const labels = await customerLabels(
        this.prisma,
        scope,
        listed.map((c) => c.userId),
      );
      customers = listed.map((c) => ({
        userId: c.userId,
        name: labels.get(c.userId)?.name ?? null,
        phone: labels.get(c.userId)?.phone ?? null,
        orders: c.orders,
        totalCents: c.totalCents,
        avgCheckCents: c.avgCheckCents,
        lastOrderAt: c.lastOrderAt.toISOString(),
        daysSinceLastOrder: c.daysSinceLastOrder,
      }));
    }

    return {
      from: range.from,
      to: range.to,
      timeZone: range.timeZone,
      window,
      count: current.count,
      lostRevenueCents: current.lostRevenueCents,
      previous: { count: previous.count, lostRevenueCents: previous.lostRevenueCents },
      countDeltaPercent: percentChange(previous.count, current.count),
      customers,
    };
  }

  /** Lost customers who came back during the range, against the period before. */
  async winBack(
    scope: AnalyticsScope,
    range: DateRange,
    window: ChurnWindow,
    take = 20,
    now = new Date(),
  ): Promise<WinBackDto> {
    const [current, previous] = await Promise.all([
      this.winBackPeriod(scope, range.start, range.end, window, now),
      this.winBackPeriod(scope, range.previous.start, range.previous.end, window, now),
    ]);
    const listed = current.customers.slice(0, take);
    const labels = await customerLabels(
      this.prisma,
      scope,
      listed.map((c) => c.userId),
    );
    const period = (s: WinBackSummary): WinBackPeriodDto => ({
      lapsedAtStart: s.lapsedAtStart,
      returned: s.returned,
      returnRatePercent: s.returnRatePercent,
      orders: s.orders,
      revenueCents: s.revenueCents,
    });
    return {
      from: range.from,
      to: range.to,
      timeZone: range.timeZone,
      window,
      current: period(current),
      previous: period(previous),
      returnedDeltaPercent: percentChange(previous.returned, current.returned),
      revenueDeltaPercent: percentChange(previous.revenueCents, current.revenueCents),
      customers: listed.map((c) => ({
        userId: c.userId,
        name: labels.get(c.userId)?.name ?? null,
        phone: labels.get(c.userId)?.phone ?? null,
        lastOrderBefore: c.lastOrderBefore.toISOString(),
        returnedAt: c.returnedAt.toISOString(),
        daysAway: c.daysAway,
        orders: c.orders,
        revenueCents: c.revenueCents,
      })),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /**
   * Each customer's last order before `asOf`, with their order count and
   * spend, for the customers whose last order falls in the churn bounds.
   * Deleted accounts are left out: they cannot come back.
   */
  private async lastOrders(
    scope: AnalyticsScope,
    bounds: { asOf: Date; lastOrderFrom: Date; lastOrderBefore: Date },
  ): Promise<CustomerTotals[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string; lastOrderAt: Date; orders: number; totalCents: bigint }>
    >`
      SELECT o."userId" AS "userId",
             MAX(o."createdAt") AS "lastOrderAt",
             COUNT(*)::int AS "orders",
             COALESCE(SUM(o."totalCents"), 0)::bigint AS "totalCents"
      FROM "Order" o
      JOIN "Store" s ON s.id = o."storeId"
      JOIN "User" u ON u.id = o."userId"
      ${whereAll([
        ...scopeConditions(scope),
        COUNTED,
        Prisma.sql`o."createdAt" < ${utc(bounds.asOf)}`,
        Prisma.sql`u."blockedAt" IS NULL`,
      ])}
      GROUP BY o."userId"
      HAVING MAX(o."createdAt") >= ${utc(bounds.lastOrderFrom)} AND MAX(o."createdAt") < ${utc(bounds.lastOrderBefore)}
    `;
    return rows.map((r) => ({
      userId: r.userId,
      lastOrderAt: r.lastOrderAt,
      orders: num(r.orders),
      totalCents: num(r.totalCents),
    }));
  }

  private async winBackPeriod(
    scope: AnalyticsScope,
    start: Date,
    end: Date,
    window: ChurnWindow,
    now: Date,
  ): Promise<WinBackSummary> {
    const asOf = new Date(Math.min(end.getTime(), now.getTime()));
    const lapsedLine = lapsedBefore(start, window);
    const lapsed = Prisma.sql`
      SELECT o."userId" AS "userId", MAX(o."createdAt") AS "lastOrderBefore"
      FROM "Order" o
      JOIN "Store" s ON s.id = o."storeId"
      JOIN "User" u ON u.id = o."userId"
      ${whereAll([
        ...scopeConditions(scope),
        COUNTED,
        Prisma.sql`o."createdAt" < ${utc(start)}`,
        Prisma.sql`u."blockedAt" IS NULL`,
      ])}
      GROUP BY o."userId"
      HAVING MAX(o."createdAt") < ${utc(lapsedLine)}
    `;
    const [pool, returned] = await Promise.all([
      this.prisma.$queryRaw<Array<{ lapsed: number }>>`SELECT COUNT(*)::int AS "lapsed" FROM (${lapsed}) l`,
      this.prisma.$queryRaw<
        Array<{ userId: string; lastOrderBefore: Date; returnedAt: Date; orders: number; revenueCents: bigint }>
      >`
        WITH lapsed AS (${lapsed})
        SELECT l."userId" AS "userId",
               l."lastOrderBefore" AS "lastOrderBefore",
               MIN(o."createdAt") AS "returnedAt",
               COUNT(*)::int AS "orders",
               COALESCE(SUM(o."totalCents"), 0)::bigint AS "revenueCents"
        FROM lapsed l
        JOIN "Order" o ON o."userId" = l."userId"
        JOIN "Store" s ON s.id = o."storeId"
        ${whereAll([...scopeConditions(scope), COUNTED, ...createdBetween(start, asOf)])}
        GROUP BY l."userId", l."lastOrderBefore"
      `,
    ]);
    const rows: ReturnedCustomer[] = returned.map((r) => ({
      userId: r.userId,
      lastOrderBefore: r.lastOrderBefore,
      returnedAt: r.returnedAt,
      orders: num(r.orders),
      revenueCents: num(r.revenueCents),
    }));
    return summarizeWinBack(num(pool[0]?.lapsed), rows);
  }
}

/** Statuses of an order that is still somebody's job. */
const LIVE_STATUSES: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.PAID,
  OrderStatus.ACCEPTED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
];

/** Every requested status present, zero where nothing matched. */
function countByStatus<S extends OrderStatus>(
  rows: ReadonlyArray<{ status: OrderStatus; _count: { _all: number } }>,
  statuses: readonly S[],
): Record<S, number> {
  const counts = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<S, number>;
  for (const row of rows) {
    if ((statuses as readonly OrderStatus[]).includes(row.status)) counts[row.status as S] = row._count._all;
  }
  return counts;
}
