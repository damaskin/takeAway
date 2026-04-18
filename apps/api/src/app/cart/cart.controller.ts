import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/add-cart-item.dto';
import { CartDto } from './dto/cart.dto';

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiQuery({ name: 'storeId', required: true })
  @ApiOkResponse({ type: CartDto })
  get(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string): Promise<CartDto> {
    return this.cart.getForUserAndStore(user.id, storeId);
  }

  @Post('items')
  @ApiOkResponse({ type: CartDto })
  addItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCartItemDto): Promise<CartDto> {
    return this.cart.addItem(user.id, dto);
  }

  @Patch('items/:itemId')
  @ApiOkResponse({ type: CartDto })
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartDto> {
    return this.cart.updateItem(user.id, itemId, dto);
  }

  @Delete('items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CartDto })
  removeItem(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string): Promise<CartDto> {
    return this.cart.removeItem(user.id, itemId);
  }

  @Delete()
  @ApiQuery({ name: 'storeId', required: true })
  @ApiOkResponse({ type: CartDto })
  clear(@CurrentUser() user: AuthenticatedUser, @Query('storeId') storeId: string): Promise<CartDto> {
    return this.cart.clear(user.id, storeId);
  }
}
