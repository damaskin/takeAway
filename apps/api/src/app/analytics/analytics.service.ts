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
 * M5 — analytics.
 *
 * Stage 1: plain SQL aggregations over the orders table. Good enough for
 * single-digit-k orders/day; we'll migrate to a BullMQ-fed materialized view
 * once we hit real volume (roadmap: M5.2).
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
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const where: Prisma.OrderWhereInput = {
      createdAt: { gte: since },
      status: { not: OrderStatus.CANCELLED },
    };
    if (brandId) where.store = { brandId };

    const grouped = await this.prisma.order.groupBy({
      by: ['storeId'],
      where,
      _sum: { totalCents: true },
      _count: { _all: true },
    });

    const stores = await this.prisma.store.findMany({
      where: { id: { in: grouped.map((g) => g.storeId) } },
      select: { id: true, name: true },
    });
    const storeName = new Map(stores.map((s) => [s.id, s.name]));

    const total = grouped.reduce((sum, g) => sum + (g._sum.totalCents ?? 0), 0);

    return grouped
      .map((g) => ({
        storeId: g.storeId,
        storeName: storeName.get(g.storeId) ?? 'Unknown',
        revenueCents: g._sum.totalCents ?? 0,
        orders: g._count._all,
        sharePercent: total ? Math.round(((g._sum.totalCents ?? 0) / total) * 100) : 0,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);
  }

  async dashboardSummary(brandId?: string): Promise<DashboardSummaryDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60_000);

    const [todayAgg, yesterdayAgg, pickupAgg] = await Promise.all([
      this.aggregateRevenue(today, new Date(), brandId),
      this.aggregateRevenue(yesterday, today, brandId),
      this.avgPickupDuration(today, new Date(), brandId),
    ]);

    const revDelta =
      yesterdayAgg.totalRevenueCents > 0
        ? ((todayAgg.totalRevenueCents - yesterdayAgg.totalRevenueCents) / yesterdayAgg.totalRevenueCents) * 100
        : 0;
    const ordersDelta =
      yesterdayAgg.totalOrders > 0
        ? ((todayAgg.totalOrders - yesterdayAgg.totalOrders) / yesterdayAgg.totalOrders) * 100
        : 0;

    return {
      revenueTodayCents: todayAgg.totalRevenueCents,
      ordersToday: todayAgg.totalOrders,
      avgPickupSeconds: pickupAgg,
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

  private async aggregateRevenue(
    start: Date,
    end: Date,
    brandId?: string,
  ): Promise<{
    totalRevenueCents: number;
    totalOrders: number;
    points: RevenuePointDto[];
  }> {
    const where: Prisma.OrderWhereInput = {
      createdAt: { gte: start, lt: end },
      status: { not: OrderStatus.CANCELLED },
    };
    if (brandId) where.store = { brandId };

    const orders = await this.prisma.order.findMany({
      where,
      select: { totalCents: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const byDay = new Map<string, { revenue: number; count: number }>();
    for (const o of orders) {
      const day = o.createdAt.toISOString().slice(0, 10);
      const b = byDay.get(day) ?? { revenue: 0, count: 0 };
      b.revenue += o.totalCents;
      b.count += 1;
      byDay.set(day, b);
    }

    const points: RevenuePointDto[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor < end) {
      const key = cursor.toISOString().slice(0, 10);
      const b = byDay.get(key) ?? { revenue: 0, count: 0 };
      points.push({ date: key, revenueCents: b.revenue, orderCount: b.count });
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      totalRevenueCents: orders.reduce((s, o) => s + o.totalCents, 0),
      totalOrders: orders.length,
      points,
    };
  }

  private async avgPickupDuration(start: Date, end: Date, brandId?: string): Promise<number> {
    const where: Prisma.OrderWhereInput = {
      createdAt: { gte: start, lt: end },
      readyAt: { not: null },
      status: OrderStatus.PICKED_UP,
    };
    if (brandId) where.store = { brandId };
    const rows = await this.prisma.order.findMany({
      where,
      select: { readyAt: true, pickedUpAt: true },
    });
    if (rows.length === 0) return 0;
    const totalSec = rows.reduce((sum, r) => {
      if (!r.readyAt || !r.pickedUpAt) return sum;
      return sum + (r.pickedUpAt.getTime() - r.readyAt.getTime()) / 1000;
    }, 0);
    return Math.round(totalSec / rows.length);
  }

  private fmtDelta(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    const sign = rounded >= 0 ? '+' : '';
    return `${sign}${rounded}%`;
  }
}
