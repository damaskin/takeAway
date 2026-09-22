import { Module } from '@nestjs/common';

import { AgroprombankClient } from './agroprombank.client';
import { AgroprombankConfig } from './agroprombank.config';
import { PaymentHoldsService } from './payment-holds.service';

/**
 * The bank connection on its own, with no order or settlement dependencies.
 *
 * `PaymentsModule` and `OrdersModule` both import it: the first to talk to the
 * bank at all, the second only to release a hold on a cancelled order. Keeping
 * it separate is what stops that second use from closing a DI cycle through
 * `OrderSettlementService → OrdersService`.
 */
@Module({
  providers: [AgroprombankConfig, AgroprombankClient, PaymentHoldsService],
  exports: [AgroprombankConfig, AgroprombankClient, PaymentHoldsService],
})
export class PaymentHoldsModule {}
