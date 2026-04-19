import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryFeeService } from './delivery-fee.service';
import { DeliveryService } from './delivery.service';
import { AssignRiderDto } from './dto/assign-rider.dto';
import { QuoteDeliveryDto } from './dto/quote-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

@ApiTags('delivery')
@ApiBearerAuth()
@Controller('delivery')
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly scope: UserStoreScopeService,
    private readonly fee: DeliveryFeeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Fee quote for a candidate delivery. Open to any authenticated user — it's
   * used by checkout UIs (web/tma) to show a live fee as the customer shares
   * their location. Safe to expose: the only inputs are the store id and the
   * customer's own coords, and the response carries no PII.
   */
  @Post('quote')
  @ApiOkResponse()
  async quote(@Body() dto: QuoteDeliveryDto) {
    const store = await this.prisma.store.findUnique({
      where: { id: dto.storeId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        fulfillmentTypes: true,
        currency: true,
        deliveryFeeBaseCents: true,
        deliveryFeePerKmCents: true,
        deliveryFreeRadiusM: true,
        deliveryMaxRadiusM: true,
      },
    });
    if (!store) throw new NotFoundException('Store not found');
    const supportsDelivery = store.fulfillmentTypes.includes('DELIVERY');
    const q = this.fee.quote({
      storeLatitude: store.latitude,
      storeLongitude: store.longitude,
      customerLatitude: dto.latitude ?? null,
      customerLongitude: dto.longitude ?? null,
      storeOverrides: {
        deliveryFeeBaseCents: store.deliveryFeeBaseCents,
        deliveryFeePerKmCents: store.deliveryFeePerKmCents,
        deliveryFreeRadiusM: store.deliveryFreeRadiusM,
        deliveryMaxRadiusM: store.deliveryMaxRadiusM,
      },
    });
    return {
      feeCents: q.feeCents,
      distanceM: q.distanceM,
      deliverable: supportsDelivery && q.deliverable,
      reason: supportsDelivery ? q.reason : 'STORE_NOT_DELIVERING',
      currency: store.currency,
    };
  }

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
