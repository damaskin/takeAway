import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import {
  AnalyticsApi,
  type AnalyticsPeriod,
  type ChurnStats,
  type ChurnWindow,
} from '../../core/analytics/analytics.service';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { PlanLockComponent } from '../../shared/plan-lock.component';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

/**
 * Customers the business lost in the period: no order for 7 or 14 days
 * after their last one. Every plan sees how many and the money — the sum
 * of their average checks; PRO also sees who they are.
 */
@Component({
  selector: 'app-churn-widget',
  standalone: true,
  imports: [RouterLink, TranslatePipe, PlanLockComponent],
  template: `
    <article class="dash-card">
      <header class="dash-card-head">
        <h2>{{ 'admin.churn.title' | translate }}</h2>
        <div class="churn-window" role="group" [attr.aria-label]="'admin.churn.windowLabel' | translate">
          @for (w of windows; track w) {
            <button
              type="button"
              [class.churn-window-on]="window() === w"
              [attr.aria-pressed]="window() === w"
              (click)="window.set(w)"
            >
              {{ 'admin.churn.window' | translate: { days: w } }}
            </button>
          }
        </div>
      </header>
      <p class="dash-muted">{{ 'admin.churn.hint' | translate: { days: window() } }}</p>

      <div class="churn-figures">
        <div>
          <span class="churn-value">{{ stats()?.count ?? '—' }}</span>
          <span class="churn-label">{{ 'admin.churn.lost' | translate }}</span>
        </div>
        <div>
          <span class="churn-value">{{ stats() ? money(stats()!.lostRevenueCents) : '—' }}</span>
          <span class="churn-label">{{ 'admin.churn.lostRevenue' | translate }}</span>
        </div>
      </div>
      @if (delta(); as d) {
        <p class="churn-delta" [style.color]="d.tone">{{ d.text }}</p>
      }

      @if (stats()?.customers; as customers) {
        @if (customers.length > 0) {
          <ul class="churn-list">
            @for (c of customers.slice(0, 3); track c.userId) {
              <li>
                <a [routerLink]="['/customers', c.userId]">{{
                  c.name || c.phone || ('admin.customers.noName' | translate)
                }}</a>
                <span
                  >{{ money(c.avgCheckCents) }} ·
                  {{ 'admin.churn.daysAgo' | translate: { days: c.daysSinceLastOrder } }}</span
                >
              </li>
            }
          </ul>
        }
        <a routerLink="/analytics" [queryParams]="{ tab: 'retention' }" class="dash-link">{{
          'admin.churn.toRetention' | translate
        }}</a>
      } @else if (stats() && !plans.has('churnList')) {
        <app-plan-lock feature="churnList" [compact]="true" />
      }
    </article>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      :host {
        display: block;
      }
      .churn-window {
        display: flex;
        gap: 4px;
      }
      .churn-window button {
        height: 28px;
        padding: 0 10px;
        border-radius: 9999px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .churn-window .churn-window-on {
        background: var(--color-espresso);
        border-color: transparent;
        color: white;
      }
      .churn-figures {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .churn-figures > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        padding: 12px;
        border-radius: 14px;
        background: var(--color-cream);
      }
      .churn-value {
        font-family: var(--font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--color-espresso);
        /* A large sum with its currency breaks onto a second line rather than
           pushing the tile past the card. */
        overflow-wrap: anywhere;
      }
      .churn-label {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .churn-delta {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
      }
      .churn-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .churn-list li {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .churn-list a {
        color: var(--color-text-primary);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .churn-list span {
        color: var(--color-text-tertiary);
        white-space: nowrap;
      }
    `,
  ],
})
export class ChurnWidgetComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly fmt = inject(LocaleFormatService);
  private readonly translate = inject(TranslateService);
  readonly plans = inject(PlanAccess);

  readonly brandId = input.required<string>();
  readonly period = input.required<AnalyticsPeriod>();
  readonly currency = input<string | null | undefined>(null);

  readonly windows: readonly ChurnWindow[] = [7, 14];
  readonly window = signal<ChurnWindow>(14);
  readonly stats = signal<ChurnStats | null>(null);

  /** More customers lost is the bad direction. */
  readonly delta = computed<{ text: string; tone: string } | null>(() => {
    const s = this.stats();
    if (!s || s.countDeltaPercent === null) return null;
    const v = s.countDeltaPercent;
    const arrow = v > 0 ? '▲ ' : v < 0 ? '▼ ' : '';
    const tone = v > 0 ? 'var(--color-berry)' : v < 0 ? '#3E8868' : 'var(--color-text-tertiary)';
    const text = this.translate.instant('admin.churn.vsPrevious', {
      change: `${arrow}${this.fmt.percent(Math.abs(v))}`,
      count: s.previous.count,
    });
    return { text, tone };
  });

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      const period = this.period();
      const window = this.window();
      untracked(() =>
        this.api.churn(brandId, period, window, 3).subscribe({
          next: (s) => this.stats.set(s),
          error: () => this.stats.set(null),
        }),
      );
    });
  }

  money(cents: number): string {
    return this.fmt.money(cents, this.currency(), { round: true });
  }
}
