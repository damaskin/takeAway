import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateOrderReviewRequest,
  OrderCancelReason,
  OrderCancelledBy,
  OrderItemSnapshot,
  OrderReview,
} from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type OrderStatusString =
  | 'CREATED'
  | 'PAID'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'READY'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'EXPIRED';

export type FulfillmentTypeString = 'PICKUP' | 'DINE_IN' | 'DELIVERY';

/** Where the customer's money stands — see the API's OrderPaymentDto. */
export type OrderPaymentState = 'NONE' | 'PENDING' | 'HELD' | 'PAID' | 'FAILED' | 'REFUNDED';

export interface OrderPaymentView {
  state: OrderPaymentState;
  amountCents: number;
  cardMask: string | null;
  paidAt: string | null;
}

export interface OrderView {
  id: string;
  orderCode: string;
  qrToken: string;
  status: OrderStatusString;
  pickupMode: 'ASAP' | 'SCHEDULED';
  fulfillmentType?: FulfillmentTypeString;
  pickupAt: string;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  storeId: string;
  storeName: string;
  /** IANA zone of the store; absent from an API older than this build. */
  storeTimezone?: string | null;
  storeLatitude: number;
  storeLongitude: number;
  storeAddress: string | null;
  customerName: string | null;
  items: Array<{
    id: string;
    /** Read it with `readOrderItemSnapshot`, which also copes with an older API. */
    productSnapshot: OrderItemSnapshot;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  createdAt: string;
  readyAt: string | null;
  cancelledAt: string | null;
  /**
   * Who cancelled the order, the store's reason and its comment — read them
   * with `orderCancellation`. Absent from an API older than this build.
   */
  cancelledBy?: OrderCancelledBy | null;
  cancelReason?: OrderCancelReason | null;
  cancelComment?: string | null;
  /**
   * The customer may review the order now: handed over and not reviewed
   * yet. Absent from an API older than this build — then no review is asked.
   */
  canReview?: boolean;
  /** The customer's review, once left; absent from an API older than this build. */
  review?: OrderReview | null;
  /**
   * When the kitchen now expects it ready, set when it accepted or started
   * the order too late for `pickupAt`; the countdown runs to it
   * (`orderDueAt`). Absent from an API older than this build.
   */
  readyEstimateAt?: string | null;
  /**
   * The customer may still cancel: not accepted yet and no money taken.
   * Absent from an API older than this build — then CREATED and PAID count.
   */
  canCancel?: boolean;
  // Delivery fields — null / 0 on PICKUP orders.
  deliveryAddressLine?: string | null;
  deliveryCity?: string | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  deliveryNotes?: string | null;
  deliveryFeeCents?: number;
  riderId?: string | null;
  outForDeliveryAt?: string | null;
  deliveredAt?: string | null;
  payment?: OrderPaymentView;
}

export interface CreateOrderInput {
  cartId: string;
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt?: string;
  fulfillmentType?: FulfillmentTypeString;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  /** Promo / coupon code the customer typed at checkout, if any. */
  couponCode?: string;
  /** Gift-card code, applied after promo and before delivery fee. */
  giftCardCode?: string;
  // Delivery-only. Required when `fulfillmentType === 'DELIVERY'`.
  deliveryAddressLine?: string;
  deliveryCity?: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  deliveryNotes?: string;
}

export interface OrderSummary {
  id: string;
  orderCode: string;
  status: OrderStatusString;
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt: string;
  totalCents: number;
  currency: string;
  storeId: string;
  storeName: string;
  /** IANA zone of the store; absent from an API older than this build. */
  storeTimezone?: string | null;
  itemCount: number;
  createdAt: string;
  /** Who cancelled a cancelled order and the store's reason; absent from an API older than this build. */
  cancelledBy?: OrderCancelledBy | null;
  cancelReason?: OrderCancelReason | null;
  /** Whether the order can be reviewed now, and the stars it got; absent from an API older than this build. */
  canReview?: boolean;
  reviewRating?: number | null;
}

@Injectable({ providedIn: 'root' })
export class OrdersApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  create(input: CreateOrderInput): Observable<OrderView> {
    return this.http.post<OrderView>(`${this.api.baseUrl}/orders`, input);
  }

  get(id: string): Observable<OrderView> {
    return this.http.get<OrderView>(`${this.api.baseUrl}/orders/${id}`);
  }

  /**
   * Allowed only before the kitchen accepts and while no money is taken;
   * otherwise 409 `ORDER_NOT_CANCELLABLE` with `reason: 'ACCEPTED' | 'CHARGED'`.
   */
  cancel(id: string): Observable<OrderView> {
    return this.http.post<OrderView>(`${this.api.baseUrl}/orders/${id}/cancel`, {});
  }

  /**
   * «Как вам заказ?» — once per handed-over order; answers with the order,
   * `review` set. 409 `ORDER_ALREADY_REVIEWED` or `ORDER_NOT_REVIEWABLE`
   * otherwise.
   */
  review(id: string, body: CreateOrderReviewRequest): Observable<OrderView> {
    return this.http.post<OrderView>(`${this.api.baseUrl}/orders/${id}/review`, body);
  }

  validateGiftCard(body: {
    code: string;
    cartId: string;
  }): Observable<{ applicableCents: number; remainingCents: number; currency: string }> {
    return this.http.post<{ applicableCents: number; remainingCents: number; currency: string }>(
      `${this.api.baseUrl}/gift-cards/validate`,
      body,
    );
  }

  reportLocation(
    id: string,
    body: { lat: number; lng: number; iAmHere?: boolean },
  ): Observable<{ level: 'FAR' | 'NEARBY' | 'HERE'; distanceM: number; recorded: boolean }> {
    return this.http.post<{ level: 'FAR' | 'NEARBY' | 'HERE'; distanceM: number; recorded: boolean }>(
      `${this.api.baseUrl}/orders/${id}/location`,
      body,
    );
  }

  createPaymentIntent(orderId: string): Observable<{ clientSecret: string }> {
    return this.http.post<{ clientSecret: string }>(`${this.api.baseUrl}/payments/intent`, { orderId });
  }

  listMine(group: 'ACTIVE' | 'HISTORY' | 'ALL' = 'ALL', take = 20): Observable<OrderSummary[]> {
    return this.http.get<OrderSummary[]>(`${this.api.baseUrl}/me/orders?group=${group}&take=${take}`);
  }

  listAdmin(
    params: {
      brandId?: string;
      storeId?: string;
      status?: string;
      take?: number;
    } = {},
  ): Observable<OrderSummary[]> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return this.http.get<OrderSummary[]>(`${this.api.baseUrl}/admin/orders${qs ? '?' + qs : ''}`);
  }
}
