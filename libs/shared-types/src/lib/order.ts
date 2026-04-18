/**
 * Order / Cart / Payment transport types shared across apps.
 */

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

export interface OrderItem {
  id: string;
  productSnapshot: {
    id: string;
    name: string;
    variationNames?: string[];
    modifierNames?: Array<{ name: string; count: number }>;
  };
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

export interface OrderStatusEvent {
  orderId: string;
  status: OrderStatusEnum;
  etaSeconds: number;
  occurredAt: string;
}
