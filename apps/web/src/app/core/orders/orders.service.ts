import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
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
  customerName: string | null;
  items: Array<{
    id: string;
    productSnapshot: { name?: string };
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  createdAt: string;
  readyAt: string | null;
  cancelledAt: string | null;
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
  itemCount: number;
  createdAt: string;
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

  cancel(id: string): Observable<OrderView> {
    return this.http.post<OrderView>(`${this.api.baseUrl}/orders/${id}/cancel`, {});
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
