import { ApiProperty } from '@nestjs/swagger';
import type { CartChangeReason, CartChangedError, CartChangedItem } from '@takeaway/shared-types';

const REASONS: CartChangeReason[] = ['PRODUCT_UNAVAILABLE', 'OPTION_UNAVAILABLE', 'PRICE_CHANGED', 'OPTIONS_CHANGED'];

export class CartChangedItemDto implements CartChangedItem {
  @ApiProperty()
  cartItemId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({
    enum: REASONS,
    description:
      'PRODUCT_UNAVAILABLE and OPTION_UNAVAILABLE: the line was removed from the cart. ' +
      'PRICE_CHANGED and OPTIONS_CHANGED: the line was re-priced in place.',
  })
  reason!: CartChangeReason;

  @ApiProperty({ description: 'Unit price the cart showed before the check, in cents.' })
  previousUnitPriceCents!: number;

  @ApiProperty({ nullable: true, type: Number, description: 'Unit price now, in cents; null when removed.' })
  unitPriceCents!: number | null;
}

/** 409 from `POST /orders`: no order was created and the cart now reflects the menu. */
export class CartChangedErrorDto implements CartChangedError {
  @ApiProperty({ enum: [409] })
  statusCode!: 409;

  @ApiProperty({ enum: ['Conflict'] })
  error!: 'Conflict';

  @ApiProperty({ enum: ['CART_CHANGED'], description: 'Machine-readable; clients key their UI off it.' })
  code!: 'CART_CHANGED';

  @ApiProperty({ example: 'Цены или состав меню изменились — проверьте корзину' })
  message!: string;

  @ApiProperty({ type: [CartChangedItemDto] })
  items!: CartChangedItemDto[];
}
