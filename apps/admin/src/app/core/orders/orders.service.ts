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
}
