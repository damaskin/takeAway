import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BrandScopeService } from '../auth/services/brand-scope.service';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AdminOrderDetailDto } from './dto/admin-order-detail.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { CustomerLocationDto, CustomerLocationResultDto } from './dto/customer-location.dto';
import { OrderDto, OrderSummaryDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly scope: UserStoreScopeService,
    private readonly brandScope: BrandScopeService,
  ) {}

  @Post('orders')
  @ApiOkResponse({ type: OrderDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(user.id, dto);
  }

  @Get('orders/:id')
  @ApiOkResponse({ type: OrderDto })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OrderDto> {
    return this.orders.getForUser(user.id, id);
  }

  @Post('orders/:id/cancel')
  @ApiOkResponse({ type: OrderDto })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OrderDto> {
    return this.orders.cancel(user.id, id);
  }

  /**
   * Geofencing ping from the customer's order-status screen. The client
   * fires it on a coarse interval while the order is in CREATED..READY,
   * and once explicitly with `iAmHere=true` when the user taps the button.
   *
   * Server classifies distance to the store and records a one-shot
   * `CUSTOMER_NEARBY` / `CUSTOMER_HERE` event so the KDS chip lights up
   * exactly once per level.
   */
  @Post('orders/:id/location')
  @ApiOkResponse({ type: CustomerLocationResultDto })
  reportLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CustomerLocationDto,
  ): Promise<CustomerLocationResultDto> {
    return this.orders.recordCustomerLocation(user.id, id, dto);
  }

  @Post('me/orders/:id/resend-receipt')
  @ApiOkResponse({ description: 'Receipt re-sent to the user email on file.' })
  resendReceipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<{ ok: true }> {
    return this.orders.resendReceipt(user.id, id);
  }

  @Get('me/orders')
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'group', required: false, enum: ['ACTIVE', 'HISTORY', 'ALL'] })
  @ApiOkResponse({ type: OrderSummaryDto, isArray: true })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('take') take?: string,
    @Query('group') group?: 'ACTIVE' | 'HISTORY' | 'ALL',
  ): Promise<OrderSummaryDto[]> {
    return this.orders.listForUser(user.id, take ? Number(take) : undefined, group ?? 'ALL');
  }

  // ── Admin feed ────────────────────────────────────────────────────────────

  @Get('admin/orders')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN', 'STORE_MANAGER')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiQuery({ name: 'storeId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiOkResponse({ type: OrderSummaryDto, isArray: true })
  async listAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
  ): Promise<OrderSummaryDto[]> {
    const scope = await this.scope.getScope(user.id, user.role);
    // BRAND_ADMIN must only see orders from their own brands — resolve and enforce.
    const brandIds =
      user.role === Role.BRAND_ADMIN ? ((await this.brandScope.resolveBrandIds(user)) ?? undefined) : undefined;
    return this.orders.listForAdmin({
      brandId,
      brandIds,
      storeId,
      status,
      take: take ? Number(take) : undefined,
      scopeStoreIds: scope === '*' ? undefined : [...scope],
    });
  }

  /**
   * One order in full — items, payments, refunds and the event timeline.
   * The refund endpoint has existed since M5 with nothing in the interface
   * able to reach it; this is what the refund button reads.
   */
  @Get('admin/orders/:id')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN', 'STORE_MANAGER')
  @ApiOkResponse({ type: AdminOrderDetailDto })
  async getAdminOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') orderId: string,
  ): Promise<AdminOrderDetailDto> {
    const scope = await this.scope.getScope(user.id, user.role);
    return this.orders.getForAdmin(orderId, scope === '*' ? undefined : [...scope]);
  }
}
