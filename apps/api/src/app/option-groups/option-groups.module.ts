import { Module } from '@nestjs/common';

import { ProductOptionGroupsService } from './product-option-groups.service';

/** The options catalog as customers see it (docs/option-groups.md); used by the catalog, the cart and orders. */
@Module({
  providers: [ProductOptionGroupsService],
  exports: [ProductOptionGroupsService],
})
export class OptionGroupsModule {}
