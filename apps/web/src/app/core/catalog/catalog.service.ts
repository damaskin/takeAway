import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ListStoresQuery, ProductDetail, StoreDetail, StoreListItem, StoreMenu } from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  listStores(query: ListStoresQuery = {}): Observable<StoreListItem[]> {
    let params = new HttpParams();
    if (typeof query.lat === 'number') params = params.set('lat', String(query.lat));
    if (typeof query.lng === 'number') params = params.set('lng', String(query.lng));
    if (typeof query.radius === 'number') params = params.set('radius', String(query.radius));
    return this.http.get<StoreListItem[]>(`${this.api.baseUrl}/stores`, { params });
  }

  getStore(idOrSlug: string): Observable<StoreDetail> {
    return this.http.get<StoreDetail>(`${this.api.baseUrl}/stores/${idOrSlug}`);
  }

  getMenu(storeIdOrSlug: string): Observable<StoreMenu> {
    return this.http.get<StoreMenu>(`${this.api.baseUrl}/stores/${storeIdOrSlug}/menu`);
  }

  getProduct(idOrSlug: string): Observable<ProductDetail> {
    return this.http.get<ProductDetail>(`${this.api.baseUrl}/products/${idOrSlug}`);
  }
}
