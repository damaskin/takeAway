import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminRidersService } from './admin-riders.service';
import { AddRiderDto } from './dto/rider-roster.dto';

@ApiTags('admin: riders')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/stores/:storeId/riders')
export class AdminRidersController {
  constructor(
    private readonly riders: AdminRidersService,
    private readonly stores: UserStoreScopeService,
  ) {}

  // Every route checks the store against the account: without it any brand
  // owner could list, add or remove couriers at any store on the platform.

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Param('storeId') storeId: string) {
    await this.stores.assertAllowed(user.id, user.role, storeId);
    return this.riders.list(storeId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async add(@CurrentUser() user: AuthenticatedUser, @Param('storeId') storeId: string, @Body() dto: AddRiderDto) {
    await this.stores.assertAllowed(user.id, user.role, storeId);
    return this.riders.add(storeId, dto.phone, dto.name);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId') storeId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.stores.assertAllowed(user.id, user.role, storeId);
    await this.riders.remove(storeId, userId);
  }
}
