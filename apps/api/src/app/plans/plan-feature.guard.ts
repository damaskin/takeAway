import { CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlanFeature } from '@takeaway/shared-types';

import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BrandPlanService, planFeatureRequired } from './brand-plan.service';

export const PLAN_FEATURE_KEY = 'planFeature';

interface PlanRequest {
  user?: AuthenticatedUser;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body?: unknown;
}

/**
 * Refuses the request with 403 `PLAN_FEATURE_REQUIRED` unless the brand it
 * acts on has `feature` in its plan. The brand is the `brandId` of the query,
 * the route or the body; without one, every brand of the caller must have
 * it. SUPER_ADMIN passes. Runs after authentication and `@Roles`.
 */
export function RequiresPlanFeature(feature: PlanFeature): ReturnType<typeof applyDecorators> {
  return applyDecorators(SetMetadata(PLAN_FEATURE_KEY, feature), UseGuards(PlanFeatureGuard));
}

@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    // Only globally exported providers here: the guard is instantiated in
    // the module of whichever controller uses it.
    private readonly plans: BrandPlanService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(PLAN_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    const request = context.switchToHttp().getRequest<PlanRequest>();
    const user = request.user;
    // Unauthenticated requests never reach here on a protected route; a
    // public one has nothing to check the plan of.
    if (!user) return true;

    const features = await this.plans.featuresFor(user, requestedBrandId(request));
    if (!features.has(feature)) throw planFeatureRequired(feature);
    return true;
  }
}

function requestedBrandId(request: PlanRequest): string | null {
  const body =
    typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {};
  for (const value of [request.query?.['brandId'], request.params?.['brandId'], body['brandId']]) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}
