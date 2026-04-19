import { Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { KdsService } from './kds.service';

@ApiTags('kds')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
@Controller('kds')
export class KdsController {
  constructor(
    private readonly kds: KdsService,
    private readonly scope: UserStoreScopeService,
  ) {}

  @Get('orders')
  @ApiQuery({ name: 'storeId', required: true })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.kds.listOpen(storeId);
  }

  @Post('orders/:id/accept')
  async accept(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    await this.assertInScope(user, storeId);
    return this.kds.accept(storeId, id, user.id);
  }

  @Post('orders/:id/start')
  async start(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    await this.assertInScope(user, storeId);
    return this.kds.start(storeId, id, user.id);
  }

  @Post('orders/:id/ready')
  async ready(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    await this.assertInScope(user, storeId);
    return this.kds.ready(storeId, id, user.id);
  }

  @Post('orders/:id/picked-up')
  async pickedUp(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    await this.assertInScope(user, storeId);
    return this.kds.pickedUp(storeId, id, user.id);
  }

  /**
   * Narrow the raw `storeId` query param to the caller's UserStore scope.
   * BRAND_ADMIN / SUPER_ADMIN pass through; STORE_MANAGER / STAFF can only
   * act on their assigned stores.
   */
  private async assertInScope(user: AuthenticatedUser, storeId: string): Promise<void> {
    const scope = await this.scope.getScope(user.id, user.role);
    if (scope === '*') return;
    if (!scope.includes(storeId)) {
      throw new ForbiddenException('Store is outside your scope');
    }
  }
}
