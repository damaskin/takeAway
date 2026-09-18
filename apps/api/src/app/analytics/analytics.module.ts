import { Module } from '@nestjs/common';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsRefreshService } from './analytics-refresh.service';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsRefreshService],
  exports: [AnalyticsService, AnalyticsRefreshService],
})
export class AnalyticsModule {}
