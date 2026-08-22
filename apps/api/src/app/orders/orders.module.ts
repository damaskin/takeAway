import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { KitchenModule } from '../kitchen/kitchen.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PromoModule } from '../promo/promo.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { OrderExpiryService } from './order-expiry.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    RealtimeModule,
    PromoModule,
    LoyaltyModule,
    AuthModule,
    NotificationsModule,
    DeliveryModule,
    MailModule,
    GiftCardsModule,
    ReferralsModule,
    KitchenModule,
    CartModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderExpiryService],
  exports: [OrdersService, OrderExpiryService],
})
export class OrdersModule {}
