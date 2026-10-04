import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AgroprombankWebStartRequest, AgroprombankWebStartResponse, PaymentPage } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * Agroprombank «Web-платёж»: the customer pays on the bank's own page. The
 * amount is held there and taken when the store accepts the order; the bank
 * then sends the customer back to the order page with `?payment=…`.
 */
@Injectable({ providedIn: 'root' })
export class WebPaymentApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly document = inject(DOCUMENT);

  /** Issues an invoice for the order; `page === null` means nothing is left to pay. */
  start(orderId: string): Observable<AgroprombankWebStartResponse> {
    const body: AgroprombankWebStartRequest = { orderId, returnTo: 'web' };
    return this.http.post<AgroprombankWebStartResponse>(`${this.api.baseUrl}/payments/agroprombank-web/start`, body);
  }

  /**
   * Leaves for the bank page: a real form POST of the signed fields, exactly
   * as issued, so the browser navigates away the way the bank expects.
   */
  redirectToBank(page: PaymentPage): void {
    const doc = this.document;
    const form = doc.createElement('form');
    form.method = page.method;
    form.action = page.action;
    form.style.display = 'none';
    for (const [name, value] of Object.entries(page.fields)) {
      const input = doc.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    doc.body.appendChild(form);
    form.submit();
  }
}
