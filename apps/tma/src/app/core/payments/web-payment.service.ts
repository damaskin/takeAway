import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AgroprombankWebStartRequest, AgroprombankWebStartResponse } from '@takeaway/shared-types';
import { type Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** A bank page issued in this session, kept so it can be opened again in one tap. */
interface IssuedPage {
  url: string;
  /** Epoch ms after which the bank stops taking the invoice; null when unknown. */
  expiresAt: number | null;
}

/**
 * Agroprombank «Web-платёж»: the customer pays on the bank's own page, opened
 * outside the Mini App. The amount is held there and taken when the store
 * accepts the order; the bank then sends the customer back to the bot, which
 * reopens the order (`start_param = order_<id>`).
 */
@Injectable({ providedIn: 'root' })
export class WebPaymentApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly issued = new Map<string, IssuedPage>();

  /** Issues an invoice for the order; `page === null` means nothing is left to pay. */
  start(orderId: string): Observable<AgroprombankWebStartResponse> {
    const body: AgroprombankWebStartRequest = { orderId, returnTo: 'tma' };
    return this.http
      .post<AgroprombankWebStartResponse>(`${this.api.baseUrl}/payments/agroprombank-web/start`, body)
      .pipe(
        tap((res) => {
          if (!res.page) {
            this.issued.delete(orderId);
            return;
          }
          const expiresAt = res.expiresAt ? Date.parse(res.expiresAt) : NaN;
          this.issued.set(orderId, { url: res.page.url, expiresAt: Number.isNaN(expiresAt) ? null : expiresAt });
        }),
      );
  }

  /**
   * The bank page already issued for this order, while it still takes
   * payments. Telegram opens outside links only straight from a tap, so the
   * order screen opens this one synchronously rather than after a request.
   */
  issuedPageUrl(orderId: string): string | null {
    const page = this.issued.get(orderId);
    if (!page) return null;
    if (page.expiresAt !== null && page.expiresAt <= Date.now()) {
      this.issued.delete(orderId);
      return null;
    }
    return page.url;
  }

  /** The issued page is spent: the payment failed, or it went through. */
  forget(orderId: string): void {
    this.issued.delete(orderId);
  }
}
