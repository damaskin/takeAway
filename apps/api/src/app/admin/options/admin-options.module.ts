import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import {
  AdminBrandOptionsController,
  AdminProductOptionGroupsController,
  AdminStoreOptionStopsController,
} from './admin-brand-options.controller';
import { AdminBrandOptionsService } from './admin-brand-options.service';
import { AdminLegacyOptionsService } from './admin-legacy-options.service';
import { AdminOptionGroupsController, AdminOptionItemsController } from './admin-option-catalog.controller';
import { AdminOptionCatalogService } from './admin-option-catalog.service';
import { AdminProductOptionGroupsService } from './admin-product-option-groups.service';

/** The admin side of the options catalog (docs/option-groups.md). */
@Module({
  imports: [AuthModule],
  controllers: [
    AdminOptionGroupsController,
    AdminOptionItemsController,
    AdminBrandOptionsController,
    AdminStoreOptionStopsController,
    AdminProductOptionGroupsController,
  ],
  providers: [
    AdminOptionCatalogService,
    AdminBrandOptionsService,
    AdminProductOptionGroupsService,
    AdminLegacyOptionsService,
  ],
})
export class AdminOptionsModule {}
