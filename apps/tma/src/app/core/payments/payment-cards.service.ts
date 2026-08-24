import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface CardInstitute {
  code: string;
  name: string;
}

export interface BoundCard {
  id: string;
  maskedPan: string | null;
  embossing: string | null;
  institute: string | null;
  instituteName: string | null;
  label: string | null;
  isDefault: boolean;
  cardState: number | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface StartBindingResponse {
  bindingId: string;
  /** True for prepaid cards, where the bank skips the one-time password. */
  completed: boolean;
  card: BoundCard | null;
  expiresAt: string;
}

export interface ChargeResponse {
  paymentId: string;
  status: 'PENDING' | 'REQUIRES_ACTION' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  operationId: string | null;
  invoiceId: string;
  amountCents: number;
  tipCents: number;
  compositeStatus: number | null;
  authCode: string | null;
  rrn: string | null;
}

export interface StartBindingInput {
  lastDigits: string;
  phone: string;
  institute: string;
  fio?: string;
  deactivateOld?: boolean;
  label?: string;
}

/**
 * Agroprombank («Клевер») card binding and one-tap payment.
 *
 * Card details never reach our servers: the customer types the last four
 * digits and a phone number, the bank SMSes a one-time password, and what we
 * store afterwards is an opaque token.
 */
@Injectable({ providedIn: 'root' })
export class PaymentCardsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private get base(): string {
    return `${this.api.baseUrl}/payments/agroprombank`;
  }

  institutes(): Observable<CardInstitute[]> {
    return this.http.get<CardInstitute[]>(`${this.base}/institutes`);
  }

  list(): Observable<BoundCard[]> {
    return this.http.get<BoundCard[]>(`${this.base}/cards`);
  }

  startBinding(input: StartBindingInput): Observable<StartBindingResponse> {
    return this.http.post<StartBindingResponse>(`${this.base}/cards/bind`, input);
  }

  confirmBinding(bindingId: string, code: string): Observable<BoundCard> {
    return this.http.post<BoundCard>(`${this.base}/cards/bind/${bindingId}/confirm`, { code });
  }

  setDefault(cardId: string): Observable<BoundCard> {
    return this.http.post<BoundCard>(`${this.base}/cards/${cardId}/default`, {});
  }

  refresh(cardId: string): Observable<BoundCard> {
    return this.http.post<BoundCard>(`${this.base}/cards/${cardId}/refresh`, {});
  }

  remove(cardId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/cards/${cardId}`);
  }

  pay(input: { orderId: string; cardId: string; tipCents?: number }): Observable<ChargeResponse> {
    return this.http.post<ChargeResponse>(`${this.base}/pay`, input);
  }
}

/**
 * Cached card list shared by checkout and the cards screen, so opening
 * checkout doesn't re-fetch what the profile just loaded.
 */
@Injectable({ providedIn: 'root' })
export class PaymentCardsStore {
  private readonly api = inject(PaymentCardsApi);
  private cards: BoundCard[] | null = null;

  /** Cached list; pass `force` after binding or removing a card. */
  load(force = false): Observable<BoundCard[]> {
    if (!force && this.cards) return of(this.cards);
    return this.api.list().pipe(tap((cards) => (this.cards = cards)));
  }

  invalidate(): void {
    this.cards = null;
  }
}
