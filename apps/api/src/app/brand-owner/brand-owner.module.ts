import { Module } from '@nestjs/common';

import { BrandOwnerController } from './brand-owner.controller';

@Module({
  controllers: [BrandOwnerController],
})
export class BrandOwnerModule {}
