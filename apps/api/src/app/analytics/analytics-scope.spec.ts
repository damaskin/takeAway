import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BrandPlanService } from '../plans/brand-plan.service';
import type { PrismaService } from '../prisma/prisma.service';
import { resolveDateRange } from './analytics-range';
import { AnalyticsScopeResolver } from './analytics-scope';
import { AnalyticsService } from './analytics.service';

function user(role: Role, id = 'u1'): AuthenticatedUser {
  return { id, role, email: null, phone: null, name: null };
}

interface Fixture {
  brands: string[] | null;
  stores: '*' | string[];
  storeRows?: Array<{ id: string; brandId: string; timezone: string }>;
  plans?: Record<string, 'BASIC' | 'PRO'>;
}

function resolver({ brands, stores, storeRows = [], plans = {} }: Fixture): AnalyticsScopeResolver {
  const prisma = {
    store: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(storeRows.find((s) => s.id === where.id) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: { brandId?: { in: string[] }; id?: { in: string[] } } }) =>
        Promise.resolve(
          storeRows.filter(
            (s) =>
              (!where.brandId || where.brandId.in.includes(s.brandId)) && (!where.id || where.id.in.includes(s.id)),
          ),
        ),
      ),
    },
    brand: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.filter((id) => plans[id]).map((id) => ({ plan: plans[id] }))),
      ),
    },
  } as unknown as PrismaService;
  return new AnalyticsScopeResolver(
    { resolveBrandIds: jest.fn().mockResolvedValue(brands) } as unknown as BrandScopeService,
    { getScope: jest.fn().mockResolvedValue(stores) } as unknown as UserStoreScopeService,
    prisma,
    new BrandPlanService(prisma, { resolveBrandIds: jest.fn() } as unknown as BrandScopeService),
  );
}

