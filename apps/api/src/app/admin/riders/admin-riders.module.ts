import { Module } from '@nestjs/common';

import { UserStoreScopeService } from '../../auth/services/user-store-scope.service';
import { AdminRidersController } from './admin-riders.controller';
import { AdminRidersService } from './admin-riders.service';

@Module({
  controllers: [AdminRidersController],
  providers: [AdminRidersService, UserStoreScopeService],
})
export class AdminRidersModule {}
