import { OrderStatus } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { resolveDateRange } from './analytics-range';
import { AnalyticsService } from './analytics.service';

const WEEK = resolveDateRange({ from: '2026-09-28', to: '2026-10-04' }, 'Europe/Chisinau', 7);

describe('AnalyticsService.orderStatuses', () => {
  function service(live: Array<[OrderStatus, number]>, period: Array<[OrderStatus, number]>) {
    const rows = (pairs: Array<[OrderStatus, number]>) => pairs.map(([status, n]) => ({ status, _count: { _all: n } }));
    const groupBy = jest.fn().mockResolvedValueOnce(rows(live)).mockResolvedValueOnce(rows(period));
    const prisma = { order: { groupBy } } as unknown as PrismaService;
    return { analytics: new AnalyticsService(prisma), groupBy };
  }

  it('counts the open orders now and how the period ended up', async () => {
    const { analytics, groupBy } = service(
      [
        [OrderStatus.PAID, 2],
        [OrderStatus.IN_PROGRESS, 1],
      ],
      [
        [OrderStatus.PICKED_UP, 7],
        [OrderStatus.DELIVERED, 1],
        [OrderStatus.CANCELLED, 1],
        [OrderStatus.EXPIRED, 1],
        [OrderStatus.PAID, 2],
      ],
    );

    const stats = await analytics.orderStatuses({ brandIds: ['b1'], storeIds: null }, WEEK);

    expect(stats.live).toEqual({
      CREATED: 0,
      PAID: 2,
      ACCEPTED: 0,
      IN_PROGRESS: 1,
      READY: 0,
      OUT_FOR_DELIVERY: 0,
    });
    expect(stats.liveTotal).toBe(3);
    expect(stats.period).toEqual(
      expect.objectContaining({ total: 12, completed: 8, cancelled: 1, expired: 1, completionRatePercent: 80 }),
    );
    // Both queries stay inside the caller's brands.
    for (const [args] of groupBy.mock.calls) {
      expect(args.where.store).toEqual({ brandId: { in: ['b1'] } });
    }
    // The period's orders are the ones placed between the range's local midnights.
    expect(groupBy.mock.calls[1]?.[0].where.createdAt).toEqual({ gte: WEEK.start, lt: WEEK.end });
    expect([stats.from, stats.to, stats.days]).toEqual(['2026-09-28', '2026-10-04', 7]);
  });

  it('has no completion rate before anything has finished', async () => {
    const { analytics } = service([], [[OrderStatus.PAID, 3]]);
    const stats = await analytics.orderStatuses({ brandIds: null, storeIds: ['s1'] }, WEEK);
    expect(stats.period.completionRatePercent).toBeNull();
    expect(stats.period.total).toBe(3);
  });
});

describe('AnalyticsService.brandPerformance', () => {
  it('lists every brand, busiest first, idle ones included', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { brandId: 'b2', storeId: 's2', day: new Date(), orderCount: 5n, revenueCents: 5000n },
        { brandId: 'b2', storeId: 's3', day: new Date(), orderCount: 1n, revenueCents: 700n },
        { brandId: 'b1', storeId: 's1', day: new Date(), orderCount: 2n, revenueCents: 9000n },
      ]),
      brand: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'b1',
            name: 'Alpha',
            currency: 'MDL',
            moderationStatus: 'APPROVED',
            plan: 'PRO',
            commissionBps: 1500,
            _count: { stores: 1 },
          },
          {
            id: 'b2',
            name: 'Beta',
            currency: 'MDL',
            moderationStatus: 'APPROVED',
            plan: 'PRO',
            commissionBps: 1500,
            _count: { stores: 2 },
          },
          {
            id: 'b3',
            name: 'Idle',
            currency: 'RUB',
            moderationStatus: 'PENDING',
            plan: 'BASIC',
            commissionBps: 1000,
            _count: { stores: 0 },
          },
        ]),
      },
    } as unknown as PrismaService;

    const rows = await new AnalyticsService(prisma).brandPerformance(7);

    expect(rows.map((r) => [r.brandName, r.orders, r.revenueCents])).toEqual([
      ['Beta', 6, 5700],
      ['Alpha', 2, 9000],
      ['Idle', 0, 0],
    ]);
  });
});

