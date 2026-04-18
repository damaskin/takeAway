import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { KdsService } from './kds.service';

@ApiTags('kds')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
@Controller('kds')
export class KdsController {
  constructor(private readonly kds: KdsService) {}

  @Get('orders')
  @ApiQuery({ name: 'storeId', required: true })
  list(@Query('storeId') storeId: string) {
    return this.kds.listOpen(storeId);
  }

  @Post('orders/:id/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    return this.kds.accept(storeId, id, user.id);
  }

  @Post('orders/:id/start')
  start(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    return this.kds.start(storeId, id, user.id);
  }

  @Post('orders/:id/ready')
  ready(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    return this.kds.ready(storeId, id, user.id);
  }

  @Post('orders/:id/picked-up')
  pickedUp(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    return this.kds.pickedUp(storeId, id, user.id);
  }
}
