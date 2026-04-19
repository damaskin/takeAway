import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DeliveryService } from './delivery.service';
import { AssignRiderDto } from './dto/assign-rider.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

@ApiTags('delivery')
@ApiBearerAuth()
@Controller('delivery')
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly scope: UserStoreScopeService,
  ) {}

  // ── Dispatcher endpoints (store manager + admins) ───────────────────────

  @Get('queue')
  @Roles(Role.STORE_MANAGER, Role.BRAND_ADMIN, Role.SUPER_ADMIN)
  @ApiQuery({ name: 'storeId', required: true })
  async queue(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.delivery.queue(storeId);
  }

  @Get('riders')
  @Roles(Role.STORE_MANAGER, Role.BRAND_ADMIN, Role.SUPER_ADMIN)
  @ApiQuery({ name: 'storeId', required: true })
  async riders(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.delivery.availableRiders(storeId);
  }

  @Post('orders/:id/assign')
  @Roles(Role.STORE_MANAGER, Role.BRAND_ADMIN, Role.SUPER_ADMIN)
  @ApiOkResponse()
  async assign(@Param('id') orderId: string, @Body() dto: AssignRiderDto) {
    // Scope is enforced inside delivery.service via UserStore pivot lookup;
    // we don't re-check here because the manager may legitimately be
    // assigning across their full scope.
    return this.delivery.assignRider(orderId, dto.riderId);
  }

  // ── Rider endpoints ─────────────────────────────────────────────────────

  @Get('my')
  @Roles(Role.RIDER)
  @ApiOkResponse()
  myQueue(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.myQueue(user.id);
  }

  @Post('orders/:id/self-assign')
  @Roles(Role.RIDER)
  selfAssign(@CurrentUser() user: AuthenticatedUser, @Param('id') orderId: string) {
    return this.delivery.selfAssign(orderId, user.id);
  }

  @Patch('orders/:id/status')
  @Roles(Role.RIDER)
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') orderId: string,
    @Body() dto: UpdateDeliveryStatusDto,
  ) {
    return this.delivery.transition(orderId, user.id, dto.to);
  }

  private async assertInScope(user: AuthenticatedUser, storeId: string): Promise<void> {
    const scope = await this.scope.getScope(user.id, user.role);
    if (scope === '*') return;
    if (!scope.includes(storeId)) {
      throw new ForbiddenException('Store is outside your scope');
    }
  }
}
