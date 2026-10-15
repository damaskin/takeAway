import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { KitchenLoadService } from './kitchen-load.service';
import { StoreAvailabilityService } from './store-availability.service';

/**
 * Standalone so cart, orders, catalog, payments and the realtime layer can
 * all ask the same questions — "when will this actually be ready?" and
 * "does the store take orders now?" — without importing each other and
 * creating a cycle.
 */
@Module({
  imports: [PrismaModule],
  providers: [KitchenLoadService, StoreAvailabilityService],
  exports: [KitchenLoadService, StoreAvailabilityService],
})
export class KitchenModule {}
