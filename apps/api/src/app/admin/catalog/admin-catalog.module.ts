import { Module } from '@nestjs/common';

import { AdminBrandsController } from './admin-brands.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminProductsController } from './admin-products.controller';
import { AdminStoresController } from './admin-stores.controller';

@Module({
  controllers: [AdminBrandsController, AdminStoresController, AdminCategoriesController, AdminProductsController],
  providers: [AdminCatalogService],
})
export class AdminCatalogModule {}
