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

export interface AdminOrderSummary {
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

export interface AdminOrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface AdminOrderPayment {
  id: string;
  provider: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  providerRef: string | null;
  createdAt: string;
}

export interface AdminOrderEvent {
  id: string;
  type: string;
  createdAt: string;
  actorId: string | null;
  payload: unknown;
}

export interface AdminOrderDetail {
  id: string;
  orderCode: string;
  status: OrderStatusString;
  fulfillmentType: string;
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt: string;
  createdAt: string;
  storeId: string;
  storeName: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  deliveryFeeCents: number;
  giftCardCents: number;
  totalCents: number;
  couponCode: string | null;
  giftCardCode: string | null;
  refundedCents: number;
  /** 0 hides the refund control — nothing left to give back. */
  refundableCents: number;
  items: AdminOrderItem[];
  payments: AdminOrderPayment[];
  events: AdminOrderEvent[];
}

export interface RefundResult {
  refundId: string;
  refundedCents: number;
  remainingCents: number;
  paymentStatus: 'REFUNDED' | 'PARTIALLY_REFUNDED';
}

@Injectable({ providedIn: 'root' })
export class AdminOrdersApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(
    params: {
      brandId?: string;
      storeId?: string;
      status?: string;
      take?: number;
    } = {},
  ): Observable<AdminOrderSummary[]> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return this.http.get<AdminOrderSummary[]>(`${this.api.baseUrl}/admin/orders${qs ? '?' + qs : ''}`);
  }

  get(orderId: string): Observable<AdminOrderDetail> {
    return this.http.get<AdminOrderDetail>(`${this.api.baseUrl}/admin/orders/${orderId}`);
  }

  /**
   * Full or partial refund. Omitting `amountCents` refunds everything still
   * refundable, which is what the button does by default.
   */
  refund(orderId: string, body: { amountCents?: number; reason?: string; note?: string }): Observable<RefundResult> {
    return this.http.post<RefundResult>(`${this.api.baseUrl}/admin/orders/${orderId}/refund`, body);
  }
}
