import { Module } from '@nestjs/common';

import { AgroprombankQrClient } from '../agroprombank-qr/agroprombank-qr.client';
import { AgroprombankQrConfig } from '../agroprombank-qr/agroprombank-qr.config';
import { AgroprombankWebClient } from '../agroprombank-web/agroprombank-web.client';
import { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import { AgroprombankClient } from './agroprombank.client';
import { AgroprombankConfig } from './agroprombank.config';
import { PaymentHoldsService } from './payment-holds.service';

/**
 * The bank connections on their own, with no order or settlement dependencies
 * — the bound-card gateway, the Web-платёж admin service and the QR web
 * service.
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
    AgroprombankQrConfig,
    AgroprombankQrClient,
    PaymentHoldsService,
  ],
  exports: [
    AgroprombankConfig,
    AgroprombankClient,
    AgroprombankWebConfig,
    AgroprombankWebClient,
    AgroprombankQrConfig,
    AgroprombankQrClient,
    PaymentHoldsService,
  ],
})
export class PaymentHoldsModule {}
