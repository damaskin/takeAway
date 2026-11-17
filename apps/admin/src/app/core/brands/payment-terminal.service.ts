import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  PaymentTerminalCheckResult,
  PaymentTerminalStatus,
  PaymentTerminalView,
  UpsertPaymentTerminalRequest,
} from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * A brand's own Agroprombank terminal (docs/agroprombank-payments.md §13).
 * Everything but `status` is SUPER_ADMIN's; secrets are write-only.
 */
@Injectable({ providedIn: 'root' })
export class PaymentTerminalService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private url(brandId: string): string {
    return `${this.api.baseUrl}/admin/brands/${encodeURIComponent(brandId)}/payment-terminal`;
  }

  get(brandId: string): Observable<PaymentTerminalView> {
    return this.http.get<PaymentTerminalView>(this.url(brandId));
  }

  save(brandId: string, body: UpsertPaymentTerminalRequest): Observable<PaymentTerminalView> {
    return this.http.put<PaymentTerminalView>(this.url(brandId), body);
  }

  remove(brandId: string): Observable<PaymentTerminalView> {
    return this.http.delete<PaymentTerminalView>(this.url(brandId));
  }

  check(brandId: string): Observable<PaymentTerminalCheckResult> {
    return this.http.post<PaymentTerminalCheckResult>(`${this.url(brandId)}/check`, {});
  }

  /** Connected or not — what the brand's own roles may see. */
  status(brandId: string): Observable<PaymentTerminalStatus> {
    return this.http.get<PaymentTerminalStatus>(`${this.url(brandId)}/status`);
  }
}