describe('AnalyticsService.storePerformance', () => {
  function service(rows: unknown[], staff: unknown[] = []) {
    const $queryRaw = jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(staff);
    const prisma = {
      $queryRaw,
      store: {
        findMany: jest.fn().mockResolvedValue([
          { id: 's1', name: 'Center' },
          { id: 's2', name: 'Mall' },
          { id: 's3', name: 'New' },
        ]),
      },
    } as unknown as PrismaService;
    return new AnalyticsService(prisma);
  }

  const rows = [
    {
      storeId: 's1',
      orders: 30,
      revenue: 90_000n,
      previousRevenue: 60_000n,
      placed: 32,
      cancelled: 1,
      expired: 1,
      pickupSecSum: 3000,
      pickupCount: 25,
      prepSecSum: 9000,
      prepCount: 30,
      customers: 20,
    },
    {
      storeId: 's2',
      orders: 10,
      revenue: 10_000n,
      previousRevenue: 0n,
      placed: 10,
      cancelled: 0,
      expired: 0,
      pickupSecSum: 0,
      pickupCount: 0,
      prepSecSum: 0,
      prepCount: 0,
      customers: 9,
    },
  ];

  it('gives every plan revenue and orders per store, idle stores included', async () => {
    const result = await service(rows).storePerformance({ brandIds: ['b1'], storeIds: null }, WEEK, false);
    expect(result.map((r) => [r.storeName, r.revenueCents, r.orders, r.sharePercent, r.detailed])).toEqual([
      ['Center', 90_000, 30, 90, false],
      ['Mall', 10_000, 10, 10, false],
      ['New', 0, 0, 0, false],
    ]);
    expect(result[0]).toMatchObject({ avgCheckCents: null, staff: null, cancelRatePercent: null });
  });

  it('compares the stores on PRO', async () => {
    const result = await service(rows, [{ storeId: 's1', staff: 3 }]).storePerformance(
      { brandIds: ['b1'], storeIds: null },
      WEEK,
      true,
    );
    expect(result[0]).toMatchObject({
      ordersSharePercent: 75,
      avgCheckCents: 3_000,
      avgPickupSeconds: 120,
      avgPrepSeconds: 300,
      cancelRatePercent: 6.3,
      staff: 3,
      ordersPerStaff: 10,
      revenueDeltaPercent: 50,
    });
    expect(result[1]).toMatchObject({
      avgPickupSeconds: null,
      staff: 0,
      ordersPerStaff: null,
      revenueDeltaPercent: null,
    });
  });
});

describe('AnalyticsService.churn', () => {
  const NOW = new Date('2026-10-10T00:00:00Z');
  const lost = { userId: 'u1', lastOrderAt: new Date('2026-09-15T08:00:00Z'), orders: 4, totalCents: 20_000n };

  function service() {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValueOnce([lost]).mockResolvedValueOnce([]),
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', name: null, phone: null }]) },
      order: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u1', customerName: 'Ира', customerPhone: '+37377' }]),
      },
    } as unknown as PrismaService;
    return { svc: new AnalyticsService(prisma), prisma };
  }

  it('gives the count and the money without naming anyone on BASIC', async () => {
    const { svc, prisma } = service();
    const churn = await svc.churn({ brandIds: ['b1'], storeIds: null }, WEEK, 14, false, 20, NOW);
    expect(churn).toMatchObject({ window: 14, count: 1, lostRevenueCents: 5_000, previous: { count: 0 } });
    expect(churn.customers).toBeNull();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('lists the lost customers by the name they gave at checkout on PRO', async () => {
    const { svc } = service();
    const churn = await svc.churn({ brandIds: ['b1'], storeIds: null }, WEEK, 14, true, 20, NOW);
    expect(churn.customers).toEqual([
      expect.objectContaining({ userId: 'u1', name: 'Ира', phone: '+37377', avgCheckCents: 5_000 }),
    ]);
  });
});
