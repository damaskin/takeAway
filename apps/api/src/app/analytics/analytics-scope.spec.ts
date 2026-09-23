import { ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AnalyticsScopeResolver } from './analytics-scope';
import { AnalyticsService } from './analytics.service';
import type { PrismaService } from '../prisma/prisma.service';

function user(role: Role, id = 'u1'): AuthenticatedUser {
  return { id, role, email: null, phone: null, name: null };
}

function resolver(brands: string[] | null, stores: '*' | string[]): AnalyticsScopeResolver {
  return new AnalyticsScopeResolver(
    { resolveBrandIds: jest.fn().mockResolvedValue(brands) } as unknown as BrandScopeService,
    { getScope: jest.fn().mockResolvedValue(stores) } as unknown as UserStoreScopeService,
  );
}

describe('AnalyticsScopeResolver', () => {
  it('lets the platform admin see everything, or the one brand it asks for', async () => {
    const r = resolver(null, '*');
    await expect(r.resolve(user(Role.SUPER_ADMIN))).resolves.toEqual({ brandIds: null, storeIds: null });
    await expect(r.resolve(user(Role.SUPER_ADMIN), 'b9')).resolves.toEqual({ brandIds: ['b9'], storeIds: null });
  });

  it('keeps a brand owner on its own brands even when the query names nothing', async () => {
    const r = resolver(['own'], '*');
    await expect(r.resolve(user(Role.BRAND_ADMIN))).resolves.toEqual({ brandIds: ['own'], storeIds: null });
    await expect(r.resolve(user(Role.BRAND_ADMIN), 'own')).resolves.toEqual({ brandIds: ['own'], storeIds: null });
  });

  it("refuses a competitor's brand instead of answering for it", async () => {
    await expect(resolver(['own'], '*').resolve(user(Role.BRAND_ADMIN), 'competitor')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('gives a brand with no stores yet an empty scope, not the whole platform', async () => {
    await expect(resolver([], '*').resolve(user(Role.BRAND_ADMIN))).resolves.toEqual({ brandIds: [], storeIds: null });
  });

  it('narrows a store manager to the stores it runs', async () => {
    const r = resolver(['own'], ['s1', 's2']);
    await expect(r.resolve(user(Role.STORE_MANAGER))).resolves.toEqual({ brandIds: ['own'], storeIds: ['s1', 's2'] });
  });
});

describe('AnalyticsService scope', () => {
  function service(rows: unknown[] = []): { svc: AnalyticsService; queries: Prisma.Sql[] } {
    const queries: Prisma.Sql[] = [];
    const prisma = {
      // Called as a tagged template: rebuild the statement the way Prisma does.
      $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        queries.push(Prisma.sql(strings, ...values));
        return Promise.resolve(rows);
      }),
    } as unknown as PrismaService;
    return { svc: new AnalyticsService(prisma), queries };
  }

  it('filters the daily roll-up by the brands and stores in scope', async () => {
    const { svc, queries } = service();
    await svc.dashboardSummary({ brandIds: ['own'], storeIds: ['s1'] });

    const [query] = queries;
    expect(query?.sql).toContain('"brandId" = ANY(');
    expect(query?.sql).toContain('"storeId" = ANY(');
    expect(query?.values).toEqual(expect.arrayContaining([['own'], ['s1']]));
  });

  it('adds no brand filter for the platform admin', async () => {
    const { svc, queries } = service();
    await svc.dashboardSummary({ brandIds: null, storeIds: null });
    expect(queries[0]?.sql).not.toContain('"brandId" = ANY');
  });

  it('reports no NPS until ratings exist', async () => {
    const { svc } = service();
    await expect(svc.dashboardSummary({ brandIds: ['own'], storeIds: null })).resolves.toMatchObject({ nps: null });
  });
});

describe('AnalyticsService dashboard summary', () => {
  const DAY_MS = 24 * 60 * 60_000;

  /** UTC midnight `n` days before today. */
  function daysAgo(n: number): Date {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return new Date(today.getTime() - n * DAY_MS);
  }

  function row(day: Date, revenueCents: number, orders: number, pickupSecSum = 0, pickupSecCount = 0) {
    return {
      brandId: 'own',
      storeId: 's1',
      day,
      orderCount: BigInt(orders),
      revenueCents: BigInt(revenueCents),
      slaHits: BigInt(0),
      slaTotal: BigInt(0),
      pickupSecSum: BigInt(pickupSecSum),
      pickupSecCount: BigInt(pickupSecCount),
    };
  }

  function service(rows: unknown[]): { svc: AnalyticsService; queries: Prisma.Sql[] } {
    const queries: Prisma.Sql[] = [];
    const prisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        queries.push(Prisma.sql(strings, ...values));
        return Promise.resolve(rows);
      }),
    } as unknown as PrismaService;
    return { svc: new AnalyticsService(prisma), queries };
  }

  const scope = { brandIds: ['own'], storeIds: null };

  it('sums the chosen period and compares it with the one before', async () => {
    const { svc } = service([
      row(daysAgo(0), 10_000, 4, 1200, 4),
      // Six days ago is still inside "the last 7 days"…
      row(daysAgo(6), 5_000, 2, 900, 2),
      // …seven days ago is the period before.
      row(daysAgo(7), 12_000, 5, 1500, 3),
    ]);

    await expect(svc.dashboardSummary(scope, 7)).resolves.toEqual({
      days: 7,
      revenueCents: 15_000,
      orders: 6,
      avgPickupSeconds: 350,
      nps: null,
      revenueDeltaPercent: 25,
      ordersDeltaPercent: 20,
      pickupDeltaSeconds: -150,
    });
  });

  it('follows a longer period', async () => {
    const { svc } = service([row(daysAgo(0), 10_000, 4), row(daysAgo(20), 5_000, 2), row(daysAgo(40), 8_000, 1)]);

    await expect(svc.dashboardSummary(scope, 30)).resolves.toMatchObject({
      days: 30,
      revenueCents: 15_000,
      orders: 6,
      revenueDeltaPercent: 87.5,
    });
  });

  it('has nothing to compare with when the period before was empty', async () => {
    const { svc } = service([row(daysAgo(0), 10_000, 4, 1200, 4)]);

    await expect(svc.dashboardSummary(scope, 7)).resolves.toMatchObject({
      revenueDeltaPercent: null,
      ordersDeltaPercent: null,
      pickupDeltaSeconds: null,
    });
  });

  it('reads the roll-up from the start of the period before', async () => {
    const { svc, queries } = service([]);
    await svc.dashboardSummary(scope, 14);

    expect(queries[0]?.values).toContain(daysAgo(27).toISOString().slice(0, 10));
  });

  it('counts the stores over the same days as the summary', async () => {
    const { svc, queries } = service([]);
    await svc.storePerformance(scope, 7);

    expect(queries[0]?.values).toContain(daysAgo(6).toISOString().slice(0, 10));
  });
});
