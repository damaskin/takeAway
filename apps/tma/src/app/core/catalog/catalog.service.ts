import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  ListStoresQuery,
  PickupSlot,
  ProductDetail,
  StoreDetail,
  StoreListItem,
  StoreMenu,
  StoreSuggestions,
} from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /** With the customer's position, each store comes with its distance and the nearest come first. */
  listStores(query: ListStoresQuery = {}): Observable<StoreListItem[]> {
    let params = new HttpParams();
    if (typeof query.lat === 'number') params = params.set('lat', String(query.lat));
    if (typeof query.lng === 'number') params = params.set('lng', String(query.lng));
    if (typeof query.radius === 'number') params = params.set('radius', String(query.radius));
    return this.http.get<StoreListItem[]>(`${this.api.baseUrl}/stores`, { params });
  }

  getStore(slug: string): Observable<StoreDetail> {
    return this.http.get<StoreDetail>(`${this.api.baseUrl}/stores/${slug}`);
  }

  /**
   * Scheduled handover windows for the next 24 hours. Checkout offers these
   * instead of a free time field, so a customer can only pick a time the
   * kitchen can actually hit. With `cartId` a window too busy for that
   * cart's work comes back unavailable.
   */
  getPickupSlots(storeIdOrSlug: string, cartId?: string | null): Observable<PickupSlot[]> {
    const params = cartId ? { cartId } : undefined;
    return this.http.get<PickupSlot[]>(`${this.api.baseUrl}/stores/${storeIdOrSlug}/pickup-slots`, { params });
  }

  getMenu(slug: string): Observable<StoreMenu> {
    return this.http.get<StoreMenu>(`${this.api.baseUrl}/stores/${slug}/menu`);
  }

  /**
   * What to offer next to [productIds]: what customers bought together with
   * them (`source: copurchase`), else the menu rule. Only in-stock products
   * of this store's menu.
   */
  getSuggestions(storeIdOrSlug: string, productIds: readonly string[], limit = 6): Observable<StoreSuggestions> {
    return this.http.get<StoreSuggestions>(`${this.api.baseUrl}/stores/${storeIdOrSlug}/suggestions`, {
      params: { productIds: productIds.join(','), limit },
    });
  }

  /** `store`: the store being browsed — product slugs are unique per brand only. */
  getProduct(slug: string, store?: string | null): Observable<ProductDetail> {
    const params = store ? { store } : undefined;
    return this.http.get<ProductDetail>(`${this.api.baseUrl}/products/${slug}`, { params });
  }
}
