import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';
import { extractMessage } from '../../core/http/extract-message';
import type { GiftCardRow } from './gift-card.types';

/**
 * Brand-admin gift card roster + manual issue. v1: codes are admin-issued
 * (no Stripe purchase flow). The customer types the code at checkout in
 * the same field as a promo code.
 */
@Component({
  selector: 'app-admin-gift-cards',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section style="padding: 24px; max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px">
      <header class="flex items-start justify-between flex-wrap" style="gap: 12px">
        <div style="display: flex; flex-direction: column; gap: 4px">
          <h1 style="font-family: var(--font-display); font-size: 24px; color: var(--color-espresso); margin: 0">
            {{ 'admin.giftCards.title' | translate }}
          </h1>
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.giftCards.subtitle' | translate }}
          </p>
        </div>
        <a
          routerLink="/gift-cards/new"
          class="flex items-center"
          style="height: 36px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap"
        >
          {{ 'admin.giftCards.issueCta' | translate }}
        </a>
      </header>

      <!-- List -->
      <div
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; overflow: hidden; overflow-x: auto"
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
                  {{ formatDate(card.createdAt) }}
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

      @if (error(); as message) {
        <p role="alert" style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0">
          {{ message }}
        </p>
      }
    </section>
  `,
})
export class AdminGiftCardsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly translate = inject(TranslateService);

  readonly rows = signal<GiftCardRow[]>([]);
  readonly cancelling = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    this.refresh();
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

  formatDate(iso: string): string {
    return iso.slice(0, 10);
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
