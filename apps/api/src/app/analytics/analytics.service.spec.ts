import { OrderStatus, Prisma } from '@prisma/client';

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
          { id: 's1', name: 'Center', currency: 'RUP' },
          { id: 's2', name: 'Mall', currency: 'RUP' },
          { id: 's3', name: 'New', currency: 'RUP' },
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
    expect(result[0]).toMatchObject({ avgCheckCents: null, staff: null, cancelRatePercent: null, currency: 'RUP' });
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

/** The SQL and the bound values of one `$queryRaw` tagged-template call. */
function sqlOf(call: unknown[]): Prisma.Sql {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
}

describe('AnalyticsService.revenueSeries', () => {
  function day(date: string, revenue: number, orders: number, sales = revenue, discounts = 0, giftCards = 0) {
    return {
      day: date,
      orders,
      revenue: BigInt(revenue),
      sales: BigInt(sales),
      discounts: BigInt(discounts),
      giftCards: BigInt(giftCards),
    };
  }

  function service(rows: unknown[]) {
    const $queryRaw = jest.fn().mockResolvedValue(rows);
    return { svc: new AnalyticsService({ $queryRaw } as unknown as PrismaService), $queryRaw };
  }

  it('sums sales less discounts, gift cards included, never the card charge', async () => {
    const { svc, $queryRaw } = service([
      day('2026-09-25', 9_999, 3),
      day('2026-09-29', 2_800, 2, 2_800),
      day('2026-10-02', 4_300, 3, 7_600, 3_300, 1_400),
    ]);
    const r = await svc.revenueSeries({ brandIds: ['b1'], storeIds: null }, WEEK);

    expect(r).toMatchObject({
      totalRevenueCents: 7_100,
      totalOrders: 5,
      avgBasketCents: 1_420,
      // Only the period's days: the 25th belongs to the period before.
      salesCents: 10_400,
      discountCents: 3_300,
      giftCardCents: 1_400,
      previousRevenueCents: 9_999,
      revenueDeltaPercent: -29,
    });
    expect(r.salesCents - r.discountCents).toBe(r.totalRevenueCents);
    const sql = sqlOf($queryRaw.mock.calls[0] as unknown[]).sql;
    expect(sql).toContain('GREATEST(o."subtotalCents" - o."discountCents", 0)');
    expect(sql).not.toContain('o."totalCents"');
  });

  it('has no percentage when the period before sold nothing', async () => {
    const { svc } = service([day('2026-10-02', 6_300, 10)]);
    const r = await svc.revenueSeries({ brandIds: ['b1'], storeIds: null }, WEEK);
    expect(r.previousRevenueCents).toBe(0);
    expect(r.revenueDeltaPercent).toBeNull();
    expect(r.bestDay).toEqual({ date: '2026-10-02', revenueCents: 6_300, orderCount: 10 });
  });
});

describe('AnalyticsService.topProducts', () => {
  it('ranks products by their share of the revenue and keeps the menu-price sum beside it', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([
      { name: 'Американо', units: 5, sales: 7_000n, revenue: 5_394n },
      { name: 'Круассан', units: 1, sales: 2_000n, revenue: 1_705n },
    ]);
    const svc = new AnalyticsService({ $queryRaw } as unknown as PrismaService);
    const top = await svc.topProducts({ brandIds: ['b1'], storeIds: null }, WEEK, 6);

    expect(top).toEqual([
      { name: 'Американо', unitsSold: 5, revenueCents: 5_394, salesCents: 7_000 },
      { name: 'Круассан', unitsSold: 1, revenueCents: 1_705, salesCents: 2_000 },
    ]);
    const sql = sqlOf($queryRaw.mock.calls[0] as unknown[]);
    // Each line's share of its order's revenue, by price, rounded down per product.
    expect(sql.sql).toContain(
      'FLOOR(SUM(oi."totalCents"::numeric * GREATEST(o."subtotalCents" - o."discountCents", 0) / NULLIF(o."subtotalCents", 0)))',
    );
    expect(sql.sql).toContain(`o."status" NOT IN ('CANCELLED', 'EXPIRED')`);
    expect(sql.sql).toContain('ORDER BY 4 DESC');
    expect(sql.values).toContain(6);
  });
});

describe('AnalyticsService.cohort', () => {
  const at = (iso: string) => new Date(iso);

  function service(orders: unknown[], firstOrders: Array<{ userId: string; first: string }>) {
    const findMany = jest.fn().mockResolvedValue(orders);
    const groupBy = jest
      .fn()
      .mockResolvedValue(firstOrders.map((f) => ({ userId: f.userId, _min: { createdAt: at(f.first) } })));
    const prisma = { order: { findMany, groupBy } } as unknown as PrismaService;
    return { svc: new AnalyticsService(prisma), findMany, groupBy };
  }

  function o(userId: string, subtotalCents: number, discountCents = 0, giftCardCents = 0) {
    const createdAt = at('2026-10-01T09:00:00Z');
    return { userId, subtotalCents, discountCents, giftCardCents, createdAt, acceptedAt: createdAt, readyAt: null };
  }

  it('splits the customers into new and returning, the way the dashboard does', async () => {
    const { svc, findMany } = service(
      [
        // The tester: a first order ever, then three more in the same week.
        o('tester', 2_800),
        o('tester', 1_400, 1_400),
        o('tester', 1_400, 0, 1_400),
        o('tester', 3_400, 500),
        // A regular from September, once this week.
        o('regular', 2_000),
      ],
      [
        { userId: 'tester', first: '2026-09-29T08:00:00Z' },
        { userId: 'regular', first: '2026-09-02T08:00:00Z' },
      ],
    );
    const c = await svc.cohort({ brandIds: ['b1'], storeIds: null }, WEEK);

    expect(c).toMatchObject({ customers: 2, newCustomers: 1, returningCustomers: 1 });
    expect(c.newCustomers + c.returningCustomers).toBe(c.customers);
    // A different question: who ordered more than once inside the period.
    expect(c.repeatRatePercent).toBe(50);
    // (2 800 + 0 + 1 400 + 2 900 + 2 000) / 5: revenue per order, the gift card included.
    expect(c.avgBasketCents).toBe(1_820);
    expect(findMany.mock.calls[0]?.[0].where.status).toEqual({ notIn: ['CANCELLED', 'EXPIRED'] });
  });

  it('calls a lone first-time customer new, not returning, even after ten orders', async () => {
    const tenOrders = Array.from({ length: 10 }, () => o('tester', 630));
    const { svc } = service(tenOrders, [{ userId: 'tester', first: '2026-09-30T08:00:00Z' }]);
    const c = await svc.cohort({ brandIds: ['b1'], storeIds: null }, WEEK);
    expect(c).toMatchObject({ customers: 1, newCustomers: 1, returningCustomers: 0, repeatRatePercent: 100 });
    expect(c.avgBasketCents).toBe(630);
  });
});
