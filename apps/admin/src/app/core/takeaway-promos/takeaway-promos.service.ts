import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateTakeawayPromoInput,
  TakeawayDebtReport,
  TakeawayPromo,
  TakeawayPromoReport,
  UpdateTakeawayPromoInput,
  UpdateTakeawayPromoStatusInput,
} from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * `/admin/takeaway-promos` — «Акции takeAway», the platform's own percent
 * promos that takeAway pays for (docs/takeaway-promos.md §4.1). SUPER_ADMIN
 * only; the brand's side of them is on the settlements page.
 */
@Injectable({ providedIn: 'root' })
export class TakeawayPromosApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private get base(): string {
    return `${this.api.baseUrl}/admin/takeaway-promos`;
  }

  /** Newest first. */
  list(): Observable<TakeawayPromo[]> {
    return this.http.get<TakeawayPromo[]>(this.base);
  }

  get(id: string): Observable<TakeawayPromo> {
    return this.http.get<TakeawayPromo>(`${this.base}/${encodeURIComponent(id)}`);
  }

  create(input: CreateTakeawayPromoInput): Observable<TakeawayPromo> {
    return this.http.post<TakeawayPromo>(this.base, input);
  }

  /** Every field before the first order; after it only name, end and budget. */
  update(id: string, input: UpdateTakeawayPromoInput): Observable<TakeawayPromo> {
    return this.http.patch<TakeawayPromo>(`${this.base}/${encodeURIComponent(id)}`, input);
  }

  /** Switch off, or back on (an exhausted promo only once its budget has room). */
  setStatus(id: string, status: UpdateTakeawayPromoStatusInput['status']): Observable<TakeawayPromo> {
    const body: UpdateTakeawayPromoStatusInput = { status };
    return this.http.patch<TakeawayPromo>(`${this.base}/${encodeURIComponent(id)}/status`, body);
  }

  report(id: string): Observable<TakeawayPromoReport> {
    return this.http.get<TakeawayPromoReport>(`${this.base}/${encodeURIComponent(id)}/report`);
  }

  /** takeAway's debt to every brand, now. */
  debt(): Observable<TakeawayDebtReport> {
    return this.http.get<TakeawayDebtReport>(`${this.base}/debt`);
  }
}