describe('AnalyticsScopeResolver', () => {
  it('lets the platform admin see everything, or the one brand it asks for', async () => {
    const r = resolver({ brands: null, stores: '*' });
    await expect(r.resolve(user(Role.SUPER_ADMIN))).resolves.toEqual({ brandIds: null, storeIds: null });
    await expect(r.resolve(user(Role.SUPER_ADMIN), 'b9')).resolves.toEqual({ brandIds: ['b9'], storeIds: null });
  });

  it('keeps a brand owner on its own brands even when the query names nothing', async () => {
    const r = resolver({ brands: ['own'], stores: '*' });
    await expect(r.resolve(user(Role.BRAND_ADMIN))).resolves.toEqual({ brandIds: ['own'], storeIds: null });
    await expect(r.resolve(user(Role.BRAND_ADMIN), 'own')).resolves.toEqual({ brandIds: ['own'], storeIds: null });
  });

  it("refuses a competitor's brand instead of answering for it", async () => {
    await expect(
      resolver({ brands: ['own'], stores: '*' }).resolve(user(Role.BRAND_ADMIN), 'competitor'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives a brand with no stores yet an empty scope, not the whole platform', async () => {
    await expect(resolver({ brands: [], stores: '*' }).resolve(user(Role.BRAND_ADMIN))).resolves.toEqual({
      brandIds: [],
      storeIds: null,
    });
  });

  it('narrows a store manager to the stores it runs', async () => {
    const r = resolver({ brands: ['own'], stores: ['s1', 's2'] });
    await expect(r.resolve(user(Role.STORE_MANAGER))).resolves.toEqual({ brandIds: ['own'], storeIds: ['s1', 's2'] });
  });

  it('narrows to one store of the brand on request', async () => {
    const storeRows = [{ id: 's1', brandId: 'own', timezone: 'UTC' }];
    const r = resolver({ brands: ['own'], stores: '*', storeRows });
    await expect(r.resolve(user(Role.BRAND_ADMIN), undefined, 's1')).resolves.toEqual({
      brandIds: ['own'],
      storeIds: ['s1'],
    });
  });

  it("refuses a store outside the account, a competitor's or another manager's", async () => {
    const storeRows = [
      { id: 's1', brandId: 'own', timezone: 'UTC' },
      { id: 'theirs', brandId: 'competitor', timezone: 'UTC' },
    ];
    const owner = resolver({ brands: ['own'], stores: '*', storeRows });
    await expect(owner.resolve(user(Role.BRAND_ADMIN), undefined, 'theirs')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(owner.resolve(user(Role.BRAND_ADMIN), undefined, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    const manager = resolver({ brands: ['own'], stores: ['s1'], storeRows });
    await expect(manager.resolve(user(Role.STORE_MANAGER), undefined, 's2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("reads the period in the brand's time zone and carries its plan", async () => {
    const storeRows = [
      { id: 's1', brandId: 'own', timezone: 'Europe/Chisinau' },
      { id: 's2', brandId: 'own', timezone: 'UTC' },
    ];
    const r = resolver({ brands: ['own'], stores: '*', storeRows, plans: { own: 'BASIC' } });
    const ctx = await r.context(user(Role.BRAND_ADMIN), { from: '2026-10-01', to: '2026-10-01' }, 7);
    expect(ctx.range.timeZone).toBe('Europe/Chisinau');
    expect(ctx.range.start.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(ctx.features.has('churn')).toBe(true);
    expect(ctx.features.has('storeComparison')).toBe(false);
  });

  it('counts the whole platform in UTC with every feature', async () => {
    const r = resolver({ brands: null, stores: '*' });
    const ctx = await r.context(user(Role.SUPER_ADMIN), { days: 7 }, 14);
    expect(ctx.range.timeZone).toBe('UTC');
    expect(ctx.range.days).toBe(7);
    expect(ctx.features.has('winBack')).toBe(true);
  });
});

function sqlService(rows: unknown[] = []): { svc: AnalyticsService; queries: Prisma.Sql[] } {
  const queries: Prisma.Sql[] = [];
  const prisma = {
    // Called as a tagged template: rebuild the statement the way Prisma does.
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(Prisma.sql(strings, ...values));
      return Promise.resolve(rows);
    }),
    store: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
  return { svc: new AnalyticsService(prisma), queries };
}

const WEEK = resolveDateRange({ from: '2026-09-28', to: '2026-10-04' }, 'Europe/Chisinau', 7);

describe('AnalyticsService scope', () => {
  it('filters the orders by the brands and stores in scope', async () => {
    const { svc, queries } = sqlService();
    await svc.dashboardSummary({ brandIds: ['own'], storeIds: ['s1'] }, WEEK);

    const [query] = queries;
    expect(query?.sql).toContain('"brandId" = ANY(');
    expect(query?.sql).toContain('"storeId" = ANY(');
    expect(query?.values).toEqual(expect.arrayContaining([['own'], ['s1']]));
  });

  it('adds no brand filter for the platform admin', async () => {
    const { svc, queries } = sqlService();
    await svc.dashboardSummary({ brandIds: null, storeIds: null }, WEEK);
    expect(queries[0]?.sql).not.toContain('"brandId" = ANY');
  });

  it('reports no NPS until ratings exist', async () => {
    const { svc } = sqlService();
    await expect(svc.dashboardSummary({ brandIds: ['own'], storeIds: null }, WEEK)).resolves.toMatchObject({
      nps: null,
    });
  });
});

describe('AnalyticsService dashboard summary', () => {
  const scope = { brandIds: ['own'], storeIds: null };

  function bucket(name: 'current' | 'previous', revenue: number, orders: number, pickupSecSum = 0, pickupCount = 0) {
    return { bucket: name, revenue: BigInt(revenue), orders, pickupSecSum, pickupCount };
  }

  it('sums the chosen period and compares it with the one before', async () => {
    const { svc } = sqlService([bucket('current', 15_000, 6, 2100, 6), bucket('previous', 12_000, 5, 1500, 3)]);

    await expect(svc.dashboardSummary(scope, WEEK)).resolves.toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
      timeZone: 'Europe/Chisinau',
      days: 7,
      revenueCents: 15_000,
      orders: 6,
      avgCheckCents: 2_500,
      avgPickupSeconds: 350,
      nps: null,
      revenueDeltaPercent: 25,
      ordersDeltaPercent: 20,
      avgCheckDeltaPercent: 4.2,
      pickupDeltaSeconds: -150,
    });
  });

  it('has nothing to compare with when the period before was empty', async () => {
    const { svc } = sqlService([bucket('current', 10_000, 4, 1200, 4)]);

    await expect(svc.dashboardSummary(scope, WEEK)).resolves.toMatchObject({
      revenueDeltaPercent: null,
      ordersDeltaPercent: null,
      pickupDeltaSeconds: null,
    });
  });

  it('reads from the start of the period before to the end of the range, in UTC wall time', async () => {
    const { svc, queries } = sqlService([]);
    await svc.dashboardSummary(scope, WEEK);

    expect(queries[0]?.values).toEqual(
      expect.arrayContaining([WEEK.previous.start.toISOString(), WEEK.start.toISOString(), WEEK.end.toISOString()]),
    );
    expect(queries[0]?.sql).toContain(`o."status" NOT IN ('CANCELLED', 'EXPIRED')`);
  });

  it('counts the stores over the same days as the summary', async () => {
    const { svc, queries } = sqlService([]);
    await svc.storePerformance(scope, WEEK, false);

    expect(queries[0]?.values).toEqual(expect.arrayContaining([WEEK.start.toISOString(), WEEK.end.toISOString()]));
  });
});
