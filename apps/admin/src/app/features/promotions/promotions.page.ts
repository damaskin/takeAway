import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthStore } from '../../core/auth/auth.store';
import { type AdminRole, canAccess, navLink } from '../../core/permissions/permissions';
import { PlanAccess } from '../../core/plans/plan-access.service';

/**
 * «Акции» — promo codes and gift cards under one menu item, as tabs. Each
 * tab keeps its own route, role and plan: promo codes are PRO (a BASIC
 * brand gets the upgrade page inside the tab), gift cards are on every
 * plan. The old `/promo` and `/gift-cards` addresses redirect here.
 */
@Component({
  selector: 'app-promotions',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <section class="pr">
      <header class="pr-head">
        <h1>{{ 'admin.promotions.title' | translate }}</h1>
        <p>{{ 'admin.promotions.subtitle' | translate }}</p>
      </header>
      <nav class="pr-tabs" [attr.aria-label]="'admin.promotions.title' | translate">
        @if (canSeePromo()) {
          <a [routerLink]="promoLink" routerLinkActive="pr-tab-on" class="pr-tab">
            {{ 'admin.promotions.tabs.promo' | translate }}
            @if (!plans.has('promo')) {
              <span class="pr-tab-lock">{{ 'admin.plans.proBadge' | translate }}</span>
            }
          </a>
        }
        @if (canSeeGiftCards()) {
          <a [routerLink]="giftCardsLink" routerLinkActive="pr-tab-on" class="pr-tab">
            {{ 'admin.promotions.tabs.giftCards' | translate }}
          </a>
        }
      </nav>
    </section>
    <router-outlet />
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .pr {
        padding: clamp(16px, 4vw, 24px) clamp(16px, 4vw, 24px) 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--font-sans);
      }
      .pr-head h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .pr-head p {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .pr-tabs {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        border-bottom: 1px solid var(--color-border-light);
      }
      .pr-tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 10px 14px;
        border-bottom: 2px solid transparent;
        color: var(--color-text-secondary);
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        text-decoration: none;
      }
      .pr-tab-on {
        color: var(--color-caramel);
        border-bottom-color: var(--color-caramel);
      }
      .pr-tab-lock {
        padding: 1px 6px;
        border-radius: 9999px;
        border: 1px solid var(--color-border);
        color: var(--color-text-tertiary);
        font-size: 9px;
        letter-spacing: 0.5px;
      }
    `,
  ],
})
export class PromotionsPage {
  private readonly auth = inject(AuthStore);
  readonly plans = inject(PlanAccess);

  readonly promoLink = navLink('promo');
  readonly giftCardsLink = navLink('giftCards');

  private readonly role = computed(() => this.auth.user()?.role as AdminRole | undefined);
  readonly canSeePromo = computed(() => canAccess(this.role(), 'promo'));
  readonly canSeeGiftCards = computed(() => canAccess(this.role(), 'giftCards'));
}
