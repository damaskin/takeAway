import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import type { OrderStatusStats } from '../core/analytics/analytics.service';
import { FeatureFlagsStore } from '../core/config/feature-flags.store';

/**
 * "Orders by status": the open orders right now, and how the period's
 * orders ended up. Shared by a brand's dashboard and the platform view.
 */
@Component({
  selector: 'app-order-status-panel',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <article class="dash-statuses" [attr.aria-label]="'admin.dashboard.statuses.title' | translate">
      <header class="flex items-center justify-between">
        <h2 class="dash-h2">{{ 'admin.dashboard.statuses.title' | translate }}</h2>
        @if (kitchenLink()) {
          <a routerLink="/kitchen" class="dash-link">{{ 'admin.dashboard.statuses.toKitchen' | translate }}</a>
        }
      </header>
      <div class="dash-status-row">
        <span class="dash-status-caption">{{ 'admin.dashboard.statuses.now' | translate }}</span>
        @for (tile of liveTiles(); track tile.label) {
          <div class="dash-status-tile" [class.dash-status-hot]="tile.hot">
            <span class="dash-status-value">{{ tile.value }}</span>
            <span class="dash-status-label">{{ tile.label | translate }}</span>
          </div>
        }
      </div>
      <div class="dash-status-row">
        <span class="dash-status-caption">{{
          'admin.dashboard.statuses.period' | translate: { days: stats()?.days ?? days() }
        }}</span>
        @for (tile of periodTiles(); track tile.label) {
          <div class="dash-status-tile">
            <span class="dash-status-value">{{ tile.value }}</span>
            <span class="dash-status-label">{{ tile.label | translate }}</span>
          </div>
        }
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .dash-statuses {
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 20px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .dash-h2 {
        font-family: var(--font-display);
        font-size: 18px;
        font-weight: 700;
        color: var(--color-espresso);
        margin: 0;
      }
      .dash-link {
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 500;
        color: var(--color-caramel);
      }
      .dash-status-row {
        display: grid;
        grid-template-columns: 120px repeat(auto-fit, minmax(110px, 1fr));
        gap: 10px;
      }
      .dash-status-caption {
        align-self: center;
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .dash-status-tile {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--color-surface-variant);
      }
      .dash-status-hot {
        background: var(--color-caramel-light);
        box-shadow: inset 0 0 0 1px var(--color-caramel);
      }
      .dash-status-hot .dash-status-value {
        color: var(--color-caramel);
      }
      .dash-status-value {
        font-family: var(--font-display);
        font-size: 22px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .dash-status-label {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      @media (max-width: 768px) {
        .dash-status-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .dash-status-caption {
          grid-column: 1 / -1;
        }
      }
    `,
  ],
})
export class OrderStatusPanelComponent {
  private readonly fmt = inject(LocaleFormatService);
  private readonly flags = inject(FeatureFlagsStore);

  readonly stats = input<OrderStatusStats | null>(null);
  /** The period picked on the page, shown until the numbers arrive. */
  readonly days = input(7);
  readonly kitchenLink = input(false);

  readonly liveTiles = computed(() => {
    const live = this.stats()?.live;
    const n = (v: number | undefined) => String(v ?? 0);
    return [
      { label: 'admin.dashboard.statuses.waiting', value: n((live?.CREATED ?? 0) + (live?.PAID ?? 0)), hot: true },
      { label: 'admin.orders.status.ACCEPTED', value: n(live?.ACCEPTED), hot: false },
      { label: 'admin.orders.status.IN_PROGRESS', value: n(live?.IN_PROGRESS), hot: false },
      { label: 'admin.orders.status.READY', value: n(live?.READY), hot: false },
      ...(this.flags.deliveryEnabled()
        ? [{ label: 'admin.orders.status.OUT_FOR_DELIVERY', value: n(live?.OUT_FOR_DELIVERY), hot: false }]
        : []),
    ];
  });

  readonly periodTiles = computed(() => {
    const p = this.stats()?.period;
    return [
      { label: 'admin.dashboard.statuses.total', value: String(p?.total ?? 0) },
      { label: 'admin.dashboard.statuses.completed', value: String(p?.completed ?? 0) },
      { label: 'admin.dashboard.statuses.cancelled', value: String(p?.cancelled ?? 0) },
      { label: 'admin.dashboard.statuses.expired', value: String(p?.expired ?? 0) },
      {
        label: 'admin.dashboard.statuses.completionRate',
        value: p?.completionRatePercent == null ? '—' : this.fmt.percent(p.completionRatePercent),
      },
    ];
  });
}
