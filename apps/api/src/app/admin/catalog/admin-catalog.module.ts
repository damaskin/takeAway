import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { OnboardingModule } from '../../onboarding/onboarding.module';
import { OptionGroupsModule } from '../../option-groups/option-groups.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AdminBrandsController } from './admin-brands.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminProductImagesService } from './admin-product-images.service';
import { AdminProductsController } from './admin-products.controller';
import { AdminStoresController } from './admin-stores.controller';
import { BrandModerationService } from './brand-moderation.service';
import { StoreAvailabilityService } from './store-availability.service';

@Module({
  // RealtimeModule: switching a store on or off is announced to every client.
  // OptionGroupsModule: whether a product's options let customers see it.
  imports: [AuthModule, OnboardingModule, RealtimeModule, OptionGroupsModule],
  controllers: [AdminBrandsController, AdminStoresController, AdminCategoriesController, AdminProductsController],
  providers: [AdminCatalogService, AdminProductImagesService, BrandModerationService, StoreAvailabilityService],
})
export class AdminCatalogModule {}
