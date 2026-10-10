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
import { AuthStore } from '../../core/auth/auth.store';
import { INACTIVE_DAYS, INACTIVE_MIN_ORDERS } from '../../core/customers/inactive-segment';
import { type AdminRole, canAccess } from '../../core/permissions/permissions';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { PlanLockComponent } from '../../shared/plan-lock.component';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

/**
 * «Неактивные клиенты» on the business home, right under the KPIs: regulars
 * (3+ orders) who stopped ordering for 3, 7 or 14 days during the period.
 * The money comes first — the revenue missed, the sum of their average
 * checks — then how many they are. Every plan sees both; PRO also sees who
 * they are and the «Возврат» button, which opens the win-back tab of the
 * analytics on the same period, store and window.
 */
@Component({
  selector: 'app-churn-widget',
  standalone: true,
  imports: [RouterLink, TranslatePipe, PlanLockComponent],
  template: `
    <article class="dash-card churn">
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
      <p class="dash-muted">{{ 'admin.churn.definition' | translate: { min: minOrders, days: window() } }}</p>

      <div class="churn-body">
        <div class="churn-figures">
          <div class="churn-money">
            <span class="churn-label">{{ 'admin.churn.lostRevenue' | translate }}</span>
            <span class="churn-value">{{ stats() ? money(stats()!.lostRevenueCents) : '—' }}</span>
            <span class="churn-note">{{ 'admin.churn.lostRevenueHint' | translate }}</span>
          </div>
          <div>
            <span class="churn-label">{{ 'admin.churn.lost' | translate }}</span>
            <span class="churn-value">{{ stats()?.count ?? '—' }}</span>
            @if (delta(); as d) {
              <span class="churn-note churn-delta" [style.color]="d.tone">{{ d.text }}</span>
            }
          </div>
        </div>

        @if (stats()?.customers; as customers) {
          <div class="churn-side">
            @if (customers.length > 0) {
              <ul class="churn-list">
                @for (c of customers.slice(0, 3); track c.userId) {
                  <li>
                    @if (canSeeCustomers()) {
                      <a [routerLink]="['/customers', c.userId]">{{
                        c.name || c.phone || ('admin.customers.noName' | translate)
                      }}</a>
                    } @else {
                      <span class="churn-name">{{ c.name || c.phone || ('admin.customers.noName' | translate) }}</span>
                    }
                    <span
                      >{{ money(c.avgCheckCents) }} ·
                      {{ 'admin.churn.daysAgo' | translate: { days: c.daysSinceLastOrder } }}</span
                    >
                  </li>
                }
              </ul>
            }
            @if (canSeeAnalytics()) {
              <a routerLink="/analytics" [queryParams]="retentionQuery()" class="churn-cta">{{
                'admin.churn.toRetention' | translate
              }}</a>
            }
          </div>
        } @else if (stats() && !plans.has('churnList')) {
          <app-plan-lock feature="churnList" [compact]="true" />
        }
      </div>
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
      .churn-body {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        gap: 16px;
        align-items: start;
      }
      .churn-figures {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        gap: 12px;
      }
      .churn-figures > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        padding: 12px 14px;
        border-radius: 14px;
        background: var(--color-cream);
      }
      /* The revenue walking away is the figure to see first. */
      .churn-figures > .churn-money {
        background: color-mix(in srgb, var(--chart-warning) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--chart-warning) 35%, transparent);
      }
      .churn-label {
        font-family: var(--font-sans);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .churn-money .churn-label {
        color: var(--chart-warning);
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
      .churn-money .churn-value {
        font-size: 30px;
        color: var(--chart-warning);
      }
      .churn-note {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .churn-delta {
        font-weight: 600;
      }
      .churn-side {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
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
      .churn-list a,
      .churn-name {
        color: var(--color-text-primary);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .churn-list span:last-child {
        color: var(--color-text-tertiary);
        white-space: nowrap;
      }
      .churn-cta {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        height: 36px;
        padding: 0 16px;
        border-radius: var(--radius-button);
        background: var(--color-caramel);
        color: white;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
      }
      @media (max-width: 900px) {
        .churn-body {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 480px) {
        .churn-figures {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class ChurnWidgetComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly fmt = inject(LocaleFormatService);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthStore);
  readonly plans = inject(PlanAccess);

  readonly brandId = input.required<string>();
  readonly period = input.required<AnalyticsPeriod>();
  readonly currency = input<string | null | undefined>(null);

  readonly windows: readonly ChurnWindow[] = INACTIVE_DAYS;
  readonly minOrders = INACTIVE_MIN_ORDERS;
  readonly window = signal<ChurnWindow>(14);
  readonly stats = signal<ChurnStats | null>(null);

  private readonly role = computed(() => this.auth.user()?.role as AdminRole | undefined);
  // The dashboard is open to store managers; analytics and customers are not.
  readonly canSeeAnalytics = computed(() => canAccess(this.role(), 'analytics'));
  readonly canSeeCustomers = computed(() => canAccess(this.role(), 'customers'));

  /** The win-back tab on the same period, store and window as here. */
  readonly retentionQuery = computed(() => {
    const p = this.period();
    return {
      tab: 'retention',
      window: this.window(),
      ...(p.from || p.to ? { from: p.from, to: p.to } : { days: p.days }),
      storeId: p.storeId ?? undefined,
    };
  });

  /** More customers going inactive is the bad direction. */
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
