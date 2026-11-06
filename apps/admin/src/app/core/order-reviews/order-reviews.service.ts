import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AdminOrderReviewPage, AdminOrderReviewQuery } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** `/admin/order-reviews` — customers' reviews of their orders, SUPER_ADMIN only. */
@Injectable({ providedIn: 'root' })
export class AdminOrderReviewsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(query: AdminOrderReviewQuery = {}): Observable<AdminOrderReviewPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<AdminOrderReviewPage>(`${this.api.baseUrl}/admin/order-reviews`, { params });
  }
}
