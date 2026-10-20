import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KdsSessionAllowed } from '../auth/decorators/kds-session.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ExtendShiftDto } from './dto/extend-shift.dto';
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

  /** What "Finish work" would leave behind — for the dialog that asks before it. */
  @Get('shift/close-summary')
  @ApiQuery({ name: 'storeId', required: true })
  async closeSummary(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.shifts.closeSummary(storeId);
  }

  /** "Start work": the store takes ASAP orders within its working hours. */
  @Post('shift/open')
  @ApiQuery({ name: 'storeId', required: true })
  async openShift(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.shifts.open(storeId, user.id);
  }

  /**
   * "Finish work": ASAP orders stop; the ones already on the board stay, and
   * pre-orders keep coming. 409 `SHIFT_HAS_UNACCEPTED_ORDERS {count}` while
   * orders due within 30 minutes wait for «Принять».
   */
  @Post('shift/close')
  @ApiQuery({ name: 'storeId', required: true })
  async closeShift(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string) {
    await this.assertInScope(user, storeId);
    return this.shifts.close(storeId, user.id);
  }

  /**
   * «Продлить на 30 мин / 1 ч»: ASAP orders keep coming past the working
   * hours. 409 `SHIFT_NOT_OPEN`, `SHIFT_EXTENSION_NOT_NEEDED` (open around
   * the clock), `SHIFT_EXTENSION_LIMIT` (four hours past the closing).
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
    // A PIN session works its person's stores in the tablet's brand.
    if (user.kdsStoreIds && !user.kdsStoreIds.includes(storeId)) {
      throw new ForbiddenException('Store is outside your scope');
    }
    const scope = await this.scope.getScope(user.id, user.role);
    if (scope === '*') return;
    if (!scope.includes(storeId)) {
      throw new ForbiddenException('Store is outside your scope');
    }
  }
}
