import { ForbiddenException, Injectable } from '@nestjs/common';

import { BrandScopeService } from '../auth/services/brand-scope.service';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * What an analytics query may count. `null` means no restriction on that
 * axis; an empty array means nothing — a brand owner whose brand has no
 * stores yet sees zeros, not the platform's numbers.
 */
export interface AnalyticsScope {
  brandIds: readonly string[] | null;
  storeIds: readonly string[] | null;
}

/**
 * Turns the caller into an {@link AnalyticsScope}. The dashboard used to take
 * `brandId` straight from the query string and, when it was absent, counted
 * every brand on the platform: a freshly registered café saw its
 * competitors' revenue, orders and store names. The scope now comes from the
 * account — SUPER_ADMIN sees everything or the brand it asks for, a brand
 * owner only its own brands, a store manager only the stores it runs — and
 * a requested brand outside it is refused rather than silently widened.
 */
@Injectable()
export class AnalyticsScopeResolver {
  constructor(
    private readonly brands: BrandScopeService,
    private readonly stores: UserStoreScopeService,
  ) {}

  async resolve(user: AuthenticatedUser, requestedBrandId?: string): Promise<AnalyticsScope> {
    const allowedBrands = await this.brands.resolveBrandIds(user);
    let brandIds: readonly string[] | null = allowedBrands;
    if (requestedBrandId) {
      if (allowedBrands !== null && !allowedBrands.includes(requestedBrandId)) {
        throw new ForbiddenException('That brand is outside your account');
      }
      brandIds = [requestedBrandId];
    }

    const storeScope = await this.stores.getScope(user.id, user.role);
    return { brandIds, storeIds: storeScope === '*' ? null : storeScope };
  }
}
