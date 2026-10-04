import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PlanFeature } from '@takeaway/shared-types';

import { BrandScopeService } from '../auth/services/brand-scope.service';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { canonicalTimeZone, isLocalTimeZone, prevailingTimeZone } from '../common/time/time-zone';
import { BrandPlanService } from '../plans/brand-plan.service';
import { PrismaService } from '../prisma/prisma.service';
import { type DateRange, type RangeInput, resolveDateRange } from './analytics-range';

/**
 * What an analytics query may count. `null` means no restriction on that
 * axis; an empty array means nothing — a brand owner whose brand has no
 * stores yet sees zeros, not the platform's numbers.
 */
export interface AnalyticsScope {
  brandIds: readonly string[] | null;
  storeIds: readonly string[] | null;
}

/** Everything a figure needs: whose orders, which days, and what the plan lets the caller see. */
export interface AnalyticsContext {
  scope: AnalyticsScope;
  range: DateRange;
  features: ReadonlySet<PlanFeature>;
}

export interface AnalyticsRequest extends RangeInput {
  brandId?: string;
  storeId?: string;
}

/**
 * Turns the caller into an {@link AnalyticsScope}. The dashboard used to take
 * `brandId` straight from the query string and, when it was absent, counted
 * every brand on the platform: a freshly registered café saw its
 * competitors' revenue, orders and store names. The scope now comes from the
 * account — SUPER_ADMIN sees everything or the brand it asks for, a brand
 * owner only its own brands, a store manager only the stores it runs — and
 * a requested brand or store outside it is refused rather than silently
 * widened.
 */
@Injectable()
export class AnalyticsScopeResolver {
  constructor(
    private readonly brands: BrandScopeService,
    private readonly stores: UserStoreScopeService,
    private readonly prisma: PrismaService,
    private readonly plans: BrandPlanService,
  ) {}

  async resolve(
    user: AuthenticatedUser,
    requestedBrandId?: string,
    requestedStoreId?: string,
  ): Promise<AnalyticsScope> {
    const allowedBrands = await this.brands.resolveBrandIds(user);
    let brandIds: readonly string[] | null = allowedBrands;
    if (requestedBrandId) {
      if (allowedBrands !== null && !allowedBrands.includes(requestedBrandId)) {
        throw new ForbiddenException('That brand is outside your account');
      }
      brandIds = [requestedBrandId];
    }

    const storeScope = await this.stores.getScope(user.id, user.role);
    let storeIds: readonly string[] | null = storeScope === '*' ? null : storeScope;
    if (requestedStoreId) {
      if (storeIds !== null && !storeIds.includes(requestedStoreId)) {
        throw new ForbiddenException('That store is outside your account');
      }
      const store = await this.prisma.store.findUnique({ where: { id: requestedStoreId }, select: { brandId: true } });
      if (!store) throw new NotFoundException('Store not found');
      if (brandIds !== null && !brandIds.includes(store.brandId)) {
        throw new ForbiddenException('That store is outside your account');
      }
      storeIds = [requestedStoreId];
    }
    return { brandIds, storeIds };
  }

  /**
   * The scope, the period read in the scope's own time zone, and the
   * features of the brands in it.
   */
  async context(user: AuthenticatedUser, request: AnalyticsRequest, defaultDays: number): Promise<AnalyticsContext> {
    const scope = await this.resolve(user, request.brandId, request.storeId);
    const [timeZone, features] = await Promise.all([
      this.timeZoneOf(scope),
      this.plans.features(user.role, scope.brandIds),
    ]);
    return { scope, range: resolveDateRange(request, timeZone, defaultDays), features };
  }

  /**
   * The zone the scope's days are counted in: the store's own when there is
   * one store, otherwise the zone most of the brand's stores keep. UTC for the
   * whole platform, or when nobody has set a zone yet.
   */
  async timeZoneOf(scope: AnalyticsScope): Promise<string> {
    if (scope.brandIds === null && scope.storeIds === null) return 'UTC';
    if (scope.brandIds?.length === 0 || scope.storeIds?.length === 0) return 'UTC';
    const stores = await this.prisma.store.findMany({
      where: {
        ...(scope.brandIds ? { brandId: { in: [...scope.brandIds] } } : {}),
        ...(scope.storeIds ? { id: { in: [...scope.storeIds] } } : {}),
      },
      select: { timezone: true },
    });
    const only = stores.length === 1 ? stores[0]?.timezone : undefined;
    if (only && isLocalTimeZone(only)) return canonicalTimeZone(only);
    return prevailingTimeZone(stores.map((s) => s.timezone)) ?? 'UTC';
  }
}
