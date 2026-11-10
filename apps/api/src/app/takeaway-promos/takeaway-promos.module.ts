import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { TakeawayPromoAdminService } from './takeaway-promo-admin.service';
import { TakeawayPromoService } from './takeaway-promo.service';
import { CustomerBonusesController, TakeawayPromosController } from './takeaway-promos.controller';
import { WelcomeBonusService } from './welcome-bonus.service';

/**
 * «Акции takeAway» (docs/takeaway-promos.md): the platform admin's promos,
 * their checkout side (PromoModule and OrdersModule use
 * TakeawayPromoService) and the welcome bonus (AuthModule gives it on
 * sign-up). Imports nothing that imports it back: the auth guards are
 * global, Prisma is global.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [TakeawayPromosController, CustomerBonusesController],
  providers: [TakeawayPromoService, TakeawayPromoAdminService, WelcomeBonusService],
  exports: [TakeawayPromoService, WelcomeBonusService],
})
export class TakeawayPromosModule {}
