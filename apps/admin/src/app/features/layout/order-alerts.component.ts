import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import { type OrderAlert, OrderAlertsService } from '../../core/kitchen/order-alerts.service';

/**
 * New-order pop-ups, bottom right of every cabinet page. Each one can be
 * accepted on the spot — the same accept the kitchen board runs, card
 * charge included — or opened on the board for the full ticket.
 */
@Component({
  selector: 'app-order-alerts',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="order-alerts" aria-live="assertive">
      @for (alert of alerts.alerts(); track alert.orderId) {
        <article class="order-alert" role="alert">
          <header class="flex items-center justify-between" style="gap: 8px">
            <span class="order-alert-kicker">{{ 'admin.kitchen.alerts.new' | translate }}</span>
            <button
              type="button"
              class="order-alert-close"
              (click)="alerts.dismiss(alert.orderId)"
              [attr.aria-label]="'common.close' | translate"
            >
              ×
            </button>
          </header>
          <div class="flex items-baseline" style="gap: 10px">
            <span class="order-alert-code">{{ alert.orderCode }}</span>
            <span class="order-alert-meta">
              {{ 'admin.kitchen.alerts.items' | translate: { count: alert.itemCount } }} ·
              {{ 'kds.card.due' | translate: { time: time(alert) } }}
            </span>
          </div>
          <span class="order-alert-store">{{ alert.storeName }}</span>
          @if (alert.error) {
            <p class="order-alert-error">{{ alert.error }}</p>
          }
          <div class="flex" style="gap: 8px">
            <button
              type="button"
              class="order-alert-accept"
              [disabled]="alert.busy"
              (click)="alerts.accept(alert.orderId)"
            >
              {{ (alert.busy ? 'admin.kitchen.working' : 'kds.card.actions.accept') | translate }}
            </button>
            <a
              class="order-alert-open"
              routerLink="/kitchen"
              [queryParams]="{ store: alert.storeId }"
              (click)="alerts.dismiss(alert.orderId)"
              >{{ 'admin.kitchen.alerts.open' | translate }}</a
            >
          </div>
        </article>
      }
    </div>
  `,
  styles: [
    `
      .order-alerts {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 40;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(340px, calc(100vw - 32px));
        font-family: var(--font-sans);
      }
      .order-alert {
        background: var(--color-foam);
        border: 1px solid var(--color-caramel);
        border-radius: 16px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
      }
      .order-alert-kicker {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: var(--color-caramel);
      }
      .order-alert-close {
        font-size: 20px;
        line-height: 1;
        color: var(--color-text-tertiary);
      }
      .order-alert-code {
        font-family: var(--font-mono);
        font-size: 26px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .order-alert-meta,
      .order-alert-store {
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .order-alert-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
      .order-alert-accept {
        flex: 1;
        height: 38px;
        border-radius: 10px;
        background: var(--color-caramel);
        color: white;
        font-size: 14px;
        font-weight: 700;
      }
      .order-alert-accept:disabled {
        opacity: 0.6;
      }
      .order-alert-open {
        height: 38px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
        border-radius: 10px;
        border: 1px solid var(--color-border-light);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        text-decoration: none;
      }
    `,
  ],
})
export class OrderAlertsComponent {
  readonly alerts = inject(OrderAlertsService);
  private readonly fmt = inject(LocaleFormatService);

  time(alert: OrderAlert): string {
    return this.fmt.time(alert.pickupAt, alert.timezone);
  }
}
