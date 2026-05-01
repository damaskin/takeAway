import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { AdminBrandsController } from './admin-brands.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminProductsController } from './admin-products.controller';
import { AdminStoresController } from './admin-stores.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminBrandsController, AdminStoresController, AdminCategoriesController, AdminProductsController],
  providers: [AdminCatalogService],
})
export class AdminCatalogModule {}
