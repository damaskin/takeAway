import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { OrderItemSnapshot } from '@takeaway/shared-types';
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
   * The customer may cancel now: not accepted, no money taken. Absent from an
   * older API — see `customerCanCancel`.
   */
  canCancel?: boolean;
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
