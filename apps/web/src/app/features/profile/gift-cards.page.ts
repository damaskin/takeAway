import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';

interface GiftRedemption {
  orderId: string;
  orderCode: string;
  code: string;
  amountCents: number;
  currency: string;
  brandName: string;
  createdAt: string;
}

@Component({
  selector: 'app-profile-gift-cards',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 32px 16px">
      <div style="max-width: 540px; margin: 0 auto">
        <a
          routerLink="/profile"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-decoration: none"
          >← {{ 'common.back' | translate }}</a
        >
        <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 12px 0 8px">
          {{ 'web.profile.giftCards.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.profile.giftCards.subtitle' | translate }}
        </p>

        @if (rows(); as list) {
          @if (list.length === 0) {
            <div
              style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 24px; text-align: center; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
            >
              {{ 'web.profile.giftCards.empty' | translate }}
            </div>
          } @else {
            <div
              style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 8px"
            >
              @for (r of list; track r.orderId) {
                <a
                  [routerLink]="['/orders', r.orderId]"
                  class="flex items-center"
                  style="padding: 12px 14px; gap: 12px; border-bottom: 1px solid var(--color-border-light); text-decoration: none; color: inherit"
                >
                  <span style="font-size: 22px">🎁</span>
                  <div style="flex: 1; display: flex; flex-direction: column; gap: 2px">
                    <span
                      style="font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
                      >{{ r.code }}</span
                    >
                    <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                      >{{ r.brandName }} · #{{ r.orderCode }}</span
                    >
                  </div>
                  <span
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 700; color: var(--color-mint)"
                    >− {{ price(r.amountCents, r.currency) }}</span
                  >
                </a>
              }
            </div>
          }
        } @else if (error()) {
          <p style="font-family: var(--font-sans); color: var(--color-berry)">{{ error() }}</p>
        } @else {
          <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
            {{ 'common.loading' | translate }}
          </p>
        }
      </div>
    </section>
  `,
})
export class ProfileGiftCardsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  readonly rows = signal<GiftRedemption[] | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    this.http.get<GiftRedemption[]>(`${this.api.baseUrl}/me/gift-cards`).subscribe({
      next: (list) => this.rows.set(list),
      error: (err) => {
        const maybe = err as { error?: { message?: string }; message?: string };
        this.error.set(maybe.error?.message ?? maybe.message ?? 'Failed to load gift cards');
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
}
