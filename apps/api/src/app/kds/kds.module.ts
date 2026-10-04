import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentHoldsModule } from '../payments/agroprombank/payment-holds.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';
import { StoreShiftService } from './store-shift.service';

@Module({
  // PaymentsModule is here so accepting an order can capture the hold taken at
  // checkout, OrdersModule so rejecting one cancels it the way the customer's
  // cancel does. Neither imports KdsModule, so the graph stays acyclic.
  imports: [RealtimeModule, AuthModule, NotificationsModule, PaymentsModule, PaymentHoldsModule, OrdersModule],
  controllers: [KdsController],
  providers: [KdsService, StoreShiftService],
})
export class KdsModule {}
