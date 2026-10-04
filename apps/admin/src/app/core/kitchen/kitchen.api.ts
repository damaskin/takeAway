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
  /** HERE once the customer tapped "I'm here" (or walked in), NEARBY when close. Absent from older API builds. */
  customerArrival?: 'NEARBY' | 'HERE' | null;
  customerArrivedAt?: string | null;
  items: Array<{
    /** Raw `OrderItem.productSnapshot`; read it with `readOrderItemSnapshot`. */
    productSnapshot: unknown;
    quantity: number;
  }>;
}

/** `GET /kds/shift` — whether the store is working, i.e. takes orders. */
export interface StoreShift {
  storeId: string;
  open: boolean;
  openedAt: string | null;
  openedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
}

export type KitchenAction = 'accept' | 'start' | 'ready' | 'pickedUp';

/** Why the kitchen turns an order down before accepting it; the customer sees it. */
export type KitchenRejectReason = 'OUT_OF_STOCK' | 'TOO_BUSY' | 'CLOSING' | 'OTHER';

/** The longest comment the API takes with a rejection. */
export const KITCHEN_REJECT_COMMENT_MAX = 200;

export interface KitchenRejectBody {
  reason: KitchenRejectReason;
  /** Shown to the customer; at most {@link KITCHEN_REJECT_COMMENT_MAX} characters. */
  comment?: string;
}

/**
 * What happened to the customer's money: a held payment was `released`, a
 * captured one `refunded`, a refund the bank has yet to confirm is `pending`,
 * and `none` when nothing had been paid.
 */
export type KitchenRejectMoney = 'released' | 'refunded' | 'pending' | 'none';

/** `POST /kds/orders/:id/reject` */
export interface KitchenRejectResult {
  id: string;
  status: 'CANCELLED';
  orderCode: string;
  money: KitchenRejectMoney;
}

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

  shift(storeId: string): Observable<StoreShift> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.get<StoreShift>(`${this.api.baseUrl}/kds/shift`, { params });
  }

  /** "Start work" (`open`) or "Finish work" (`close`) at the store. */
  setShift(storeId: string, open: boolean): Observable<StoreShift> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.post<StoreShift>(`${this.api.baseUrl}/kds/shift/${open ? 'open' : 'close'}`, {}, { params });
  }

  run(action: KitchenAction, storeId: string, orderId: string): Observable<{ id: string; status: string }> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.post<{ id: string; status: string }>(
      `${this.api.baseUrl}/kds/orders/${orderId}/${ACTION_PATHS[action]}`,
      {},
      { params },
    );
  }

  /**
   * Turns down an order nobody has accepted yet (CREATED or PAID). The API
   * gives the customer's money back and tells them why; anything later is a 400.
   */
  reject(storeId: string, orderId: string, body: KitchenRejectBody): Observable<KitchenRejectResult> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.post<KitchenRejectResult>(`${this.api.baseUrl}/kds/orders/${orderId}/reject`, body, {
      params,
    });
  }
}
