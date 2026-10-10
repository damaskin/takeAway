import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CommissionRateHistory, SettlementPayout, SettlementReport } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface SettlementQuery {
  /** Required for a platform admin; a brand owner gets their own. */
  brandId?: string | null;
  currency?: string | null;
  /** Local days of the brand, both included. */
  from: string;
  to: string;
}

export interface SetCommissionRateRequest {
  brandId: string;
  /** Basis points; null goes back to the plan's rate. */
  bps: number | null;
  /** First day, in the brand's time zone. */
  effectiveFrom: string;
  note?: string;
}

export interface CreatePayoutRequest {
  brandId: string;
  currency: string;
  /** Last day the payout settles. */
  to: string;
  reference?: string;
  comment?: string;
}

/** `/admin/settlements` — «Расчёты с брендами». Writes are SUPER_ADMIN only. */
@Injectable({ providedIn: 'root' })
export class SettlementsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private get base(): string {
    return `${this.api.baseUrl}/admin/settlements`;
  }

  report(query: SettlementQuery): Observable<SettlementReport> {
    let params = new HttpParams().set('from', query.from).set('to', query.to);
    if (query.brandId) params = params.set('brandId', query.brandId);
    if (query.currency) params = params.set('currency', query.currency);
    return this.http.get<SettlementReport>(this.base, { params });
  }

  rates(brandId: string | null): Observable<CommissionRateHistory> {
    const params = brandId ? new HttpParams().set('brandId', brandId) : undefined;
    return this.http.get<CommissionRateHistory>(`${this.base}/rates`, { params });
  }

  setRate(body: SetCommissionRateRequest): Observable<CommissionRateHistory> {
    return this.http.post<CommissionRateHistory>(`${this.base}/rates`, body);
  }

  deleteRate(id: string): Observable<CommissionRateHistory> {
    return this.http.delete<CommissionRateHistory>(`${this.base}/rates/${encodeURIComponent(id)}`);
  }

  createPayout(body: CreatePayoutRequest): Observable<SettlementPayout> {
    return this.http.post<SettlementPayout>(`${this.base}/payouts`, body);
  }

  markPaid(id: string, body: { reference?: string; comment?: string }): Observable<SettlementPayout> {
    return this.http.patch<SettlementPayout>(`${this.base}/payouts/${encodeURIComponent(id)}/paid`, body);
  }

  deletePayout(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/payouts/${encodeURIComponent(id)}`);
  }
}
