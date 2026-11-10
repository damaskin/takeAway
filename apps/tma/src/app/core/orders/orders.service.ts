import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateOrderReviewRequest,
  OrderCancelMoney,
  OrderCancelReason,
  OrderCancelledBy,
  OrderItemSnapshot,
  OrderReview,
  PaymentProviderEnum,
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
  | 'CANCELLED'
  | 'EXPIRED';

/** Where the customer's money stands — see the API's OrderPaymentDto. */
export type OrderPaymentState = 'NONE' | 'PENDING' | 'HELD' | 'PAID' | 'FAILED' | 'REFUNDED';

export interface OrderPaymentView {
  state: OrderPaymentState;
  amountCents: number;
  cardMask: string | null;
  paidAt: string | null;
  /**
   * Who took the money — `AGROPROMBANK_QR` words the screen for a QR payment;
   * null with no payment. Absent from an API older than the QR payment.
   */
  provider?: PaymentProviderEnum | null;
}

export interface OrderView {
  id: string;
  orderCode: string;
  qrToken: string;
  status: OrderStatusString;
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt: string;
  totalCents: number;
  currency: string;
  storeId: string;
  storeName: string;
  /** IANA zone of the store; absent from an API older than this build. */
  storeTimezone?: string | null;
  storeLatitude: number;
  storeLongitude: number;
  storeAddress: string | null;
  items: Array<{
    id: string;
    /** Read it with `readOrderItemSnapshot`, which also copes with an older API. */
    productSnapshot: OrderItemSnapshot;
    quantity: number;
    totalCents: number;
  }>;
  payment?: OrderPaymentView;
  /**
   * When the kitchen expects it ready, set once it accepted or started the
   * order too late for `pickupAt`. The countdown runs to it (`orderDueAt`).
   * Absent from an older API.
   */
  readyEstimateAt?: string | null;
  /**
   * True while the API runs the order queue policy: the due time is the
   * queue's, kept up to date, shown as «Готов в 12:11 · ≈ 11 мин». Absent
   * otherwise.
   */
  readyFromQueue?: boolean;
  /**
   * The customer may cancel now: not accepted, no money taken. Absent from an
   * older API — see `customerCanCancel`.
   */
  canCancel?: boolean;
  /**
   * Who cancelled the order, the store's reason and its comment — read them
   * with `orderCancellation`. Absent from an older API.
   */
  cancelledBy?: OrderCancelledBy | null;
  cancelReason?: OrderCancelReason | null;
  cancelComment?: string | null;
  /**
   * Where the money of a cancelled or expired order went, as the push said —
   * read it with `endedOrderMoney`. Null when the API could not tell; absent
   * from an older API.
   */
  cancelMoney?: OrderCancelMoney | null;
  /**
   * The customer may review the order now: handed over and not reviewed
   * yet. Absent from an older API — then no review is asked.
   */
  canReview?: boolean;
  /** The customer's review, once left; absent from an older API. */
  review?: OrderReview | null;
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

  create(input: {
    cartId: string;
    pickupMode: 'ASAP' | 'SCHEDULED';
    pickupAt?: string;
    customerName?: string;
    notes?: string;
    couponCode?: string;
    fulfillmentType?: 'PICKUP' | 'DELIVERY';
    deliveryAddressLine?: string;
    deliveryCity?: string;
    deliveryNotes?: string;
  }): Observable<OrderView> {
    return this.http.post<OrderView>(`${this.api.baseUrl}/orders`, input);
  }

  get(id: string): Observable<OrderView> {
    return this.http.get<OrderView>(`${this.api.baseUrl}/orders/${id}`);
  }

  /**
   * The customer calls the order off before the kitchen accepts it. Refused
   * with 409 `ORDER_NOT_CANCELLABLE {reason: ACCEPTED | CHARGED}` once it
   * is accepted or its money was taken (an older API answers 400 or 409).
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

  reportLocation(
    id: string,
    body: { lat: number; lng: number; iAmHere?: boolean },
  ): Observable<{ level: 'FAR' | 'NEARBY' | 'HERE'; distanceM: number; recorded: boolean }> {
    return this.http.post<{ level: 'FAR' | 'NEARBY' | 'HERE'; distanceM: number; recorded: boolean }>(
      `${this.api.baseUrl}/orders/${id}/location`,
      body,
    );
  }

  listMine(group: 'ACTIVE' | 'HISTORY' | 'ALL' = 'ALL', take = 20): Observable<OrderSummary[]> {
    return this.http.get<OrderSummary[]>(`${this.api.baseUrl}/me/orders?group=${group}&take=${take}`);
  }
}
