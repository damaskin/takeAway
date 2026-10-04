import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import {
  AnalyticsApi,
  type AnalyticsPeriod,
  type ChurnStats,
  type ChurnWindow,
  type WinBackStats,
} from '../../core/analytics/analytics.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

/**
 * The "Churn and win-back" tab (PRO): customers lost at the start of the
 * period and how many came back, against the period before, and the
 * customers lost during it, by name.
 */
@Component({
  selector: 'app-retention-tab',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="an-window" role="group" [attr.aria-label]="'admin.churn.windowLabel' | translate">
      <span class="dash-hint">{{ 'admin.churn.windowLabel' | translate }}</span>
      @for (w of windows; track w) {
        <button
          type="button"
          [class.an-window-on]="window() === w"
          [attr.aria-pressed]="window() === w"
          (click)="window.set(w)"
        >
          {{ 'admin.churn.window' | translate: { days: w } }}
        </button>
      }
    </div>

    <article class="dash-card">
      <header class="dash-card-head">
        <h2>{{ 'admin.analytics.winback.title' | translate }}</h2>
      </header>
      <p class="dash-hint">{{ 'admin.analytics.winback.hint' | translate: { days: window() } }}</p>
      @if (winBack(); as w) {
        <div class="an-tiles an-tiles-4">
          <div class="an-tile">
            <span>{{ 'admin.analytics.winback.lapsed' | translate }}</span>
            <strong>{{ w.current.lapsedAtStart }}</strong>
            <em>{{ 'admin.analytics.winback.before' | translate: { value: w.previous.lapsedAtStart } }}</em>
          </div>
          <div class="an-tile">
            <span>{{ 'admin.analytics.winback.returned' | translate }}</span>
            <strong>{{ w.current.returned }}</strong>
            <em [style.color]="deltaColor(w.returnedDeltaPercent)">{{
              'admin.analytics.winback.before' | translate: { value: w.previous.returned }
            }}</em>
          </div>
          <div class="an-tile">
            <span>{{ 'admin.analytics.winback.rate' | translate }}</span>
            <strong>{{ w.current.returnRatePercent === null ? '—' : fmt.percent(w.current.returnRatePercent) }}</strong>
            <em>{{
              'admin.analytics.winback.before'
                | translate
                  : {
                      value: w.previous.returnRatePercent === null ? '—' : fmt.percent(w.previous.returnRatePercent),
                    }
            }}</em>
          </div>
          <div class="an-tile">
            <span>{{ 'admin.analytics.winback.revenue' | translate }}</span>
            <strong>{{ price(w.current.revenueCents) }}</strong>
            <em [style.color]="deltaColor(w.revenueDeltaPercent)">{{
              'admin.analytics.winback.before' | translate: { value: price(w.previous.revenueCents) }
            }}</em>
          </div>
        </div>
        @if (w.customers.length > 0) {
          <h3 class="an-sub">{{ 'admin.analytics.winback.whoCame' | translate }}</h3>
          <ul class="an-people">
            @for (c of w.customers; track c.userId) {
              <li>
                <a [routerLink]="['/customers', c.userId]">{{
                  c.name || c.phone || ('admin.customers.noName' | translate)
                }}</a>
                <span>{{
                  'admin.analytics.winback.person'
                    | translate: { days: c.daysAway, orders: c.orders, amount: price(c.revenueCents) }
                }}</span>
              </li>
            }
          </ul>
        }
      }
    </article>

    <article class="dash-card">
      <header class="dash-card-head">
        <h2>{{ 'admin.churn.title' | translate }}</h2>
        @if (churn(); as c) {
          <span class="an-row-note">{{
            'admin.analytics.churnSummary' | translate: { count: c.count, amount: price(c.lostRevenueCents) }
          }}</span>
        }
      </header>
      <p class="dash-hint">{{ 'admin.churn.hint' | translate: { days: window() } }}</p>
      @if (churn()?.customers; as lost) {
        @if (lost.length === 0) {
          <p class="dash-muted">{{ 'admin.churn.none' | translate }}</p>
        } @else {
          <div class="an-table-wrap">
            <table class="an-table">
              <thead>
                <tr>
                  <th>{{ 'admin.customers.cols.customer' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.orders' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.avgCheck' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.total' | translate }}</th>
                  <th class="num">{{ 'admin.customers.cols.lastOrder' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (c of lost; track c.userId) {
                  <tr>
                    <td>
                      <a class="an-row-name" [routerLink]="['/customers', c.userId]">{{
                        c.name || c.phone || ('admin.customers.noName' | translate)
                      }}</a>
                    </td>
                    <td class="num">{{ c.orders }}</td>
                    <td class="num">{{ price(c.avgCheckCents) }}</td>
                    <td class="num">{{ price(c.totalCents) }}</td>
                    <td class="num">{{ 'admin.churn.daysAgo' | translate: { days: c.daysSinceLastOrder } }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </article>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 20px;
        font-family: var(--font-sans);
      }
      .an-window {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .an-window button {
        height: 30px;
        padding: 0 12px;
        border-radius: 9999px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .an-window .an-window-on {
        background: var(--color-espresso);
        border-color: transparent;
        color: white;
      }
      .an-sub {
        margin: 4px 0 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .an-people {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 13px;
      }
      .an-people li {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 4px 12px;
      }
      .an-people a {
        color: var(--color-text-primary);
        font-weight: 500;
      }
      .an-people span {
        color: var(--color-text-tertiary);
      }
      .an-tiles-4 {
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }
    `,
  ],
})
export class RetentionTabComponent {
  private readonly api = inject(AnalyticsApi);
  protected readonly fmt = inject(LocaleFormatService);

  readonly brandId = input.required<string>();
  readonly period = input.required<AnalyticsPeriod>();
  readonly currency = input<string | null | undefined>(null);

  readonly windows: readonly ChurnWindow[] = [7, 14];
  readonly window = signal<ChurnWindow>(14);
  readonly winBack = signal<WinBackStats | null>(null);
  readonly churn = signal<ChurnStats | null>(null);

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      const period = this.period();
      const window = this.window();
      untracked(() => {
        this.api.winBack(brandId, period, window, 20).subscribe({ next: (w) => this.winBack.set(w) });
        this.api.churn(brandId, period, window, 50).subscribe({ next: (c) => this.churn.set(c) });
      });
    });
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.currency(), { round: true });
  }

  deltaColor(value: number | null): string {
    if (value === null || value === 0) return 'var(--color-text-tertiary)';
    return value > 0 ? '#3E8868' : 'var(--color-berry)';
  }
}
