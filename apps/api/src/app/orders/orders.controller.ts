import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
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
    // Per-user store scope: STORE_MANAGER is narrowed to their UserStore set;
    // BRAND_ADMIN / SUPER_ADMIN pass through (scope = '*').
    const scope = await this.scope.getScope(user.id, user.role);
    return this.orders.listForAdmin({
      brandId,
      storeId,
      status,
      take: take ? Number(take) : undefined,
      scopeStoreIds: scope === '*' ? undefined : [...scope],
    });
  }
}
