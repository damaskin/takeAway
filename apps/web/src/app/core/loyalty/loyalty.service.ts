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

  /**
   * How many points can go toward this order, and what they are worth.
   * The server clamps the ask to the balance and to the order value, and
   * clamps it again when the order is created — checkout renders what the
   * quote says rather than doing the arithmetic itself.
   */
  quoteRedemption(points: number, payableCents: number): Observable<RedeemQuote> {
    return this.http.post<RedeemQuote>(`${this.api.baseUrl}/loyalty/redeem/quote`, { points, payableCents });
  }
}

export interface RedeemQuote {
  points: number;
  discountCents: number;
  balance: number;
  pointValueCents: number;
  minPoints: number;
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
