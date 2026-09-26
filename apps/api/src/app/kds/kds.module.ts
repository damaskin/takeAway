import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentHoldsModule } from '../payments/agroprombank/payment-holds.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';
import { StoreShiftService } from './store-shift.service';

@Module({
  // PaymentsModule is here so accepting an order can capture the hold taken at
  // checkout. It imports OrdersModule, not KdsModule, so the graph stays acyclic.
  imports: [RealtimeModule, AuthModule, NotificationsModule, PaymentsModule, PaymentHoldsModule],
  controllers: [KdsController],
  providers: [KdsService, StoreShiftService],
})
export class KdsModule {}
