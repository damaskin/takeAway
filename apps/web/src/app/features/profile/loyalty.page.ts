import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { LoyaltyAccount } from '@takeaway/shared-types';

import { LoyaltyService } from '../../core/loyalty/loyalty.service';

const TIER_NAMES: Record<LoyaltyAccount['tier'], string> = {
  SILVER: 'Silver',
  GOLD: 'Gold',
  PLATINUM: 'Platinum',
  SIGNATURE: 'Signature',
};

@Component({
  selector: 'app-profile-loyalty',
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
          {{ 'web.profile.loyalty.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.profile.loyalty.subtitle' | translate }}
        </p>

        @if (account(); as a) {
          <div
            style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 20px; display: flex; flex-direction: column; gap: 14px; margin-bottom: 16px"
          >
            <div class="flex items-center justify-between">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                'web.profile.loyalty.balance' | translate
              }}</span>
              <span
                style="font-family: var(--font-sans); font-size: 11px; padding: 3px 10px; border-radius: 999px; background: var(--color-caramel-light); color: var(--color-caramel); font-weight: 700"
                >{{ tierName(a.tier) }}</span
              >
            </div>
            <div
              style="font-family: var(--font-display); font-size: 40px; font-weight: 700; color: var(--color-espresso)"
            >
              {{ a.pointsBalance }}
              <span
                style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); font-weight: 400"
              >
                {{ 'common.points' | translate }}
              </span>
            </div>

            @if (a.nextTier) {
              <div style="display: flex; flex-direction: column; gap: 6px">
                <div
                  class="flex items-center justify-between"
                  style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                >
                  <span>{{ 'web.profile.loyalty.toNextTier' | translate: { tier: tierName(a.nextTier) } }}</span>
                  <span>{{ a.pointsToNextTier }}</span>
                </div>
                <div style="height: 6px; background: var(--color-latte); border-radius: 999px; overflow: hidden">
                  <div
                    style="height: 100%; background: var(--color-caramel); border-radius: 999px"
                    [style.width.%]="a.tierProgressPercent"
                  ></div>
                </div>
              </div>
            } @else {
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-mint)">
                {{ 'web.profile.loyalty.topTier' | translate }}
              </span>
            }
          </div>

          <h2
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--color-text-tertiary); margin: 24px 0 12px"
          >
            {{ 'web.profile.loyalty.activity' | translate }}
          </h2>
          <div
            style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 8px"
          >
            @for (e of a.recent; track e.id) {
              <div
                class="flex items-start"
                style="padding: 12px 14px; gap: 12px; border-bottom: 1px solid var(--color-border-light)"
              >
                <div
                  style="width: 32px; height: 32px; border-radius: 999px; display: grid; place-items: center; flex-shrink: 0"
                  [style.background]="e.amount >= 0 ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.15)'"
                  [style.color]="e.amount >= 0 ? 'var(--color-mint)' : 'var(--color-berry)'"
                >
                  {{ e.amount >= 0 ? '+' : '' }}{{ e.amount }}
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 2px">
                  <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)">{{
                    e.reason
                  }}</span>
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                    formatDate(e.createdAt)
                  }}</span>
                </div>
              </div>
            } @empty {
              <p
                style="padding: 24px; text-align: center; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
              >
                {{ 'web.profile.loyalty.empty' | translate }}
              </p>
            }
          </div>
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
export class ProfileLoyaltyPage {
  private readonly loyalty = inject(LoyaltyService);

  readonly account = signal<LoyaltyAccount | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loyalty.me().subscribe({
      next: (a) => this.account.set(a),
      error: (err) => {
        const maybe = err as { error?: { message?: string }; message?: string };
        this.error.set(maybe.error?.message ?? maybe.message ?? 'Failed to load loyalty');
      },
    });
  }

  tierName(t: LoyaltyAccount['tier']): string {
    return TIER_NAMES[t] ?? t;
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
