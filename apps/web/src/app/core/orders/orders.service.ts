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
  | 'CANCELLED'
  | 'EXPIRED';

export interface OrderView {
  id: string;
  orderCode: string;
  qrToken: string;
  status: OrderStatusString;
  pickupMode: 'ASAP' | 'SCHEDULED';
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
}

export interface CreateOrderInput {
  cartId: string;
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
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
}
