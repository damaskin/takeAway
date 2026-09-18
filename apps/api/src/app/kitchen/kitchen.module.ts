import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { KitchenLoadService } from './kitchen-load.service';

/**
 * Standalone so cart, orders, catalog and payments can all ask the same
 * question — "when will this actually be ready?" — without importing each
 * other and creating a cycle.
 */
@Module({
  imports: [PrismaModule],
  providers: [KitchenLoadService],
  exports: [KitchenLoadService],
})
export class KitchenModule {}
