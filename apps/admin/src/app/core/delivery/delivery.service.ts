import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import type { OrderStatusString } from '../orders/orders.service';

/**
 * Client for the server `/delivery/*` routes. Split into "dispatcher"
 * endpoints (used by the admin app's dispatcher view, requires
 * STORE_MANAGER+) and "rider" endpoints (used by the rider layout,
 * requires RIDER). The server enforces both role gates via guards;
 * the client just calls whatever the signed-in user can use.
 */

export interface DispatchOrderRow {
  id: string;
  orderCode: string;
  status: OrderStatusString;
  pickupAt: string;
  readyAt: string | null;
  totalCents: number;
  deliveryFeeCents: number;
  currency: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddressLine: string | null;
  deliveryCity: string | null;
  deliveryNotes: string | null;
  riderId: string | null;
  rider: { id: string; name: string | null; phone: string | null } | null;
  itemCount: number;
  createdAt: string;
}

export interface RiderQueueRow {
  id: string;
  orderCode: string;
  status: OrderStatusString;
  pickupAt: string;
  readyAt: string | null;
  totalCents: number;
  deliveryFeeCents: number;
  currency: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddressLine: string | null;
  deliveryCity: string | null;
  deliveryNotes: string | null;
  riderId: string | null;
  store: { id: string; name: string; addressLine: string; city: string };
  itemCount: number;
  createdAt: string;
  mine: boolean;
}

export interface AvailableRider {
  id: string;
  name: string | null;
  phone: string | null;
}

@Injectable({ providedIn: 'root' })
export class DeliveryApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  // ── Dispatcher ─────────────────────────────────────────────────────────

  listQueue(storeId: string): Observable<DispatchOrderRow[]> {
    return this.http.get<DispatchOrderRow[]>(
      `${this.api.baseUrl}/delivery/queue?storeId=${encodeURIComponent(storeId)}`,
    );
  }

  listRiders(storeId: string): Observable<AvailableRider[]> {
    return this.http.get<AvailableRider[]>(
      `${this.api.baseUrl}/delivery/riders?storeId=${encodeURIComponent(storeId)}`,
    );
  }

  assignRider(orderId: string, riderId: string): Observable<{ id: string; riderId: string }> {
    return this.http.post<{ id: string; riderId: string }>(`${this.api.baseUrl}/delivery/orders/${orderId}/assign`, {
      riderId,
    });
  }

  // ── Rider ──────────────────────────────────────────────────────────────

  myQueue(): Observable<RiderQueueRow[]> {
    return this.http.get<RiderQueueRow[]>(`${this.api.baseUrl}/delivery/my`);
  }

  selfAssign(orderId: string): Observable<{ id: string; riderId: string }> {
    return this.http.post<{ id: string; riderId: string }>(
      `${this.api.baseUrl}/delivery/orders/${orderId}/self-assign`,
      {},
    );
  }

  transitionStatus(
    orderId: string,
    to: 'OUT_FOR_DELIVERY' | 'DELIVERED',
  ): Observable<{
    id: string;
    status: OrderStatusString;
    outForDeliveryAt: string | null;
    deliveredAt: string | null;
  }> {
    return this.http.patch<{
      id: string;
      status: OrderStatusString;
      outForDeliveryAt: string | null;
      deliveredAt: string | null;
    }>(`${this.api.baseUrl}/delivery/orders/${orderId}/status`, { to });
  }
}
