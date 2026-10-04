import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
