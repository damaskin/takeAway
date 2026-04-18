import { Module } from '@nestjs/common';

import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PromoModule } from '../promo/promo.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [RealtimeModule, PromoModule, LoyaltyModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
