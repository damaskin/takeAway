import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PosModule } from '../pos/pos.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { stripeClientProvider, StripeConfig } from './stripe.config';

@Module({
  imports: [AuthModule, RealtimeModule, OrdersModule, NotificationsModule, PosModule],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService, StripeConfig, stripeClientProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
