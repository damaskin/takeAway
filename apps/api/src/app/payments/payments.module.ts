import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { stripeClientProvider, StripeConfig } from './stripe.config';

@Module({
  imports: [RealtimeModule, OrdersModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeConfig, stripeClientProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
