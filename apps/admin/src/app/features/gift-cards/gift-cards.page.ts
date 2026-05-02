import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';

interface GiftCardRow {
  id: string;
  code: string;
  brandId: string;
  initialAmountCents: number;
  balanceCents: number;
  currency: string;
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  recipientEmail: string | null;
  recipientName: string | null;
  message: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'THB', 'IDR'] as const;

/**
 * Brand-admin gift card roster + manual issue. v1: codes are admin-issued
 * (no Stripe purchase flow). The customer types the code at checkout in
 * the same field as a promo code.
 */
@Component({
  selector: 'app-admin-gift-cards',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <section style="padding: 24px; max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px">
      <header style="display: flex; flex-direction: column; gap: 4px">
        <h1 style="font-family: var(--font-display); font-size: 24px; color: var(--color-espresso); margin: 0">
          {{ 'admin.giftCards.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
          {{ 'admin.giftCards.subtitle' | translate }}
        </p>
      </header>

      <!-- Issue form -->
      <form
        [formGroup]="form"
        (ngSubmit)="issue()"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 18px; display: grid; gap: 12px; grid-template-columns: repeat(4, 1fr)"
      >
        <label style="display: flex; flex-direction: column; gap: 4px">
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
            'admin.giftCards.amount' | translate
          }}</span>
          <input
            type="number"
            min="1"
            step="0.01"
            formControlName="amount"
            style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
          />
        </label>
        <label style="display: flex; flex-direction: column; gap: 4px">
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
            'admin.giftCards.currency' | translate
          }}</span>
          <select
            formControlName="currency"
            style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
          >
            @for (c of currencies; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </label>
        <label style="display: flex; flex-direction: column; gap: 4px; grid-column: span 2">
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
            'admin.giftCards.recipientEmail' | translate
          }}</span>
          <input
            type="email"
            formControlName="recipientEmail"
            style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
          />
        </label>
        <label style="display: flex; flex-direction: column; gap: 4px; grid-column: span 4">
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
            'admin.giftCards.message' | translate
          }}</span>
          <input
            type="text"
            maxlength="500"
            formControlName="message"
            style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
          />
        </label>
        <button
          type="submit"
          [disabled]="form.invalid || issuing()"
          style="grid-column: span 4; justify-self: end; height: 36px; padding: 0 18px; background: var(--color-caramel); color: white; border-radius: 8px; font-family: var(--font-sans); font-weight: 600"
        >
          {{ (issuing() ? 'common.loading' : 'admin.giftCards.issueCta') | translate }}
        </button>
        @if (lastIssued(); as just) {
          <p
            style="grid-column: span 4; font-family: var(--font-sans); font-size: 13px; color: var(--color-mint); margin: 0"
          >
            {{ 'admin.giftCards.issuedHint' | translate: { code: just.code } }}
          </p>
        }
        @if (error()) {
          <p
            style="grid-column: span 4; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
          >
            {{ error() }}
          </p>
        }
      </form>

      <!-- List -->
      <div
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; overflow: hidden"
      >
        <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans); font-size: 13px">
          <thead style="background: var(--color-cream)">
            <tr>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.giftCards.col.code' | translate }}</th>
              <th style="text-align: right; padding: 10px 14px">{{ 'admin.giftCards.col.balance' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.giftCards.col.status' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.giftCards.col.recipient' | translate }}</th>
              <th style="text-align: left; padding: 10px 14px">{{ 'admin.giftCards.col.created' | translate }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (card of rows(); track card.id) {
              <tr style="border-top: 1px solid var(--color-border-light)">
                <td style="padding: 10px 14px; font-family: var(--font-mono); font-weight: 600">{{ card.code }}</td>
                <td style="padding: 10px 14px; text-align: right">
                  {{ price(card.balanceCents, card.currency) }} / {{ price(card.initialAmountCents, card.currency) }}
                </td>
                <td style="padding: 10px 14px">
                  <span
                    style="padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600"
                    [style.background]="statusBg(card.status)"
                    [style.color]="statusColor(card.status)"
                    >{{ 'admin.giftCards.status.' + card.status | translate }}</span
                  >
                </td>
                <td style="padding: 10px 14px">{{ card.recipientName || card.recipientEmail || '—' }}</td>
                <td style="padding: 10px 14px; color: var(--color-text-secondary)">
                  {{ card.createdAt | slice: 0 : 10 }}
                </td>
                <td style="padding: 10px 14px; text-align: right">
                  @if (card.status === 'ACTIVE') {
                    <button
                      (click)="cancel(card)"
                      [disabled]="cancelling() === card.id"
                      style="background: transparent; color: var(--color-berry); font-weight: 600; padding: 4px 8px"
                    >
                      {{ 'admin.giftCards.cancel' | translate }}
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" style="padding: 24px; text-align: center; color: var(--color-text-secondary)">
                  {{ 'admin.giftCards.empty' | translate }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class AdminGiftCardsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);

  readonly currencies = CURRENCIES;
  readonly rows = signal<GiftCardRow[]>([]);
  readonly issuing = signal(false);
  readonly cancelling = signal<string | null>(null);
  readonly lastIssued = signal<GiftCardRow | null>(null);
  readonly error = signal<string | null>(null);

  readonly currencyHint = computed(() => this.form.controls.currency.value);

  readonly form = new FormGroup({
    amount: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0.01)] }),
    currency: new FormControl<(typeof CURRENCIES)[number]>('USD', { nonNullable: true }),
    recipientEmail: new FormControl<string>('', { nonNullable: true }),
    message: new FormControl<string>('', { nonNullable: true }),
  });

  constructor() {
    this.refresh();
  }

  issue(): void {
    const v = this.form.getRawValue();
    if (!v.amount) return;
    this.issuing.set(true);
    this.error.set(null);
    this.http
      .post<GiftCardRow>(`${this.api.baseUrl}/admin/gift-cards`, {
        amountCents: Math.round(v.amount * 100),
        currency: v.currency,
        recipientEmail: v.recipientEmail || undefined,
        message: v.message || undefined,
      })
      .subscribe({
        next: (row) => {
          this.issuing.set(false);
          this.lastIssued.set(row);
          this.rows.update((rs) => [row, ...rs]);
          this.form.controls.amount.reset();
          this.form.controls.recipientEmail.reset('');
          this.form.controls.message.reset('');
        },
        error: (err) => {
          this.issuing.set(false);
          this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
        },
      });
  }

  cancel(card: GiftCardRow): void {
    this.cancelling.set(card.id);
    this.http.delete<GiftCardRow>(`${this.api.baseUrl}/admin/gift-cards/${card.id}`).subscribe({
      next: (updated) => {
        this.cancelling.set(null);
        this.rows.update((rs) => rs.map((r) => (r.id === card.id ? updated : r)));
      },
      error: (err) => {
        this.cancelling.set(null);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }

  price(cents: number, currency: string): string {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  }

  statusBg(status: GiftCardRow['status']): string {
    if (status === 'ACTIVE') return 'rgba(76, 175, 80, 0.15)';
    if (status === 'REDEEMED') return 'rgba(120, 120, 120, 0.15)';
    if (status === 'EXPIRED') return 'rgba(255, 152, 0, 0.15)';
    return 'rgba(244, 67, 54, 0.15)';
  }

  statusColor(status: GiftCardRow['status']): string {
    if (status === 'ACTIVE') return 'var(--color-mint)';
    if (status === 'REDEEMED') return 'var(--color-text-secondary)';
    if (status === 'EXPIRED') return 'var(--color-amber)';
    return 'var(--color-berry)';
  }

  private refresh(): void {
    this.http.get<GiftCardRow[]>(`${this.api.baseUrl}/admin/gift-cards`).subscribe({
      next: (rs) => this.rows.set(rs),
      error: (err) => this.error.set(extractMessage(err)),
    });
  }
}

function extractMessage(err: unknown): string | null {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return null;
}
