import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  CohortStatsDto,
  DashboardSummaryDto,
  RevenuePointDto,
  RevenueSeriesDto,
  StorePerformanceDto,
  TopProductDto,
} from './dto/analytics.dto';

/**
 * Daily roll-up shape from the `mv_orders_daily` materialized view. Bigints
 * come back as JS bigints from `$queryRaw`; we coerce to number when summing,
 * since per-day order counts and cents totals fit comfortably in Number.MAX
 * for any realistic brand.
 */
interface OrdersDailyRow {
  brandId: string;
  storeId: string;
  day: Date;
  orderCount: bigint;
  revenueCents: bigint;
  slaHits: bigint;
  slaTotal: bigint;
  pickupSecSum: bigint;
  pickupSecCount: bigint;
}

const SQL_DATE_DAY = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * M5 — analytics.
 *
 * `revenueSeries`, `dashboardSummary` and `storePerformance` read from the
 * `mv_orders_daily` materialized view (refreshed every 5 minutes by
 * AnalyticsRefreshService). `topProducts` and `cohort` still aggregate
 * over the live `OrderItem` / `User` tables — those rolls-ups need fields
 * that aren't in the MV yet (productSnapshot.name, user createdAt). They
 * stay raw for now and are the next MV candidates if they show up in
 * p95 telemetry.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async revenueSeries(days = 14, brandId?: string): Promise<RevenueSeriesDto> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60_000);
    const prevStart = new Date(start.getTime() - days * 24 * 60 * 60_000);

    const [current, previous] = await Promise.all([
      this.aggregateRevenue(start, end, brandId),
      this.aggregateRevenue(prevStart, start, brandId),
    ]);

    // Only report a "best day" if there's actual revenue to compare against.
    // Otherwise the reducer happily picks the first zero-revenue bucket and
    // the UI renders "Best day: <date> — $0".
    const bestDay = current.points.reduce<RevenuePointDto | null>(
      (best, p) => (p.revenueCents > 0 && (!best || p.revenueCents > best.revenueCents) ? p : best),
      null,
    );

    const delta =
      previous.totalRevenueCents > 0
        ? ((current.totalRevenueCents - previous.totalRevenueCents) / previous.totalRevenueCents) * 100
        : current.totalRevenueCents > 0
          ? 100
          : 0;

    return {
      totalRevenueCents: current.totalRevenueCents,
      totalOrders: current.totalOrders,
      avgBasketCents: current.totalOrders ? Math.round(current.totalRevenueCents / current.totalOrders) : 0,
      bestDay,
      revenueDeltaPercent: Math.round(delta * 10) / 10,
      points: current.points,
    };
  }

  async topProducts(brandId?: string, take = 10): Promise<TopProductDto[]> {
    // OrderItem.productSnapshot is a jsonb with a `name` field; we aggregate
    // by snapshot name so renamed products still roll up under their original
    // label for the period we're analyzing.
    const where: Prisma.OrderWhereInput = { status: { not: OrderStatus.CANCELLED } };
    if (brandId) where.store = { brandId };

    const items = await this.prisma.orderItem.findMany({
      where: { order: where },
      select: { productSnapshot: true, quantity: true, totalCents: true },
      take: 5000, // cap — a heavy brand shouldn't load everything at once
      orderBy: { order: { createdAt: 'desc' } },
    });

    const buckets = new Map<string, { name: string; units: number; revenue: number }>();
    for (const it of items) {
      const snap = (it.productSnapshot as Record<string, unknown> | null) ?? null;
      const name = snap && typeof snap['name'] === 'string' ? (snap['name'] as string) : 'Unknown';
      const b = buckets.get(name) ?? { name, units: 0, revenue: 0 };
      b.units += it.quantity;
      b.revenue += it.totalCents;
      buckets.set(name, b);
    }

    return [...buckets.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, take)
      .map((b) => ({ name: b.name, unitsSold: b.units, revenueCents: b.revenue }));
  }

  async cohort(brandId?: string, days = 30): Promise<CohortStatsDto> {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const where: Prisma.OrderWhereInput = {
      createdAt: { gte: since },
      status: { not: OrderStatus.CANCELLED },
    };
    if (brandId) where.store = { brandId };

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

    const newCustomers = await this.prisma.user.count({ where: { createdAt: { gte: since } } });

    return {
      repeatRatePercent: Math.round(repeatRate),
      avgBasketCents: orders.length ? Math.round(sum / orders.length) : 0,
      newCustomers,
      pickupSlaPercent: slaTotal ? Math.round((slaHits / slaTotal) * 100) : 0,
    };
  }

  async storePerformance(brandId?: string, days = 14): Promise<StorePerformanceDto[]> {
    const since = SQL_DATE_DAY(new Date(Date.now() - days * 24 * 60 * 60_000));
    const rows = await this.fetchOrdersDaily({ brandId, sinceDay: since });

    const byStore = new Map<string, { orders: number; revenue: number }>();
    for (const r of rows) {
      const acc = byStore.get(r.storeId) ?? { orders: 0, revenue: 0 };
      acc.orders += Number(r.orderCount);
      acc.revenue += Number(r.revenueCents);
      byStore.set(r.storeId, acc);
    }
    if (byStore.size === 0) return [];

    const stores = await this.prisma.store.findMany({
      where: { id: { in: [...byStore.keys()] } },
      select: { id: true, name: true },
    });
    const storeName = new Map(stores.map((s) => [s.id, s.name]));

    const total = [...byStore.values()].reduce((sum, b) => sum + b.revenue, 0);
    return [...byStore.entries()]
      .map(([storeId, b]) => ({
        storeId,
        storeName: storeName.get(storeId) ?? 'Unknown',
        revenueCents: b.revenue,
        orders: b.orders,
        sharePercent: total ? Math.round((b.revenue / total) * 100) : 0,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);
  }

  async dashboardSummary(brandId?: string): Promise<DashboardSummaryDto> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60_000);

    // Single MV scan that covers both today and yesterday. We slice the rows
    // in JS — cheaper than two roundtrips.
    const rows = await this.fetchOrdersDaily({ brandId, sinceDay: SQL_DATE_DAY(yesterday) });
    const todayKey = SQL_DATE_DAY(today);
    const yesterdayKey = SQL_DATE_DAY(yesterday);

    let todayRev = 0,
      todayOrders = 0,
      ydayRev = 0,
      ydayOrders = 0,
      pickupSecSum = 0,
      pickupSecCount = 0;
    for (const r of rows) {
      const dayKey = SQL_DATE_DAY(r.day);
      if (dayKey === todayKey) {
        todayRev += Number(r.revenueCents);
        todayOrders += Number(r.orderCount);
        pickupSecSum += Number(r.pickupSecSum);
        pickupSecCount += Number(r.pickupSecCount);
      } else if (dayKey === yesterdayKey) {
        ydayRev += Number(r.revenueCents);
        ydayOrders += Number(r.orderCount);
      }
    }

    const revDelta = ydayRev > 0 ? ((todayRev - ydayRev) / ydayRev) * 100 : 0;
    const ordersDelta = ydayOrders > 0 ? ((todayOrders - ydayOrders) / ydayOrders) * 100 : 0;

    return {
      revenueTodayCents: todayRev,
      ordersToday: todayOrders,
      avgPickupSeconds: pickupSecCount > 0 ? Math.round(pickupSecSum / pickupSecCount) : 0,
      nps: 82, // placeholder until we collect ratings (M5.3)
      deltas: {
        revenue: this.fmtDelta(revDelta),
        orders: this.fmtDelta(ordersDelta),
        pickup: '0s',
        nps: '+0',
      },
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /**
   * Aggregates revenue + order count from `mv_orders_daily`. The MV bucket
   * granularity is one UTC day, so we always emit one RevenuePointDto per
   * day in [start, end) — including zero-revenue days, which the chart needs
   * for a continuous x-axis.
   */
  private async aggregateRevenue(
    start: Date,
    end: Date,
    brandId?: string,
  ): Promise<{
    totalRevenueCents: number;
    totalOrders: number;
    points: RevenuePointDto[];
  }> {
    const startDay = new Date(start);
    startDay.setUTCHours(0, 0, 0, 0);
    // SQL "day < untilDay" is exclusive — pass end's calendar day + 1 so an
    // in-progress day is included (e.g. end=14:30 today, untilDay=tomorrow).
    const endDayExclusive = new Date(end);
    endDayExclusive.setUTCHours(0, 0, 0, 0);
    endDayExclusive.setUTCDate(endDayExclusive.getUTCDate() + 1);
    const rows = await this.fetchOrdersDaily({
      brandId,
      sinceDay: SQL_DATE_DAY(startDay),
      untilDay: SQL_DATE_DAY(endDayExclusive),
    });

    const byDay = new Map<string, { revenue: number; count: number }>();
    for (const r of rows) {
      const key = SQL_DATE_DAY(r.day);
      const b = byDay.get(key) ?? { revenue: 0, count: 0 };
      b.revenue += Number(r.revenueCents);
      b.count += Number(r.orderCount);
      byDay.set(key, b);
    }

    const points: RevenuePointDto[] = [];
    let totalRevenueCents = 0;
    let totalOrders = 0;
    const cursor = new Date(startDay);
    while (cursor < end) {
      const key = SQL_DATE_DAY(cursor);
      const b = byDay.get(key) ?? { revenue: 0, count: 0 };
      points.push({ date: key, revenueCents: b.revenue, orderCount: b.count });
      totalRevenueCents += b.revenue;
      totalOrders += b.count;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { totalRevenueCents, totalOrders, points };
  }

  /**
   * Reads from the `mv_orders_daily` materialized view. Filtered server-side
   * by brand (when given) and by day range. Returns an empty array when the
   * MV has no matching rows.
   */
  private async fetchOrdersDaily(opts: {
    brandId?: string;
    sinceDay?: string;
    untilDay?: string;
  }): Promise<OrdersDailyRow[]> {
    const { brandId, sinceDay, untilDay } = opts;
    if (brandId && sinceDay && untilDay) {
      return this.prisma.$queryRaw<OrdersDailyRow[]>`
        SELECT "brandId", "storeId", "day", "orderCount", "revenueCents",
               "slaHits", "slaTotal", "pickupSecSum", "pickupSecCount"
        FROM "mv_orders_daily"
        WHERE "brandId" = ${brandId}
          AND "day" >= ${sinceDay}::date
          AND "day" <  ${untilDay}::date
      `;
    }
    if (brandId && sinceDay) {
      return this.prisma.$queryRaw<OrdersDailyRow[]>`
        SELECT "brandId", "storeId", "day", "orderCount", "revenueCents",
               "slaHits", "slaTotal", "pickupSecSum", "pickupSecCount"
        FROM "mv_orders_daily"
        WHERE "brandId" = ${brandId}
          AND "day" >= ${sinceDay}::date
      `;
    }
    if (sinceDay && untilDay) {
      return this.prisma.$queryRaw<OrdersDailyRow[]>`
        SELECT "brandId", "storeId", "day", "orderCount", "revenueCents",
               "slaHits", "slaTotal", "pickupSecSum", "pickupSecCount"
        FROM "mv_orders_daily"
        WHERE "day" >= ${sinceDay}::date AND "day" <  ${untilDay}::date
      `;
    }
    if (sinceDay) {
      return this.prisma.$queryRaw<OrdersDailyRow[]>`
        SELECT "brandId", "storeId", "day", "orderCount", "revenueCents",
               "slaHits", "slaTotal", "pickupSecSum", "pickupSecCount"
        FROM "mv_orders_daily"
        WHERE "day" >= ${sinceDay}::date
      `;
    }
    return this.prisma.$queryRaw<OrdersDailyRow[]>`
      SELECT "brandId", "storeId", "day", "orderCount", "revenueCents",
             "slaHits", "slaTotal", "pickupSecSum", "pickupSecCount"
      FROM "mv_orders_daily"
    `;
  }

  private fmtDelta(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    const sign = rounded >= 0 ? '+' : '';
    return `${sign}${rounded}%`;
  }
}
