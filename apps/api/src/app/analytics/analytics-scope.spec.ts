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
