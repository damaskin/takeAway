import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import {
  AnalyticsApi,
  type AnalyticsPeriod,
  type ChurnStats,
  type ChurnWindow,
  type WinBackStats,
} from '../../core/analytics/analytics.service';
import { CustomersApi } from '../../core/customers/customers.service';
import {
  INACTIVE_DAYS,
  INACTIVE_MIN_ORDERS,
  type InactiveSegment,
  campaignLink,
  customersLink,
  promoLink,
} from '../../core/customers/inactive-segment';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

/**
 * The «Возврат» (win-back) tab, PRO. Says who counts as inactive, then:
 *
 *   the money first — revenue missed on the customers who became inactive
 *   in the period, then how many they are, against the period before;
 *   what to do about it — a campaign to the inactive, a code only they can
 *   use, or both at once («акция»), each opening prefilled for the chosen
 *   days and store;
 *   how many inactive customers came back;
 *   who became inactive, each opening the same customer page as «Клиенты».
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

    <p class="rt-definition">
      <strong>{{ 'admin.churn.definition' | translate: { min: minOrders, days: window() } }}</strong>
      {{ 'admin.analytics.retention.periodNote' | translate }}
    </p>

    <article class="dash-card">
      <header class="dash-card-head">
        <h2>{{ 'admin.churn.title' | translate }}</h2>
      </header>
      <div class="rt-figures">
        <div class="rt-figure rt-figure-money">
          <span class="rt-label">{{ 'admin.churn.lostRevenue' | translate }}</span>
          <strong>{{ churn() ? price(churn()!.lostRevenueCents) : '—' }}</strong>
          <em>{{ 'admin.churn.lostRevenueHint' | translate }}</em>
        </div>
        <div class="rt-figure">
          <span class="rt-label">{{ 'admin.churn.lost' | translate }}</span>
          <strong>{{ churn()?.count ?? '—' }}</strong>
          @if (delta(); as d) {
            <em [style.color]="d.tone">{{ d.text }}</em>
          }
        </div>
      </div>
    </article>

    <article class="dash-card rt-actions">
      <header class="dash-card-head">
        <h2>{{ 'admin.analytics.retention.actionsTitle' | translate }}</h2>
        @if (plans.has('customers')) {
          <a
            class="dash-link"
            [routerLink]="links().customers.commands"
            [queryParams]="links().customers.queryParams"
            >{{ 'admin.analytics.retention.seeAll' | translate }}</a
          >
        }
      </header>
      @if (inactiveNow() !== null) {
        <p class="rt-now">
          <strong>{{ 'admin.analytics.retention.now' | translate: { count: inactiveNow() } }}</strong>
          — {{ 'admin.analytics.retention.nowHint' | translate: { days: window() } }}
        </p>
      }
      <div class="rt-buttons">
        @if (plans.has('campaigns')) {
          <a
            class="rt-action rt-action-main"
            [routerLink]="links().campaign.commands"
            [queryParams]="links().campaign.queryParams"
          >
            <strong>{{ 'admin.analytics.retention.broadcast' | translate }}</strong>
            <span>{{ 'admin.analytics.retention.broadcastHint' | translate }}</span>
          </a>
        }
        @if (plans.has('promo')) {
          <a class="rt-action" [routerLink]="links().promo.commands" [queryParams]="links().promo.queryParams">
            <strong>{{ 'admin.analytics.retention.promo' | translate }}</strong>
            <span>{{ 'admin.analytics.retention.promoHint' | translate }}</span>
          </a>
        }
        @if (plans.has('promo') && plans.has('campaigns')) {
          <a class="rt-action" [routerLink]="links().offer.commands" [queryParams]="links().offer.queryParams">
            <strong>{{ 'admin.analytics.retention.offer' | translate }}</strong>
            <span>{{ 'admin.analytics.retention.offerHint' | translate }}</span>
          </a>
        }
      </div>
    </article>

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
        <h2>{{ 'admin.analytics.retention.listTitle' | translate }}</h2>
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
      .rt-definition {
        margin: 0;
        padding: 12px 16px;
        border-radius: 14px;
        background: var(--color-cream);
        font-size: 13px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }
      .rt-definition strong {
        color: var(--color-text-primary);
        font-weight: 600;
      }
      .rt-figures {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        gap: 12px;
      }
      .rt-figure {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        padding: 14px 16px;
        border-radius: 14px;
        background: var(--color-cream);
      }
      .rt-figure strong {
        font-family: var(--font-display);
        font-size: 26px;
        font-weight: 700;
        color: var(--color-espresso);
        overflow-wrap: anywhere;
      }
      .rt-figure em {
        font-style: normal;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .rt-label {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      /* The number the business must not miss: the money walking away. */
      .rt-figure-money {
        background: color-mix(in srgb, var(--chart-warning) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--chart-warning) 35%, transparent);
      }
      .rt-figure-money strong {
        font-size: 32px;
        color: var(--chart-warning);
      }
      .rt-figure-money .rt-label {
        color: var(--chart-warning);
      }
      .rt-now {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .rt-now strong {
        color: var(--color-text-primary);
      }
      .rt-buttons {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
        gap: 10px;
      }
      .rt-action {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid var(--color-border);
        background: var(--color-foam);
        text-decoration: none;
      }
      .rt-action strong {
        font-size: 14px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .rt-action span {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .rt-action:hover {
        border-color: var(--color-caramel);
      }
      .rt-action-main {
        background: var(--color-caramel);
        border-color: transparent;
      }
      .rt-action-main strong,
      .rt-action-main span {
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
      @media (max-width: 600px) {
        .rt-figures {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class RetentionTabComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly customers = inject(CustomersApi);
  private readonly translate = inject(TranslateService);
  readonly plans = inject(PlanAccess);
  protected readonly fmt = inject(LocaleFormatService);

  readonly brandId = input.required<string>();
  readonly period = input.required<AnalyticsPeriod>();
  readonly currency = input<string | null | undefined>(null);
  /** Days without an order that make a regular inactive; two-way so the page can open the tab on a window. */
  readonly window = model<ChurnWindow>(14);

  readonly windows: readonly ChurnWindow[] = INACTIVE_DAYS;
  readonly minOrders = INACTIVE_MIN_ORDERS;
  readonly winBack = signal<WinBackStats | null>(null);
  readonly churn = signal<ChurnStats | null>(null);
  /** The size of the segment the action buttons reach — the same people as «Клиенты → Неактивные». */
  readonly inactiveNow = signal<number | null>(null);

  readonly segment = computed<InactiveSegment>(() => ({
    days: this.window(),
    storeId: this.period().storeId ?? null,
  }));
  readonly links = computed(() => {
    const segment = this.segment();
    return {
      customers: customersLink(segment),
      campaign: campaignLink(segment),
      promo: promoLink(segment),
      offer: promoLink(segment, 'campaign'),
    };
  });

  /** More customers going inactive is the bad direction. */
  readonly delta = computed<{ text: string; tone: string } | null>(() => {
    const s = this.churn();
    if (!s || s.countDeltaPercent === null) return null;
    const v = s.countDeltaPercent;
    const arrow = v > 0 ? '▲ ' : v < 0 ? '▼ ' : '';
    const tone = v > 0 ? 'var(--color-berry)' : v < 0 ? 'var(--color-positive)' : 'var(--color-text-tertiary)';
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
      untracked(() => {
        this.api.winBack(brandId, period, window, 20).subscribe({ next: (w) => this.winBack.set(w) });
        this.api.churn(brandId, period, window, 50).subscribe({ next: (c) => this.churn.set(c) });
        if (this.plans.has('customers')) {
          this.customers
            .list({ brandId, storeId: period.storeId, segment: 'inactive', inactiveDays: window, pageSize: 1 })
            .subscribe({ next: (page) => this.inactiveNow.set(page.total), error: () => this.inactiveNow.set(null) });
        }
      });
    });
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }

  deltaColor(value: number | null): string {
    if (value === null || value === 0) return 'var(--color-text-tertiary)';
    return value > 0 ? '#3E8868' : 'var(--color-berry)';
  }
}
