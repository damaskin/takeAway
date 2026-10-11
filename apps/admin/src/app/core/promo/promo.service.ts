import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CreatePromoInput, Promo, PromoStatus, UpdatePromoInput } from '@takeaway/shared-types';
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

  get(id: string): Observable<Promo> {
    return this.http.get<Promo>(`${this.api.baseUrl}/admin/promo/${encodeURIComponent(id)}`);
  }

  create(input: CreatePromoInput): Observable<Promo> {
    return this.http.post<Promo>(`${this.api.baseUrl}/admin/promo`, input);
  }

  /** Every field of a draft, or of a scheduled or paused promo nobody used. */
  update(id: string, input: UpdatePromoInput): Observable<Promo> {
    return this.http.patch<Promo>(`${this.api.baseUrl}/admin/promo/${encodeURIComponent(id)}`, input);
  }

  /** Draft → active (RUNNING) → paused → ended (EXPIRED). */
  updateStatus(id: string, status: PromoStatus): Observable<Promo> {
    return this.http.patch<Promo>(`${this.api.baseUrl}/admin/promo/${encodeURIComponent(id)}/status`, { status });
  }
}
