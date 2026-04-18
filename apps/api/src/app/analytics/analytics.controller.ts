import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import {
  CohortStatsDto,
  DashboardSummaryDto,
  RevenueSeriesDto,
  StorePerformanceDto,
  TopProductDto,
} from './dto/analytics.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
@Roles('BRAND_ADMIN', 'SUPER_ADMIN', 'STORE_MANAGER')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @ApiOkResponse({ type: DashboardSummaryDto })
  summary(@Query('brandId') brandId?: string): Promise<DashboardSummaryDto> {
    return this.analytics.dashboardSummary(brandId);
  }

  @Get('revenue')
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiOkResponse({ type: RevenueSeriesDto })
  revenue(@Query('days') days?: string, @Query('brandId') brandId?: string): Promise<RevenueSeriesDto> {
    return this.analytics.revenueSeries(days ? Math.min(90, Math.max(1, Number(days))) : 14, brandId);
  }

  @Get('top-products')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiOkResponse({ type: TopProductDto, isArray: true })
  topProducts(@Query('brandId') brandId?: string, @Query('take') take?: string): Promise<TopProductDto[]> {
    return this.analytics.topProducts(brandId, take ? Math.min(50, Math.max(1, Number(take))) : 10);
  }

  @Get('cohort')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOkResponse({ type: CohortStatsDto })
  cohort(@Query('brandId') brandId?: string, @Query('days') days?: string): Promise<CohortStatsDto> {
    return this.analytics.cohort(brandId, days ? Math.min(90, Math.max(7, Number(days))) : 30);
  }

  @Get('stores')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOkResponse({ type: StorePerformanceDto, isArray: true })
  storePerformance(@Query('brandId') brandId?: string, @Query('days') days?: string): Promise<StorePerformanceDto[]> {
    return this.analytics.storePerformance(brandId, days ? Math.min(90, Math.max(1, Number(days))) : 14);
  }
}
