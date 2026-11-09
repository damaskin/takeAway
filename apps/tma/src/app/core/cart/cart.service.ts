import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import type { AsapBlockedReason, OptionLine, OptionSelection } from '@takeaway/shared-types';
import { Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface CartItemView {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  variationIds: string[];
  modifiers: Record<string, number>;
  /**
   * Picks from the options catalog with their names and prices, for a
   * product with catalog groups; empty or missing otherwise (and from an API
   * that predates the catalog).
   */
  options?: OptionLine[];
  unitPriceCents: number;
  unitPrepSeconds: number;
  notes: string | null;
}

export interface CartView {
  id: string;
  userId: string;
  storeId: string;
  subtotalCents: number;
  etaSeconds: number;
  items: CartItemView[];
  updatedAt: string;
  /**
   * Under the order queue policy only (absent otherwise): when the cart
   * would be ready if ordered now, whether it can be ordered for now, and
   * why not («Не успеем до закрытия» on CLOSING_SOON).
   */
  readyAt?: string;
  asapAvailable?: boolean;
  asapBlockedReason?: AsapBlockedReason | null;
}

export interface AddToCartInput {
  storeId: string;
  productId: string;
  quantity: number;
  variationIds?: string[];
  modifiers?: Record<string, number>;
  /** The choice from the options catalog (`toOptionSelections`), for a product with catalog groups. */
  options?: OptionSelection[];
  notes?: string;
}

/** A cart line's choice from the options catalog in the form the cart takes it; empty for other lines. */
export function lineSelections(item: Pick<CartItemView, 'options'>): OptionSelection[] {
  return (item.options ?? []).map((line) => ({ optionId: line.optionId, qty: line.qty }));
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private readonly _cart = signal<CartView | null>(null);

  readonly cart = this._cart.asReadonly();
  readonly itemCount = computed(() => this._cart()?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0);
  readonly subtotalCents = computed(() => this._cart()?.subtotalCents ?? 0);

  load(storeId: string): Observable<CartView> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.get<CartView>(`${this.api.baseUrl}/cart`, { params }).pipe(tap((c) => this._cart.set(c)));
  }

  add(input: AddToCartInput): Observable<CartView> {
    return this.http.post<CartView>(`${this.api.baseUrl}/cart/items`, input).pipe(tap((c) => this._cart.set(c)));
  }

  /**
   * A line's new count. A line from the options catalog sends its choice
   * along (`options`), so the count is all that changes whatever the API
   * does with a line it gets no choice for.
   */
  updateQuantity(itemId: string, quantity: number, options?: OptionSelection[]): Observable<CartView> {
    const body = options && options.length > 0 ? { quantity, options } : { quantity };
    return this.http
      .patch<CartView>(`${this.api.baseUrl}/cart/items/${itemId}`, body)
      .pipe(tap((c) => this._cart.set(c)));
  }

  remove(itemId: string): Observable<CartView> {
    return this.http.delete<CartView>(`${this.api.baseUrl}/cart/items/${itemId}`).pipe(tap((c) => this._cart.set(c)));
  }

  clear(storeId: string): Observable<CartView> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.delete<CartView>(`${this.api.baseUrl}/cart`, { params }).pipe(tap((c) => this._cart.set(c)));
  }
}
