import { ConflictException } from '@nestjs/common';
import type { CartChangedError, CartChangedItem } from '@takeaway/shared-types';

/**
 * The cart no longer matched the menu at checkout and has been brought up to
 * date. No order was created: the customer should see the new cart, and its
 * new total, before paying for it.
 */
export class CartChangedException extends ConflictException {
  constructor(readonly items: CartChangedItem[]) {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: 'CART_CHANGED',
      // For clients that show the message as-is; web and the Mini App
      // translate the code instead.
      message: 'Цены или состав меню изменились — проверьте корзину',
      items,
    } satisfies CartChangedError);
  }
}
