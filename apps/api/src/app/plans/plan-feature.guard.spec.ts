import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PLAN_FEATURE_REQUIRED, type BrandPlan, type PlanFeature } from '@takeaway/shared-types';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { PrismaService } from '../prisma/prisma.service';
import { BrandPlanService } from './brand-plan.service';
import { PlanFeatureGuard } from './plan-feature.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function setup(feature: PlanFeature | undefined, plans: Record<string, BrandPlan>, ownBrands: string[] | null) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(feature) } as unknown as Reflector;
  const findMany = jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.filter((id) => plans[id]).map((id) => ({ plan: plans[id] }))),
  );
  const prisma = { brand: { findMany } } as unknown as PrismaService;
  const resolveBrandIds = jest.fn().mockResolvedValue(ownBrands);
  const scope = { resolveBrandIds } as unknown as BrandScopeService;
  return { guard: new PlanFeatureGuard(reflector, new BrandPlanService(prisma, scope)), findMany, resolveBrandIds };
}

const owner = { id: 'u1', role: Role.BRAND_ADMIN };

describe('PlanFeatureGuard', () => {
  it('lets routes without a plan feature through', async () => {
    const { guard, findMany } = setup(undefined, {}, ['b1']);
    await expect(guard.canActivate(contextFor({ user: owner }))).resolves.toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lets a PRO brand use promo codes', async () => {
    const { guard } = setup('promo', { b1: 'PRO' }, ['b1']);
    await expect(guard.canActivate(contextFor({ user: owner, query: { brandId: 'b1' } }))).resolves.toBe(true);
  });

  it('refuses a BASIC brand with a coded 403', async () => {
    const { guard } = setup('promo', { b1: 'BASIC' }, ['b1']);
    const attempt = guard.canActivate(contextFor({ user: owner, body: { brandId: 'b1' } }));
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await attempt.catch((err: ForbiddenException) => {
      expect(err.getResponse()).toEqual(
        expect.objectContaining({ code: PLAN_FEATURE_REQUIRED, feature: 'promo', requiredPlan: 'PRO' }),
      );
    });
  });

  it('checks every brand of the caller when the request names none', async () => {
    const { guard, resolveBrandIds } = setup('campaigns', { b1: 'PRO', b2: 'BASIC' }, ['b1', 'b2']);
    await expect(guard.canActivate(contextFor({ user: owner, params: { id: 'c1' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(resolveBrandIds).toHaveBeenCalledWith(owner);
  });

  it('checks the brand the request names, not the rest of the account', async () => {
    const { guard } = setup('campaigns', { b1: 'PRO', b2: 'BASIC' }, ['b1', 'b2']);
    await expect(guard.canActivate(contextFor({ user: owner, query: { brandId: 'b1' } }))).resolves.toBe(true);
  });

  it('never holds a platform admin back', async () => {
    const { guard, findMany } = setup('customers', { b1: 'BASIC' }, null);
    const admin = { id: 'sa', role: Role.SUPER_ADMIN };
    await expect(guard.canActivate(contextFor({ user: admin, query: { brandId: 'b1' } }))).resolves.toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('has nothing to refuse for an owner without a brand yet', async () => {
    const { guard } = setup('promo', {}, []);
    await expect(guard.canActivate(contextFor({ user: owner }))).resolves.toBe(true);
  });
});
