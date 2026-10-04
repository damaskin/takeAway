import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsRefreshService } from './analytics-refresh.service';
import { AnalyticsScopeResolver } from './analytics-scope';
import { AnalyticsService } from './analytics.service';
import { OverviewService } from './overview.service';
import { PlatformOverviewController } from './platform-overview.controller';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController, PlatformOverviewController],
  providers: [AnalyticsService, AnalyticsRefreshService, AnalyticsScopeResolver, OverviewService],
  exports: [AnalyticsService, AnalyticsRefreshService, AnalyticsScopeResolver],
})
export class AnalyticsModule {}
