import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';
import { OpsAlertsService } from './ops-alerts.service';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [PrismaModule, RedisModule, ScheduleModule.forRoot()],
  controllers: [HealthController],
  providers: [ReadinessService, OpsAlertsService],
  exports: [ReadinessService],
})
export class HealthModule {}
