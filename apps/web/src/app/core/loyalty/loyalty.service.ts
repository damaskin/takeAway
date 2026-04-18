import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { LoyaltyAccount, Promo, ValidPromoResult } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

@Injectable({ providedIn: 'root' })
export class LoyaltyService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  me(): Observable<LoyaltyAccount> {
    return this.http.get<LoyaltyAccount>(`${this.api.baseUrl}/loyalty/me`);
  }
}

@Injectable({ providedIn: 'root' })
export class PromoService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  validate(code: string, brandId: string, subtotalCents: number): Observable<ValidPromoResult> {
    return this.http.post<ValidPromoResult>(`${this.api.baseUrl}/promo/validate`, {
      code,
      brandId,
      subtotalCents,
    });
  }

  list(brandId?: string): Observable<Promo[]> {
    const qs = brandId ? `?brandId=${encodeURIComponent(brandId)}` : '';
    return this.http.get<Promo[]>(`${this.api.baseUrl}/admin/promo${qs}`);
  }
}
