import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KdsSessionAllowed } from '../auth/decorators/kds-session.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { codedConflict } from '../common/http/coded-conflict';
import { ExtendShiftDto } from './dto/extend-shift.dto';
import { PauseStoreDto } from './dto/pause-store.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { SetStoreBusyDto } from './dto/set-busy.dto';
import { KdsService } from './kds.service';
import { StoreShiftService } from './store-shift.service';

@ApiTags('kds')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
// The kitchen board itself: a PIN session works it, for its own store only.
@KdsSessionAllowed({ from: 'query', key: 'storeId' })
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

  /**
   * The store's shift and what it means for ASAP orders right now: the
   * working hours around it (`closesAt`, `opensAt`), an extension past them,
   * whether an ASAP order would be taken and why not.
   */
  @Get('shift')
  @ApiQuery({ name: 'storeId', required: true })
  async shift(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.shifts.current(storeId);
  }

  /**
   * "Start work" and "Finish work" are gone (2026-10-20): the schedule opens
   * and closes the shift. Kept for cabinets loaded before the change, which
   * get a 409 `SHIFT_FOLLOWS_SCHEDULE` instead of a 404.
   */
  @Post(['shift/open', 'shift/close'])
  @ApiQuery({ name: 'storeId', required: true })
  @ApiConflictResponse({ description: '`SHIFT_FOLLOWS_SCHEDULE`: the working hours open and close the shift.' })
  async manualShift(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string): Promise<never> {
    await this.assertInScope(user, storeId);
    throw codedConflict(
      'SHIFT_FOLLOWS_SCHEDULE',
      'The shift opens and closes by the working hours; extend the closing or pause the store instead',
    );
  }

  /**
   * «Продлить на 30 мин / 1 ч»: ASAP orders keep coming past the working
   * hours. Only in the last hour before the closing, or while an extension
   * runs (`KitchenShiftState.canExtend`); else 409
   * `SHIFT_EXTENSION_NOT_ALLOWED {reason}`.
   */
  @Put('shift/extend')
  @ApiQuery({ name: 'storeId', required: true })
  async extendShift(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId') storeId: string,
    @Body() dto: ExtendShiftDto,
  ) {
    await this.assertInScope(user, storeId);
    return this.shifts.extend(storeId, dto.minutes);
  }

  /**
   * «Загружены»: whoever is in the kitchen marks the store busy (or back to
   * normal). Customers see it at once; orders keep coming. Answers the
   * shift, which carries `busy`, and tells every tablet of the store.
   */
  @Put('busy')
  @ApiQuery({ name: 'storeId', required: true })
  async setBusy(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId') storeId: string,
    @Body() dto: SetStoreBusyDto,
  ) {
    await this.assertInScope(user, storeId);
    return this.shifts.setBusy(storeId, dto.busy);
  }

  /**
   * «Пауза»: the coffee machine broke, a cook went home. No ASAP orders and
   * no pre-orders for a time before the pause ends; the cart still fills.
   * The store team and the owner are told in Telegram. Answers the shift,
   * which carries the pause, and tells every tablet of the store. 409
   * `STORE_SWITCHED_OFF`, `PAUSE_NEEDS_DURATION` (until the closing, with
   * nothing opening soon).
   */
  @Put('pause')
  @ApiQuery({ name: 'storeId', required: true })
  async pause(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string, @Body() dto: PauseStoreDto) {
    await this.assertInScope(user, storeId);
    return this.shifts.pause(storeId, user.id, dto);
  }

  /** «Снять паузу»: the store takes orders again. Idempotent. */
  @Delete('pause')
  @ApiQuery({ name: 'storeId', required: true })
  async resume(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.shifts.resume(storeId, user.id);
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
    // A PIN session works the one store it was opened for.
    if (user.kdsStoreId && user.kdsStoreId !== storeId) {
      throw new ForbiddenException('Store is outside your scope');
    }
    const scope = await this.scope.getScope(user.id, user.role);
    if (scope === '*') return;
    if (!scope.includes(storeId)) {
      throw new ForbiddenException('Store is outside your scope');
    }
  }
}
