/**
 * Order / Cart / Payment transport types shared across apps.
 */

import type { VariationType } from './catalog';
import type { Currency } from './shared-types';

export type FulfillmentTypeEnum = 'PICKUP' | 'DINE_IN' | 'DELIVERY';
export type PickupModeEnum = 'ASAP' | 'SCHEDULED';

export type OrderStatusEnum =
  | 'CREATED'
  | 'PAID'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'READY'
  | 'PICKED_UP'
  | 'CANCELLED'
  | 'EXPIRED';

export type OrderEventTypeEnum =
  | 'STATUS_CHANGED'
  | 'ETA_UPDATED'
  | 'CUSTOMER_NEARBY'
  | 'CUSTOMER_HERE'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'REFUND_ISSUED'
  | 'CANCELLED'
  | 'NOTE';

export type PaymentProviderEnum = 'STRIPE' | 'TELEGRAM' | 'APPLE_PAY' | 'GOOGLE_PAY';

export type PaymentStatusEnum =
  | 'PENDING'
  | 'REQUIRES_ACTION'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  variationIds: string[];
  modifiers: Record<string, number>;
  unitPriceCents: number;
  unitPrepSeconds: number;
  notes: string | null;
}

export interface Cart {
  id: string;
  userId: string;
  storeId: string;
  subtotalCents: number;
  etaSeconds: number;
  items: CartItem[];
  updatedAt: string;
}

export interface AddCartItemInput {
  storeId: string;
  productId: string;
  quantity: number;
  variationIds?: string[];
  modifiers?: Record<string, number>;
  notes?: string;
}

export interface UpdateCartItemInput {
  quantity?: number;
  variationIds?: string[];
  modifiers?: Record<string, number>;
  notes?: string;
}

export interface OrderSummary {
  id: string;
  orderCode: string;
  status: OrderStatusEnum;
  pickupMode: PickupModeEnum;
  pickupAt: string;
  totalCents: number;
  currency: Currency;
  storeId: string;
  storeName: string;
  itemCount: number;
  createdAt: string;
}

// The snapshot shapes below are type aliases rather than interfaces so they
// stay assignable to a JSON column: an interface has no implicit index
// signature, and Prisma's JSON input type is one.

/** A variation the line was made with, as the menu described it at order time. */
export type OrderItemVariation = {
  id: string;
  type: VariationType;
  name: string;
  priceDeltaCents: number;
};

/** An extra on the line. Only extras the customer actually took (count > 0). */
export type OrderItemModifier = {
  id: string;
  name: string;
  count: number;
  /** Price of one; the line pays `count × priceCents`. */
  priceCents: number;
};

/**
 * `OrderItem.productSnapshot` — the line exactly as it was bought, so a later
 * menu edit cannot rewrite what the kitchen makes or what the receipt says.
 *
 * `variations` and `modifierLines` were added in September 2026 and are
 * empty on orders placed before that; those still carry the ids
 * (`variationIds`, `modifiers`) and the line's notes.
 */
export type OrderItemSnapshot = {
  /** Product id. */
  id: string;
  slug: string;
  name: string;
  variationIds: string[];
  /** `{ modifierId: count }` — the form the POS push reads. */
  modifiers: Record<string, number>;
  /** What the customer wrote for this line, e.g. "less foam". */
  notes: string | null;
  unitPrepSeconds: number;
  /** Size first, then milk, temperature and cup — the order a barista reads them in. */
  variations: OrderItemVariation[];
  modifierLines: OrderItemModifier[];
};

export interface OrderItem {
  id: string;
  productSnapshot: OrderItemSnapshot;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface Order extends OrderSummary {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  qrToken: string;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  couponCode: string | null;
  items: OrderItem[];
  acceptedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
}

export interface CreateOrderInput {
  cartId: string;
  pickupMode: PickupModeEnum;
  pickupAt?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  couponCode?: string;
  fulfillmentType?: FulfillmentTypeEnum;
}

export interface CreateOrderResponse {
  order: Order;
  clientSecret?: string;
}

/**
 * Why a cart line did not pass the price check at checkout.
 *
 * - `PRODUCT_UNAVAILABLE` — the product was hidden or removed; the line is gone.
 * - `OPTION_UNAVAILABLE` — a size, milk or extra the customer chose no longer
 *   exists; the line is gone, because making it without that option would
 *   be a different drink.
 * - `PRICE_CHANGED` — the line is still on the menu at a new price; the cart
 *   now holds that price.
 * - `OPTIONS_CHANGED` — same price, but an extra's count had to change to fit
 *   the menu's new limits; the cart now holds the adjusted line.
 */
export type CartChangeReason = 'PRODUCT_UNAVAILABLE' | 'OPTION_UNAVAILABLE' | 'PRICE_CHANGED' | 'OPTIONS_CHANGED';

export interface CartChangedItem {
  cartItemId: string;
  productId: string;
  productName: string;
  reason: CartChangeReason;
  /** The unit price the cart showed before the check. */
  previousUnitPriceCents: number;
  /** The unit price now; `null` when the line was taken out of the cart. */
  unitPriceCents: number | null;
}

/**
 * Body of the 409 that `POST /orders` answers when the cart no longer matches
 * the menu. No order was created; the cart has already been brought up to
 * date, so re-reading it shows what the customer would pay now.
 */
export interface CartChangedError {
  statusCode: 409;
  error: 'Conflict';
  code: 'CART_CHANGED';
  message: string;
  items: CartChangedItem[];
}

export interface OrderStatusEvent {
  orderId: string;
  status: OrderStatusEnum;
  etaSeconds: number;
  occurredAt: string;
}
