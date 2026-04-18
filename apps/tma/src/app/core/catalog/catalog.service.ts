import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ProductDetail, StoreDetail, StoreListItem, StoreMenu } from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  listStores(): Observable<StoreListItem[]> {
    return this.http.get<StoreListItem[]>(`${this.api.baseUrl}/stores`);
  }

  getStore(slug: string): Observable<StoreDetail> {
    return this.http.get<StoreDetail>(`${this.api.baseUrl}/stores/${slug}`);
  }

  getMenu(slug: string): Observable<StoreMenu> {
    return this.http.get<StoreMenu>(`${this.api.baseUrl}/stores/${slug}/menu`);
  }

  getProduct(slug: string): Observable<ProductDetail> {
    return this.http.get<ProductDetail>(`${this.api.baseUrl}/products/${slug}`);
  }
}
