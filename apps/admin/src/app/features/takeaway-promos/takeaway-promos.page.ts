import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { navLink } from '../../core/permissions/permissions';

/**
 * «Акции takeAway» — the platform admin's own percent promos (takeAway pays
 * the discount) and what takeAway owes the brands for them, as two tabs.
 * The form and the report of one promo stand on their own routes.
 * Rules and screens: docs/takeaway-promos.md.
 */
@Component({
  selector: 'app-takeaway-promos',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <section class="tp">
      <header class="tp-head">
        <h1>{{ 'admin.takeawayPromos.title' | translate }}</h1>
        <p>{{ 'admin.takeawayPromos.subtitle' | translate }}</p>
      </header>
      <nav class="tp-tabs" [attr.aria-label]="'admin.takeawayPromos.title' | translate">
        <a
          [routerLink]="listLink"
          routerLinkActive="tp-tab-on"
          [routerLinkActiveOptions]="{ exact: true }"
          class="tp-tab"
        >
          {{ 'admin.takeawayPromos.tabs.list' | translate }}
        </a>
        <a [routerLink]="debtLink" routerLinkActive="tp-tab-on" class="tp-tab">
          {{ 'admin.takeawayPromos.tabs.debt' | translate }}
        </a>
      </nav>
    </section>
    <router-outlet />
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .tp {
        padding: clamp(16px, 4vw, 24px) clamp(16px, 4vw, 24px) 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--font-sans);
      }
      .tp-head h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .tp-head p {
        margin: 4px 0 0;
        max-width: 760px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .tp-tabs {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        border-bottom: 1px solid var(--color-border-light);
      }
      .tp-tab {
        display: inline-flex;
        align-items: center;
        padding: 10px 14px;
        border-bottom: 2px solid transparent;
        color: var(--color-text-secondary);
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        text-decoration: none;
      }
      .tp-tab-on {
        color: var(--color-caramel);
        border-bottom-color: var(--color-caramel);
      }
    `,
  ],
})
export class TakeawayPromosPage {
  readonly listLink = navLink('takeawayPromos');
  readonly debtLink = `${navLink('takeawayPromos')}/debt`;
}
