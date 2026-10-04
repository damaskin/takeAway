import { ForbiddenException, HttpStatus, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  ALL_PLAN_FEATURES,
  PLAN_FEATURE_REQUIRED,
  type BrandPlan,
  type PlanFeature,
  type PlanFeatureRequiredError,
  minimumPlanFor,
  planHasFeature,
} from '@takeaway/shared-types';

import { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What the brands a request acts on are allowed to use. SUPER_ADMIN runs the
 * platform and is never held back by a brand's plan.
 */
@Injectable()
export class BrandPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandScope: BrandScopeService,
  ) {}

  /** Features of the brand a request names, or of every brand of the caller when it names none. */
  async featuresFor(user: AuthenticatedUser, requestedBrandId: string | null): Promise<ReadonlySet<PlanFeature>> {
    if (user.role === Role.SUPER_ADMIN) return new Set(ALL_PLAN_FEATURES);
    const brandIds = requestedBrandId ? [requestedBrandId] : await this.brandScope.resolveBrandIds(user);
    return this.features(user.role, brandIds);
  }

  /**
   * Features every one of `brandIds` has. `null` stands for "no brand
   * restriction" and only a SUPER_ADMIN gets it. A request that spans two
   * brands on different plans gets what both have, so a BASIC brand's data
   * never rides along with a PRO one's. No brands at all — an owner who has
   * not created one yet — leaves nothing to protect, so nothing is refused.
   */
  async features(role: Role, brandIds: readonly string[] | null): Promise<ReadonlySet<PlanFeature>> {
    if (role === Role.SUPER_ADMIN || brandIds === null || brandIds.length === 0) {
      return new Set(ALL_PLAN_FEATURES);
    }
    const plans = await this.plansOf(brandIds);
    return new Set(ALL_PLAN_FEATURES.filter((feature) => plans.every((plan) => planHasFeature(plan, feature))));
  }

  /** The plans of the brands that exist among `brandIds`. */
  async plansOf(brandIds: readonly string[]): Promise<BrandPlan[]> {
    const rows = await this.prisma.brand.findMany({
      where: { id: { in: [...brandIds] } },
      select: { plan: true },
    });
    return rows.map((row) => row.plan);
  }
}

/** The 403 for a feature the brand's plan does not include. */
export function planFeatureRequired(feature: PlanFeature): ForbiddenException {
  const body: PlanFeatureRequiredError = {
    statusCode: HttpStatus.FORBIDDEN,
    code: PLAN_FEATURE_REQUIRED,
    feature,
    requiredPlan: minimumPlanFor(feature),
    message: `The ${feature} feature is not included in this brand's plan`,
  };
  return new ForbiddenException(body);
}
