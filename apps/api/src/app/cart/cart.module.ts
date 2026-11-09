import { Module } from '@nestjs/common';

import { KitchenModule } from '../kitchen/kitchen.module';
import { OptionGroupsModule } from '../option-groups/option-groups.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [KitchenModule, OptionGroupsModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
