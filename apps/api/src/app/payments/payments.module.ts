import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PosModule } from '../pos/pos.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AgroprombankAdminController } from './agroprombank/agroprombank-admin.controller';
import { AgroprombankClient } from './agroprombank/agroprombank.client';
import { AgroprombankConfig } from './agroprombank/agroprombank.config';
import { AgroprombankController } from './agroprombank/agroprombank.controller';
import { AgroprombankCronService } from './agroprombank/agroprombank-cron.service';
import { AgroprombankService } from './agroprombank/agroprombank.service';
import { OrderSettlementService } from './order-settlement.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { stripeClientProvider, StripeConfig } from './stripe.config';

/**
 * Payment providers and the shared post-payment pipeline.
 *
 * `imports: [AuthModule]` is required because the Agroprombank admin
 * controller injects BrandScopeService — see the prod incident #107 lesson in
 * memory/session_2026_04_20.md. Skipping it crashes the container at startup
 * with a DI graph error that unit tests don't catch.
 *
 * `AgroprombankCronService` deliberately does NOT import `ScheduleModule`:
 * PosModule already registers it with `forRoot()`, which is global, and its
 * explorer discovers `@Cron` handlers across the whole app. A second
 * `forRoot()` would stand up a second explorer and fire every cron twice.
 */
@Module({
  imports: [AuthModule, RealtimeModule, OrdersModule, NotificationsModule, PosModule],
  controllers: [PaymentsController, AgroprombankController, AgroprombankAdminController],
  providers: [
    OrderSettlementService,
    PaymentsService,
    StripeConfig,
    stripeClientProvider,
    AgroprombankConfig,
    AgroprombankClient,
    AgroprombankService,
    AgroprombankCronService,
  ],
  exports: [PaymentsService, AgroprombankService, OrderSettlementService],
})
export class PaymentsModule {}
