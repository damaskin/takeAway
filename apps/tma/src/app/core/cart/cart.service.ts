import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface CartItemView {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  variationIds: string[];
  modifiers: Record<string, number>;
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
}

export interface AddToCartInput {
  storeId: string;
  productId: string;
  quantity: number;
  variationIds?: string[];
  modifiers?: Record<string, number>;
  notes?: string;
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

  remove(itemId: string): Observable<CartView> {
    return this.http.delete<CartView>(`${this.api.baseUrl}/cart/items/${itemId}`).pipe(tap((c) => this._cart.set(c)));
  }

  clear(storeId: string): Observable<CartView> {
    const params = new HttpParams().set('storeId', storeId);
    return this.http.delete<CartView>(`${this.api.baseUrl}/cart`, { params }).pipe(tap((c) => this._cart.set(c)));
  }
}
