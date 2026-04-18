import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CreatePromoInput, Promo, PromoStatus } from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

@Injectable({ providedIn: 'root' })
export class AdminPromoApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(brandId?: string): Observable<Promo[]> {
    const qs = brandId ? `?brandId=${encodeURIComponent(brandId)}` : '';
    return this.http.get<Promo[]>(`${this.api.baseUrl}/admin/promo${qs}`);
  }

  create(input: CreatePromoInput): Observable<Promo> {
    return this.http.post<Promo>(`${this.api.baseUrl}/admin/promo`, input);
  }

  updateStatus(id: string, status: PromoStatus): Observable<Promo> {
    return this.http.patch<Promo>(`${this.api.baseUrl}/admin/promo/${id}/status`, { status });
  }
}
