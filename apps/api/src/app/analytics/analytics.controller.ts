import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RequiresPlanFeature } from '../plans/plan-feature.guard';
import { AnalyticsScopeResolver } from './analytics-scope';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto, RetentionQueryDto, TopProductsQueryDto } from './dto/analytics-query.dto';
import {
  BrandPerformanceDto,
  ChurnDto,
  CohortStatsDto,
  DashboardSummaryDto,
  OrderStatusStatsDto,
  RevenueSeriesDto,
  StaffPerformanceDto,
  StorePerformanceDto,
  TopProductDto,
  WinBackDto,
} from './dto/analytics.dto';

/**
 * Every endpoint narrows to the caller's own brands and stores; `brandId`
 * and `storeId` only pick among them (SUPER_ADMIN: any brand, or all when
 * omitted). Periods are `from`/`to` calendar days in the brand's time zone,
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
  ) {}

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
    const { scope, range } = await this.scopes.context(user, query, 14);
    return this.analytics.revenueSeries(scope, range);
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
   * Customers lost in the period: how many and what their average checks
   * add up to on every plan; who they are with `churnList` (PRO).
   */
  @Get('churn')
  @ApiOkResponse({ type: ChurnDto })
  async churn(@CurrentUser() user: AuthenticatedUser, @Query() query: RetentionQueryDto): Promise<ChurnDto> {
    const { scope, range, features } = await this.scopes.context(user, query, 30);
    return this.analytics.churn(scope, range, query.window ?? 14, features.has('churnList'), query.take ?? 20);
  }

  @Get('winback')
  @RequiresPlanFeature('winBack')
  @ApiOkResponse({ type: WinBackDto })
  async winBack(@CurrentUser() user: AuthenticatedUser, @Query() query: RetentionQueryDto): Promise<WinBackDto> {
    const { scope, range } = await this.scopes.context(user, query, 30);
    return this.analytics.winBack(scope, range, query.window ?? 14, query.take ?? 20);
  }
}

function clamp(raw: string | undefined, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
