import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** The statuses an order passes through while it is on the kitchen board. */
export type KitchenOrderStatus = 'CREATED' | 'PAID' | 'ACCEPTED' | 'IN_PROGRESS' | 'READY';

/** One row of `GET /kds/orders` — and of a `kds.orderChanged` event. */
export interface KitchenOrder {
  id: string;
  orderCode: string;
  status: KitchenOrderStatus;
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt: string;
  createdAt: string;
  customerName: string | null;
  notes: string | null;
  items: Array<{
    /** Raw `OrderItem.productSnapshot`; read it with `readOrderItemSnapshot`. */
    productSnapshot: unknown;
    quantity: number;
  }>;
}

export type KitchenAction = 'accept' | 'start' | 'ready' | 'pickedUp';

const ACTION_PATHS: Record<KitchenAction, string> = {
  accept: 'accept',
  start: 'start',
  ready: 'ready',
  pickedUp: 'picked-up',
};

/**
 * The kitchen endpoints the standalone KDS app used, now called from the
 * business cabinet. `accept` is where the card is charged when the payment
 * was only held at checkout, so the cabinet has no shortcut around it.
 */
@Injectable({ providedIn: 'root' })
export class KitchenApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /** Every public store — what a tablet can be set up for before anyone signs in. */
  publicStores(): Observable<Array<{ id: string; name: string; city: string }>> {
    return this.http.get<Array<{ id: string; name: string; city: string }>>(`${this.api.baseUrl}/stores`);
  }

  list(storeId: string): Observable<KitchenOrder[]> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.get<KitchenOrder[]>(`${this.api.baseUrl}/kds/orders`, { params });
  }

  run(action: KitchenAction, storeId: string, orderId: string): Observable<{ id: string; status: string }> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.post<{ id: string; status: string }>(
      `${this.api.baseUrl}/kds/orders/${orderId}/${ACTION_PATHS[action]}`,
      {},
      { params },
    );
  }
}
