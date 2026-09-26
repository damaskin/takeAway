import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AnalyticsScopeResolver } from './analytics-scope';
import { AnalyticsService } from './analytics.service';
import {
  BrandPerformanceDto,
  CohortStatsDto,
  DashboardSummaryDto,
  OrderStatusStatsDto,
  RevenueSeriesDto,
  StorePerformanceDto,
  TopProductDto,
} from './dto/analytics.dto';

/**
 * Every endpoint narrows to the caller's own brands and stores; `brandId`
 * only picks one of them (SUPER_ADMIN: any brand, or all when omitted).
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
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOkResponse({ type: DashboardSummaryDto })
  async summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
    @Query('days') days?: string,
  ): Promise<DashboardSummaryDto> {
    return this.analytics.dashboardSummary(await this.scopes.resolve(user, brandId), clamp(days, 1, 90, 7));
  }

  @Get('order-statuses')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOkResponse({ type: OrderStatusStatsDto })
  async orderStatuses(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
    @Query('days') days?: string,
  ): Promise<OrderStatusStatsDto> {
    return this.analytics.orderStatuses(await this.scopes.resolve(user, brandId), clamp(days, 1, 90, 7));
  }

  @Get('revenue')
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiOkResponse({ type: RevenueSeriesDto })
  async revenue(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
    @Query('brandId') brandId?: string,
  ): Promise<RevenueSeriesDto> {
    const scope = await this.scopes.resolve(user, brandId);
    return this.analytics.revenueSeries(scope, clamp(days, 1, 90, 14));
  }

  @Get('top-products')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiOkResponse({ type: TopProductDto, isArray: true })
  async topProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
    @Query('take') take?: string,
  ): Promise<TopProductDto[]> {
    const scope = await this.scopes.resolve(user, brandId);
    return this.analytics.topProducts(scope, clamp(take, 1, 50, 10));
  }

  @Get('cohort')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOkResponse({ type: CohortStatsDto })
  async cohort(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
    @Query('days') days?: string,
  ): Promise<CohortStatsDto> {
    const scope = await this.scopes.resolve(user, brandId);
    return this.analytics.cohort(scope, clamp(days, 7, 90, 30));
  }

  /** The platform's brands side by side — the "whole project" view. */
  @Get('brands')
  @Roles('SUPER_ADMIN')
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOkResponse({ type: BrandPerformanceDto, isArray: true })
  async brandPerformance(@Query('days') days?: string): Promise<BrandPerformanceDto[]> {
    return this.analytics.brandPerformance(clamp(days, 1, 90, 7));
  }

  @Get('stores')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOkResponse({ type: StorePerformanceDto, isArray: true })
  async storePerformance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
    @Query('days') days?: string,
  ): Promise<StorePerformanceDto[]> {
    const scope = await this.scopes.resolve(user, brandId);
    return this.analytics.storePerformance(scope, clamp(days, 1, 90, 14));
  }
}

function clamp(raw: string | undefined, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
