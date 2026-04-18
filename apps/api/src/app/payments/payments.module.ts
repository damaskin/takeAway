import { Module } from '@nestjs/common';

import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { stripeClientProvider, StripeConfig } from './stripe.config';

@Module({
  imports: [RealtimeModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeConfig, stripeClientProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
