import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderDto, OrderSummaryDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

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

  @Get('me/orders')
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiOkResponse({ type: OrderSummaryDto, isArray: true })
  list(@CurrentUser() user: AuthenticatedUser, @Query('take') take?: string): Promise<OrderSummaryDto[]> {
    return this.orders.listForUser(user.id, take ? Number(take) : undefined);
  }
}
