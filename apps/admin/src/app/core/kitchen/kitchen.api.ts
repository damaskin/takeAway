import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AsapBlockedReason,
  KitchenDeviceBinding,
  KitchenDeviceStores,
  KitchenOrderTimeline,
  ShiftCloseSummary,
  ShiftExtendMinutes,
} from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** The header a bound tablet sends its token in. */
export const KITCHEN_DEVICE_HEADER = 'X-Kitchen-Device';

/** The statuses an order passes through while it is on the kitchen board. */
export type KitchenOrderStatus = 'CREATED' | 'PAID' | 'ACCEPTED' | 'IN_PROGRESS' | 'READY';

/**
 * One row of `GET /kds/orders` — and of a `kds.orderChanged` event. The
 * timing fields (`startBy`, the acceptance clock) are absent from older API
 * builds.
 */
export interface KitchenOrder extends Partial<KitchenOrderTimeline> {
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
  /** The kitchen marked the store «Загружены». Absent from older API builds. */
  busy?: boolean;
  /** ASAP orders are taken past the working hours until then; null without an extension. */
  extendedUntil?: string | null;
  /** End of the current working-hours window; null outside the hours and around the clock. */
  closesAt?: string | null;
  /** Start of the next working-hours window while outside the hours. */
  opensAt?: string | null;
  /** An ASAP order placed now would be taken. */
  asapOpen?: boolean;
  asapBlockedReason?: AsapBlockedReason | null;
  /** The last shift was closed by the schedule, not by a person. */
  closedAutomatically?: boolean;
}

export type { ShiftCloseSummary, ShiftExtendMinutes };

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
export type KitchenRejectMoney = 'not_charged' | 'released' | 'refunded' | 'pending' | 'none';

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

  /**
   * The stores a bound tablet's PIN screen offers: its brand's stores where
   * someone has a PIN. 401 `KDS_DEVICE_UNKNOWN` once the tablet is unbound.
   */
  deviceStores(deviceToken: string): Observable<KitchenDeviceStores> {
    return this.http.get<KitchenDeviceStores>(`${this.api.baseUrl}/auth/kds/device`, {
      headers: new HttpHeaders({ [KITCHEN_DEVICE_HEADER]: deviceToken }),
    });
  }

  /** Binds this browser to the brand of a store the signed-in employee works at. */
  bindDevice(storeId: string): Observable<KitchenDeviceBinding> {
    return this.http.post<KitchenDeviceBinding>(`${this.api.baseUrl}/auth/kds/device`, { storeId });
  }

  /** Binds this browser with the one-time code of a tablet link from the Staff page. */
  pairDevice(code: string): Observable<KitchenDeviceBinding> {
    return this.http.post<KitchenDeviceBinding>(`${this.api.baseUrl}/auth/kds/device/pair`, { code });
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

  /** What "Finish work" would leave behind: orders to accept first, to finish, for later. */
  closeSummary(storeId: string): Observable<ShiftCloseSummary> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.get<ShiftCloseSummary>(`${this.api.baseUrl}/kds/shift/close-summary`, { params });
  }

  /** «Продлить»: ASAP orders keep coming this much longer past the working hours. */
  extendShift(storeId: string, minutes: ShiftExtendMinutes): Observable<StoreShift> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.put<StoreShift>(`${this.api.baseUrl}/kds/shift/extend`, { minutes }, { params });
  }

  /** «Загружены» on or off; answers the shift with the new `busy`. */
  setBusy(storeId: string, busy: boolean): Observable<StoreShift> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.put<StoreShift>(`${this.api.baseUrl}/kds/busy`, { busy }, { params });
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
