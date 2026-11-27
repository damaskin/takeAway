import { Module } from '@nestjs/common';

import { KitchenModule } from '../kitchen/kitchen.module';
import { OptionGroupsModule } from '../option-groups/option-groups.module';
import { PaymentHoldsModule } from '../payments/agroprombank/payment-holds.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { SuggestionsService } from './suggestions.service';

@Module({
  imports: [KitchenModule, OptionGroupsModule, PaymentHoldsModule],
  controllers: [CatalogController],
  providers: [CatalogService, SuggestionsService],
  exports: [CatalogService],
})
export class CatalogModule {}
