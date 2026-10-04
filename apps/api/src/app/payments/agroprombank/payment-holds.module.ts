import { Module } from '@nestjs/common';

import { AgroprombankWebClient } from '../agroprombank-web/agroprombank-web.client';
import { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import { AgroprombankClient } from './agroprombank.client';
import { AgroprombankConfig } from './agroprombank.config';
import { PaymentHoldsService } from './payment-holds.service';

/**
 * The bank connections on their own, with no order or settlement dependencies
 * — both the bound-card gateway and the Web-платёж admin service.
 *
 * `PaymentsModule` and `OrdersModule` both import it: the first to talk to the
 * bank at all, the second only to release a hold on a cancelled order. Keeping
 * it separate is what stops that second use from closing a DI cycle through
 * `OrderSettlementService → OrdersService`.
 */
@Module({
  providers: [
    AgroprombankConfig,
    AgroprombankClient,
    AgroprombankWebConfig,
    AgroprombankWebClient,
    PaymentHoldsService,
  ],
  exports: [AgroprombankConfig, AgroprombankClient, AgroprombankWebConfig, AgroprombankWebClient, PaymentHoldsService],
})
export class PaymentHoldsModule {}
