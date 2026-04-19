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
  totalCents: number;
  currency: string;
  storeId: string;
  storeName: string;
  items: Array<{
    id: string;
    productSnapshot: { name?: string };
    quantity: number;
    totalCents: number;
  }>;
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

  listMine(group: 'ACTIVE' | 'HISTORY' | 'ALL' = 'ALL', take = 20): Observable<OrderSummary[]> {
    return this.http.get<OrderSummary[]>(`${this.api.baseUrl}/me/orders?group=${group}&take=${take}`);
  }
}
