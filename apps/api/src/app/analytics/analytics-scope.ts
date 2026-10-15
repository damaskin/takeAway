import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PlanFeature } from '@takeaway/shared-types';
import { defaultCurrency } from '@takeaway/utils';

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

/** Whose orders, in which currency, and the wider view a picked store is part of. */
export interface MoneyScope {
  /** What the figures count: the account's slice, the requested store, one currency. */
  scope: AnalyticsScope;
  /**
   * The same without the requested store — what that store is compared
   * with. Equal to `scope` when no store was asked for.
   */
  parent: AnalyticsScope;
  /** The store the request narrowed to, if any. */
  storeId: string | null;
  /** The currency every amount is in; null when nothing prices in one yet. */
  currency: string | null;
  /** Every currency the caller's stores price in, alphabetically. */
  currencies: string[];
}

/** Everything a figure needs: whose orders, which days, and what the plan lets the caller see. */
export interface AnalyticsContext extends MoneyScope {
  range: DateRange;
  features: ReadonlySet<PlanFeature>;
}

export interface AnalyticsRequest extends RangeInput {
  brandId?: string;
  storeId?: string;
  currency?: string;
}

interface ScopeStore {
  id: string;
  timezone: string;
  currency: string;
  brand: { currency: string } | null;
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
    return (await this.resolveWithParent(user, requestedBrandId, requestedStoreId)).scope;
  }

  /**
   * The scope in one currency. Money is never added up across currencies:
   * a brand whose stores price in two is narrowed to the stores of one — a
   * requested store's own, else the one asked for, else `defaultCurrency`
   * (the brand's, or the one most stores use). A brand in one currency is
   * left as it is.
   */
  async money(user: AuthenticatedUser, request: AnalyticsRequest): Promise<MoneyScope> {
    return (await this.moneyWithStores(user, request)).money;
  }

  /**
   * The scope for counting people rather than money — «Клиенты» and its
   * segments: every store of the caller's slice whatever it prices in (or
   * the requested store), never narrowed to one currency. A regular of a
   * store in the other currency is a customer all the same, and the
   * campaign and promo segments count them too. `currency` is picked as for
   * {@link money}, for the money shown next to the people; `currencies` is
   * the choice.
   */
  async people(user: AuthenticatedUser, request: AnalyticsRequest): Promise<MoneyScope> {
    const { scope, parent, storeId, currency, currencies } = await this.withCurrency(user, request);
    return { scope, parent, storeId, currency, currencies };
  }

  /**
   * The scope, the period read in the scope's own time zone, and the
   * features of the brands in it.
   */
  async context(user: AuthenticatedUser, request: AnalyticsRequest, defaultDays: number): Promise<AnalyticsContext> {
    const { money, stores, platform } = await this.moneyWithStores(user, request);
    const timeZone = platform ? 'UTC' : zoneOf(money.parent, stores);
    const features = await this.plans.features(user.role, money.scope.brandIds);
    return { ...money, range: resolveDateRange(request, timeZone, defaultDays), features };
  }

  private async moneyWithStores(
    user: AuthenticatedUser,
    request: AnalyticsRequest,
  ): Promise<{ money: MoneyScope; stores: ScopeStore[]; platform: boolean }> {
    const { scope, parent, storeId, platform, stores, own, currencies, currency } = await this.withCurrency(
      user,
      request,
    );

    if (currencies.length <= 1 || !currency) {
      return { money: { scope, parent, storeId, currency, currencies }, stores, platform };
    }
    const narrowed: AnalyticsScope = {
      brandIds: parent.brandIds,
      storeIds: own.filter((s) => s.currency === currency).map((s) => s.id),
    };
    return {
      money: { scope: storeId ? scope : narrowed, parent: narrowed, storeId, currency, currencies },
      stores,
      platform,
    };
  }

  /** The caller's scope with the currency its money is counted in, before any narrowing to it. */
  private async withCurrency(user: AuthenticatedUser, request: AnalyticsRequest) {
    const { scope, parent } = await this.resolveWithParent(user, request.brandId, request.storeId);
    const storeId = request.storeId ?? null;
    const platform = parent.brandIds === null && parent.storeIds === null;
    const stores = await this.storesAround(parent);
    const own = stores.filter((s) => inScope(parent, s.id));
    const currencies = [...new Set(own.map((s) => s.currency).filter(Boolean))].sort();
    const brandCurrency = parent.brandIds?.length === 1 ? (stores[0]?.brand?.currency ?? null) : null;
    const asked = request.currency && currencies.includes(request.currency) ? request.currency : null;
    const currency =
      (storeId ? own.find((s) => s.id === storeId)?.currency : null) ??
      asked ??
      defaultCurrency(
        own.map((s) => s.currency),
        brandCurrency,
      );
    return { scope, parent, storeId, platform, stores, own, currencies, currency };
  }

  /** The scope with the requested store, and without it. */
  private async resolveWithParent(
    user: AuthenticatedUser,
    requestedBrandId?: string,
    requestedStoreId?: string,
  ): Promise<{ scope: AnalyticsScope; parent: AnalyticsScope }> {
    const allowedBrands = await this.brands.resolveBrandIds(user);
    let brandIds: readonly string[] | null = allowedBrands;
    if (requestedBrandId) {
      if (allowedBrands !== null && !allowedBrands.includes(requestedBrandId)) {
        throw new ForbiddenException('That brand is outside your account');
      }
      brandIds = [requestedBrandId];
    }

    const storeScope = await this.stores.getScope(user.id, user.role);
    const storeIds: readonly string[] | null = storeScope === '*' ? null : storeScope;
    const parent: AnalyticsScope = { brandIds, storeIds };
    if (!requestedStoreId) return { scope: parent, parent };

    if (storeIds !== null && !storeIds.includes(requestedStoreId)) {
      throw new ForbiddenException('That store is outside your account');
    }
    const store = await this.prisma.store.findUnique({ where: { id: requestedStoreId }, select: { brandId: true } });
    if (!store) throw new NotFoundException('Store not found');
    if (brandIds !== null && !brandIds.includes(store.brandId)) {
      throw new ForbiddenException('That store is outside your account');
    }
    return { scope: { brandIds, storeIds: [requestedStoreId] }, parent };
  }

  /**
   * Every store of the scope's brands — those outside a store manager's
   * stores too, for their time zone only — or every store of the platform.
   */
  private async storesAround(scope: AnalyticsScope): Promise<ScopeStore[]> {
    if (scope.brandIds?.length === 0 || scope.storeIds?.length === 0) return [];
    return this.prisma.store.findMany({
      where: scope.brandIds ? { brandId: { in: [...scope.brandIds] } } : {},
      select: { id: true, timezone: true, currency: true, brand: { select: { currency: true } } },
    });
  }
}

function inScope(scope: AnalyticsScope, storeId: string): boolean {
  return !scope.storeIds || scope.storeIds.includes(storeId);
}

/**
 * The zone the scope's days are counted in: the store's own when the scope
 * is one store, otherwise the zone most of its stores keep, otherwise the
 * one the rest of the brand keeps — a store still on the UTC placeholder
 * would count its days hours off the brand's. A store picked out of a wider
 * view keeps that view's zone (it is `parent` that comes in here), so the
 * figures the page narrows to are the very ones its row showed.
 */
function zoneOf(scope: AnalyticsScope, stores: readonly ScopeStore[]): string {
  if (scope.brandIds?.length === 0 || scope.storeIds?.length === 0) return 'UTC';
  const own = stores.filter((s) => inScope(scope, s.id));
  const only = own.length === 1 ? own[0]?.timezone : undefined;
  if (only && isLocalTimeZone(only)) return canonicalTimeZone(only);
  return prevailingTimeZone(own.map((s) => s.timezone)) ?? prevailingTimeZone(stores.map((s) => s.timezone)) ?? 'UTC';
}
