import { Module } from '@nestjs/common';

import { KitchenModule } from '../kitchen/kitchen.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { SuggestionsService } from './suggestions.service';

@Module({
  imports: [KitchenModule],
  controllers: [CatalogController],
  providers: [CatalogService, SuggestionsService],
  exports: [CatalogService],
})
export class CatalogModule {}
