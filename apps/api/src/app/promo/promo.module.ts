import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { TakeawayPromosModule } from '../takeaway-promos/takeaway-promos.module';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

@Module({
  imports: [AuthModule, TakeawayPromosModule],
  controllers: [PromoController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromoModule {}
