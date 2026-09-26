import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  ListStoresQuery,
  PickupSlot,
  ProductDetail,
  StoreDetail,
  StoreListItem,
  StoreMenu,
} from '@takeaway/shared-types';
import { Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /**
   * The last copy of each store, menu and the plain store list fetched, by
   * slug and by id. A customer coming back from a product gets the menu
   * drawn at once — so the page can return to where they were — while a
   * fresh copy is fetched behind it.
   */
  private readonly storeCache = new Map<string, StoreDetail>();
  private readonly menuCache = new Map<string, StoreMenu>();
  private storeListCache: StoreListItem[] | null = null;

  cachedStore(idOrSlug: string): StoreDetail | null {
    return this.storeCache.get(idOrSlug) ?? null;
  }

  cachedMenu(idOrSlug: string): StoreMenu | null {
    return this.menuCache.get(idOrSlug) ?? null;
  }

  /** The list `listStores()` returned last time it was called without a location. */
  cachedStores(): StoreListItem[] | null {
    return this.storeListCache;
  }

  listStores(query: ListStoresQuery = {}): Observable<StoreListItem[]> {
    let params = new HttpParams();
    if (typeof query.lat === 'number') params = params.set('lat', String(query.lat));
    if (typeof query.lng === 'number') params = params.set('lng', String(query.lng));
    if (typeof query.radius === 'number') params = params.set('radius', String(query.radius));
    const plain = params.keys().length === 0;
    return this.http
      .get<StoreListItem[]>(`${this.api.baseUrl}/stores`, { params })
      .pipe(tap((list) => plain && (this.storeListCache = list)));
  }

  getStore(idOrSlug: string): Observable<StoreDetail> {
    return this.http.get<StoreDetail>(`${this.api.baseUrl}/stores/${idOrSlug}`).pipe(
      tap((store) => {
        this.storeCache.set(store.slug, store);
        this.storeCache.set(store.id, store);
      }),
    );
  }

  /**
   * Scheduled handover windows for the next twelve hours. Checkout offers
   * these instead of a free time field, so a customer can only pick a time
   * the kitchen can actually hit.
   */
  getPickupSlots(storeIdOrSlug: string): Observable<PickupSlot[]> {
    return this.http.get<PickupSlot[]>(`${this.api.baseUrl}/stores/${storeIdOrSlug}/pickup-slots`);
  }

  getMenu(storeIdOrSlug: string): Observable<StoreMenu> {
    return this.http.get<StoreMenu>(`${this.api.baseUrl}/stores/${storeIdOrSlug}/menu`).pipe(
      tap((menu) => {
        this.menuCache.set(menu.storeSlug, menu);
        this.menuCache.set(menu.storeId, menu);
      }),
    );
  }

  /** `store`: the store being browsed — product slugs are unique per brand only. */
  getProduct(idOrSlug: string, store?: string | null): Observable<ProductDetail> {
    const params = store ? { store } : undefined;
    return this.http.get<ProductDetail>(`${this.api.baseUrl}/products/${idOrSlug}`, { params });
  }
}
