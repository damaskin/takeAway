import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DEFAULT_INACTIVE_DAYS } from '@takeaway/shared-types';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RequiresPlanFeature } from '../plans/plan-feature.guard';
import { AnalyticsScopeResolver } from './analytics-scope';
import { AnalyticsService } from './analytics.service';
import { OverviewService } from './overview.service';
import {
  AnalyticsQueryDto,
  InactiveNowQueryDto,
  RetentionQueryDto,
  TopProductsQueryDto,
} from './dto/analytics-query.dto';
import {
  BrandPerformanceDto,
  ChurnDto,
  CohortStatsDto,
  DashboardSummaryDto,
  InactiveNowDto,
  OrderStatusStatsDto,
  RevenueSeriesDto,
  StaffPerformanceDto,
  StorePerformanceDto,
  TopProductDto,
  WinBackDto,
} from './dto/analytics.dto';
import { BusinessOverviewDto } from './dto/overview.dto';

/**
 * Every endpoint narrows to the caller's own brands and stores; `brandId`
 * and `storeId` only pick among them (SUPER_ADMIN: any brand, or all when
 * omitted). Money is in one currency: a brand whose stores price in several
 * is narrowed to the stores of one (`currency`, the store's own, or the
 * brand's), and a picked store keeps the brand's days. Periods are `from`/`to` calendar days in the brand's time zone,
 * or `days` ending today; each figure is compared with the same number of
 * days right before. Endpoints marked with a plan feature answer 403
 * `PLAN_FEATURE_REQUIRED` on a plan without it.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
@Roles('BRAND_ADMIN', 'SUPER_ADMIN', 'STORE_MANAGER')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly scopes: AnalyticsScopeResolver,
    private readonly overviews: OverviewService,
  ) {}

  /**
   * The dashboard in one request: KPIs against the period before, the days,
   * stores side by side, statuses. Every plan gets revenue, orders and
   * shares per store; PRO adds the per-store comparison (`storeComparison`)
   * and the load by hour and weekday (`deepAnalytics`), which stay null
   * otherwise.
   */
  @Get('overview')
  @ApiOkResponse({ type: BusinessOverviewDto })
  async overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
  ): Promise<BusinessOverviewDto> {
    const ctx = await this.scopes.context(user, query, 30);
    return this.overviews.business(ctx, {
      storeComparison: ctx.features.has('storeComparison'),
      deep: ctx.features.has('deepAnalytics'),
    });
  }

  @Get('summary')
  @ApiOkResponse({ type: DashboardSummaryDto })
  async summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
  ): Promise<DashboardSummaryDto> {
    const { scope, range } = await this.scopes.context(user, query, 7);
    return this.analytics.dashboardSummary(scope, range);
  }

  @Get('order-statuses')
  @ApiOkResponse({ type: OrderStatusStatsDto })
  async orderStatuses(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
  ): Promise<OrderStatusStatsDto> {
    const { scope, range } = await this.scopes.context(user, query, 7);
    return this.analytics.orderStatuses(scope, range);
  }

  @Get('revenue')
  @ApiOkResponse({ type: RevenueSeriesDto })
  async revenue(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto): Promise<RevenueSeriesDto> {
    const { scope, range, currency, currencies } = await this.scopes.context(user, query, 14);
    return { ...(await this.analytics.revenueSeries(scope, range)), currency, currencies };
  }

  @Get('top-products')
  @RequiresPlanFeature('deepAnalytics')
  @ApiOkResponse({ type: TopProductDto, isArray: true })
  async topProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TopProductsQueryDto,
  ): Promise<TopProductDto[]> {
    const { scope, range } = await this.scopes.context(user, query, 30);
    return this.analytics.topProducts(scope, range, query.take ?? 10);
  }

  @Get('cohort')
  @RequiresPlanFeature('deepAnalytics')
  @ApiOkResponse({ type: CohortStatsDto })
  async cohort(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto): Promise<CohortStatsDto> {
    const { scope, range } = await this.scopes.context(user, query, 30);
    return this.analytics.cohort(scope, range);
  }

  /** The platform's brands side by side — the "whole project" view. */
  @Get('brands')
  @Roles('SUPER_ADMIN')
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOkResponse({ type: BrandPerformanceDto, isArray: true })
  async brandPerformance(@Query('days') days?: string): Promise<BrandPerformanceDto[]> {
    return this.analytics.brandPerformance(clamp(days, 1, 90, 7));
  }

  /**
   * Every store in scope. BASIC gets revenue and orders per store; PRO
   * (`storeComparison`) also gets shares, check, pickup, cancellations and
   * staff per store.
   */
  @Get('stores')
  @ApiOkResponse({ type: StorePerformanceDto, isArray: true })
  async storePerformance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
  ): Promise<StorePerformanceDto[]> {
    const { scope, range, features } = await this.scopes.context(user, query, 14);
    return this.analytics.storePerformance(scope, range, features.has('storeComparison'));
  }

  @Get('staff')
  @RequiresPlanFeature('staffAnalytics')
  @ApiOkResponse({ type: StaffPerformanceDto, isArray: true })
  async staff(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
  ): Promise<StaffPerformanceDto[]> {
    const { scope, range } = await this.scopes.context(user, query, 30);
    return this.analytics.staffPerformance(scope, range);
  }

  /**
   * The dashboard card «Неактивные клиенты»: regulars inactive right now (3+
   * orders, none for `inactiveDays` days) — the same people as «Клиенты →
   * Неактивные» with the same days and store, counted over every store
   * whatever it prices in — and what they would have brought by today, on
   * every plan; who they are with `churnList` (PRO). No period.
   */
  @Get('inactive')
  @ApiOkResponse({ type: InactiveNowDto })
  async inactive(@CurrentUser() user: AuthenticatedUser, @Query() query: InactiveNowQueryDto): Promise<InactiveNowDto> {
    const ctx = await this.scopes.peopleContext(user, query);
    return this.analytics.inactiveNow(ctx.scope, query.inactiveDays ?? DEFAULT_INACTIVE_DAYS, {
      timeZone: ctx.timeZone,
      currency: ctx.currency,
      currencies: ctx.currencies,
      withList: ctx.features.has('churnList'),
      take: query.take ?? 3,
    });
  }

  /**
   * Regulars who became inactive in the period (3+ orders, then `window`
   * days without one): how many and what they would have brought on every
   * plan; who they are with `churnList` (PRO).
   */
  @Get('churn')
  @ApiOkResponse({ type: ChurnDto })
  async churn(@CurrentUser() user: AuthenticatedUser, @Query() query: RetentionQueryDto): Promise<ChurnDto> {
    const { scope, range, features } = await this.scopes.context(user, query, 30);
    return this.analytics.churn(
      scope,
      range,
      query.window ?? DEFAULT_INACTIVE_DAYS,
      features.has('churnList'),
      query.take ?? 20,
    );
  }

  @Get('winback')
  @RequiresPlanFeature('winBack')
  @ApiOkResponse({ type: WinBackDto })
  async winBack(@CurrentUser() user: AuthenticatedUser, @Query() query: RetentionQueryDto): Promise<WinBackDto> {
    const { scope, range } = await this.scopes.context(user, query, 30);
    return this.analytics.winBack(scope, range, query.window ?? DEFAULT_INACTIVE_DAYS, query.take ?? 20);
  }
}

function clamp(raw: string | undefined, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
