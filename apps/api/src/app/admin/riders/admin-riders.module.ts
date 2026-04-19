import { Module } from '@nestjs/common';

import { AdminRidersController } from './admin-riders.controller';
import { AdminRidersService } from './admin-riders.service';

@Module({
  controllers: [AdminRidersController],
  providers: [AdminRidersService],
})
export class AdminRidersModule {}
