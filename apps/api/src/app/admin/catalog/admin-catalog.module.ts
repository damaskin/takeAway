import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { OnboardingModule } from '../../onboarding/onboarding.module';
import { AdminBrandsController } from './admin-brands.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminProductImagesService } from './admin-product-images.service';
import { AdminProductsController } from './admin-products.controller';
import { AdminStoresController } from './admin-stores.controller';
import { BrandModerationService } from './brand-moderation.service';

@Module({
  imports: [AuthModule, OnboardingModule],
  controllers: [AdminBrandsController, AdminStoresController, AdminCategoriesController, AdminProductsController],
  providers: [AdminCatalogService, AdminProductImagesService, BrandModerationService],
})
export class AdminCatalogModule {}
