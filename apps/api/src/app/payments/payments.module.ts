import { Module } from '@nestjs/common';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { stripeClientProvider, StripeConfig } from './stripe.config';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeConfig, stripeClientProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
