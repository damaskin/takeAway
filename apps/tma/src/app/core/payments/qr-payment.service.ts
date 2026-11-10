import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AgroprombankQrPaymentDto, AgroprombankQrStartRequest } from '@takeaway/shared-types';
import { type Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * Agroprombank «Мобильный платёж»: the customer pays the order's invoice by
 * QR in the bank's own app (docs/agroprombank-payments.md §12). Starting is
 * idempotent per order — a reload gets the same invoice back — and the QR
 * screen polls the status until the money lands.
 */
@Injectable({ providedIn: 'root' })
export class QrPaymentApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  /** The last answer per order, so the QR screen opened straight from checkout does not ask again. */
  private readonly latest = new Map<string, AgroprombankQrPaymentDto>();

  /** Issues the order's invoice, or answers the one already waiting (or the payment that settled it). */
  start(orderId: string): Observable<AgroprombankQrPaymentDto> {
    const body: AgroprombankQrStartRequest = { orderId };
    return this.http
      .post<AgroprombankQrPaymentDto>(`${this.api.baseUrl}/payments/agroprombank-qr/start`, body)
      .pipe(tap((payment) => this.latest.set(orderId, payment)));
  }

  status(paymentId: string): Observable<AgroprombankQrPaymentDto> {
    return this.http
      .get<AgroprombankQrPaymentDto>(`${this.api.baseUrl}/payments/agroprombank-qr/${encodeURIComponent(paymentId)}`)
      .pipe(tap((payment) => this.latest.set(payment.orderId, payment)));
  }

  /** The customer called the invoice off; the order stays, to be paid again or by card. */
  cancel(paymentId: string): Observable<AgroprombankQrPaymentDto> {
    return this.http
      .post<AgroprombankQrPaymentDto>(
        `${this.api.baseUrl}/payments/agroprombank-qr/${encodeURIComponent(paymentId)}/cancel`,
        {},
      )
      .pipe(tap((payment) => this.latest.set(payment.orderId, payment)));
  }

  /** The invoice this session last saw for the order, while it still waits to be paid; null otherwise. */
  issued(orderId: string, now = Date.now()): AgroprombankQrPaymentDto | null {
    const payment = this.latest.get(orderId);
    if (!payment || payment.status !== 'PENDING' || !payment.qr) return null;
    return Date.parse(payment.qr.expiresAt) > now ? payment : null;
  }
}
