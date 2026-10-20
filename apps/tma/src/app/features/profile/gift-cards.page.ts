import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { ProfileApi, type GiftRedemption } from '../../core/profile/profile.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

/**
 * «Подарочные карты» in the Mini App — the website's `/profile/gift-cards`
 * (`GET /me/gift-cards`): the cards the customer applied to their orders,
 * each leading to its order. Telegram's back button returns to the profile.
 */
@Component({
  selector: 'app-tma-gift-cards',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section
      style="padding: 16px; padding-bottom: var(--tma-page-bottom); display: flex; flex-direction: column; gap: 16px"
    >
      <div class="flex flex-col" style="gap: 4px">
        <h1
          style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'web.profile.giftCards.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'web.profile.giftCards.subtitle' | translate }}
        </p>
      </div>

      @if (rows(); as list) {
        @if (list.length === 0) {
          <p
            data-testid="gift-cards-empty"
            style="margin: 0; padding: 24px 16px; text-align: center; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
          >
            {{ 'web.profile.giftCards.empty' | translate }}
          </p>
        } @else {
          <div
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; overflow: hidden"
          >
            @for (r of list; track r.orderId + r.code; let last = $last) {
              <a
                [routerLink]="['/orders', r.orderId]"
                data-testid="gift-card"
                class="flex items-center"
                [style.borderBottom]="last ? 'none' : '1px solid var(--color-border-light)'"
                style="padding: 12px 16px; gap: 12px; color: inherit; text-decoration: none"
              >
                <span aria-hidden="true" style="font-size: 22px">🎁</span>
                <span class="flex flex-col flex-1" style="gap: 2px; min-width: 0">
                  <span
                    style="font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
                    >{{ r.code }}</span
                  >
                  <span
                    class="truncate"
                    style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                    >{{ r.brandName }} · #{{ r.orderCode }}</span
                  >
                </span>
                <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 700; color: var(--color-mint)"
                  >− {{ price(r.amountCents, r.currency) }}</span
                >
              </a>
            }
          </div>
        }
      } @else if (error()) {
        <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-berry)">
          {{ error() }}
        </p>
      } @else {
        <p style="margin: 0; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      }
    </section>
  `,
})
export class TmaGiftCardsPage implements OnInit, OnDestroy {
  private readonly api = inject(ProfileApi);
  private readonly authStore = inject(TmaAuthStore);
  private readonly tg = inject(TelegramBridgeService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly rows = signal<GiftRedemption[] | null>(null);
  readonly error = signal<string | null>(null);

  private detachBack: (() => void) | null = null;

  ngOnInit(): void {
    this.detachBack = this.tg.setBackButton(() => void this.router.navigate(['/profile']));
    if (!this.authStore.isAuthenticated()) {
      this.error.set(this.translate.instant('tma.orders.offlineTitle'));
      return;
    }
    this.api.giftCards().subscribe({
      next: (list) => this.rows.set(list),
      error: () => this.error.set(this.translate.instant('web.profile.giftCards.loadFailed')),
    });
  }

  ngOnDestroy(): void {
    this.detachBack?.();
  }

  price(cents: number, currency: string): string {
    return this.fmt.money(cents, currency);
  }
}
