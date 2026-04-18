import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type KdsOrderStatus = 'CREATED' | 'PAID' | 'ACCEPTED' | 'IN_PROGRESS' | 'READY';

export interface KdsOrder {
  id: string;
  orderCode: string;
  status: KdsOrderStatus;
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt: string;
  createdAt: string;
  customerName: string | null;
  notes: string | null;
  items: Array<{
    productSnapshot: { name?: string };
    quantity: number;
  }>;
}

@Injectable({ providedIn: 'root' })
export class KdsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(storeId: string): Observable<KdsOrder[]> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.get<KdsOrder[]>(`${this.api.baseUrl}/kds/orders`, { params });
  }

  accept(storeId: string, id: string): Observable<{ id: string; status: KdsOrderStatus }> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.post<{ id: string; status: KdsOrderStatus }>(
      `${this.api.baseUrl}/kds/orders/${id}/accept`,
      {},
      { params },
    );
  }

  start(storeId: string, id: string): Observable<{ id: string; status: KdsOrderStatus }> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.post<{ id: string; status: KdsOrderStatus }>(
      `${this.api.baseUrl}/kds/orders/${id}/start`,
      {},
      { params },
    );
  }

  ready(storeId: string, id: string): Observable<{ id: string; status: KdsOrderStatus }> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.post<{ id: string; status: KdsOrderStatus }>(
      `${this.api.baseUrl}/kds/orders/${id}/ready`,
      {},
      { params },
    );
  }

  pickedUp(storeId: string, id: string): Observable<{ id: string; status: KdsOrderStatus }> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.post<{ id: string; status: KdsOrderStatus }>(
      `${this.api.baseUrl}/kds/orders/${id}/picked-up`,
      {},
      { params },
    );
  }
}
