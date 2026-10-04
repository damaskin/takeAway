import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RejectOrderDto } from './dto/reject-order.dto';
import { KdsService } from './kds.service';
import { StoreShiftService } from './store-shift.service';

@ApiTags('kds')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
@Controller('kds')
export class KdsController {
  constructor(
    private readonly kds: KdsService,
    private readonly shifts: StoreShiftService,
    private readonly scope: UserStoreScopeService,
  ) {}

  @Get('orders')
  @ApiQuery({ name: 'storeId', required: true })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.kds.listOpen(storeId);
  }

  /** The store's shift: open means it takes orders. */
  @Get('shift')
  @ApiQuery({ name: 'storeId', required: true })
  async shift(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.shifts.current(storeId);
  }

  /** "Start work": the store appears as active and takes orders. */
  @Post('shift/open')
  @ApiQuery({ name: 'storeId', required: true })
  async openShift(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.shifts.open(storeId, user.id);
  }

  /** "Finish work": new orders stop; the ones already on the board stay. */
  @Post('shift/close')
  @ApiQuery({ name: 'storeId', required: true })
  async closeShift(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.shifts.close(storeId, user.id);
  }

  @Post('orders/:id/accept')
  async accept(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Param('id') id: string) {
    await this.assertInScope(user, storeId);
    return this.kds.accept(storeId, id, user.id);
  }

  /**
   * The kitchen turns the order down before accepting it. The customer's money
   * comes back — a hold is released, a captured charge refunded — and they get
   * a push with the reason.
   */
  @Post('orders/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: RejectOrderDto,
  ) {
    await this.assertInScope(user, storeId);
    return this.kds.reject(storeId, id, user.id, dto);
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
   * Narrow the raw `storeId` query param to the caller's store scope (see
   * UserStoreScopeService): SUPER_ADMIN passes through, BRAND_ADMIN reaches
   * the stores of the brands it owns, STORE_MANAGER / STAFF their assigned
   * stores. The same rule covers the shift buttons on the Stores page and
   * the kitchen board.
   */
  private async assertInScope(user: AuthenticatedUser, storeId: string): Promise<void> {
    const scope = await this.scope.getScope(user.id, user.role);
    if (scope === '*') return;
    if (!scope.includes(storeId)) {
      throw new ForbiddenException('Store is outside your scope');
    }
  }
}
