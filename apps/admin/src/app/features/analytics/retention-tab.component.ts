import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { Subscription } from 'rxjs';

import {
  AnalyticsApi,
  type AnalyticsPeriod,
  type ChurnStats,
  type WinBackStats,
} from '../../core/analytics/analytics.service';
import {
  DEFAULT_INACTIVE_DAYS,
  INACTIVE_MIN_ORDERS,
  type InactiveSegment,
  campaignLink,
  customersLink,
  promoLink,
} from '../../core/customers/inactive-segment';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { InactiveDaysComponent } from '../../shared/inactive-days.component';

/**
 * The «Возврат» (win-back) tab, PRO. Says who counts as inactive — with the
 * threshold picker right there (7 / 14 / 30 / 90 / «Свой…», the same as on
 * the dashboard card and in «Клиенты»), while the period on top says when
 * they became inactive — then:
 *
 *   the money first — revenue missed on the customers who became inactive
 *   in the period (days away ÷ usual interval × average check, per
 *   customer), then how many they are, against the period before;
 *   what to do about it — a campaign to the inactive, a code only they can
 *   use, or both at once («акция»), each opening prefilled for the chosen
 *   days and store;
 *   how many inactive customers came back;
 *   who became inactive, each opening the same customer page as «Клиенты».
 */
@Component({
  selector: 'app-retention-tab',
  standalone: true,
  imports: [RouterLink, TranslatePipe, InactiveDaysComponent],
  template: `
    <div class="rt-definition">
      <p>
        <strong>{{ 'admin.churn.definition' | translate: { min: minOrders, days: inactiveDays() } }}</strong>
        {{ 'admin.analytics.retention.periodNote' | translate }}
      </p>
      <app-inactive-days [(days)]="inactiveDays" />
    </div>

    <article class="dash-card">
      <header class="dash-card-head">
        <h2>{{ 'admin.churn.title' | translate }}</h2>
      </header>
      <div class="rt-figures">
        <div class="rt-figure rt-figure-money">
          <span class="rt-label">{{ 'admin.churn.lostRevenue' | translate }}</span>
          <strong>{{ churn() ? price(churn()!.lostRevenueCents) : '—' }}</strong>
          <em>{{ 'admin.churn.lostRevenueHint' | translate }}</em>
          <em data-testid="retention-one-visit">{{ 'admin.churn.lostRevenueOneVisit' | translate }}</em>
        </div>
        <div class="rt-figure">
          <span class="rt-label">{{ 'admin.churn.lost' | translate }}</span>
          <strong>{{ churn()?.count ?? '—' }}</strong>
          @if (delta(); as d) {
            <em [style.color]="d.tone">{{ d.text }}</em>
          }
        </div>
      </div>
      @if (churn()?.activeElsewhere; as elsewhere) {
        @if (elsewhere.count > 0) {
          <p class="rt-elsewhere" role="note" data-testid="retention-active-elsewhere">
            {{ 'admin.churn.activeElsewhere' | translate: { count: elsewhere.count } }}
            {{ 'admin.churn.activeElsewhereStores' | translate }}
            @for (s of elsewhere.stores; track s.storeId; let last = $last) {
              <button type="button" class="rt-store-link" (click)="storePicked.emit(s.storeId)">
                {{ 'admin.churn.activeElsewhereStore' | translate: { store: s.storeName, count: s.count } }}
              </button>
              @if (!last) {
                ·
              }
            }
          </p>
        }
      }
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
          — {{ 'admin.analytics.retention.nowHint' | translate: { days: inactiveDays() } }}
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
      <p class="dash-hint">{{ 'admin.analytics.winback.hint' | translate: { days: inactiveDays() } }}</p>
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
      <p class="dash-hint">{{ 'admin.churn.hint' | translate: { days: inactiveDays() } }}</p>
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
                  <th class="num">{{ 'admin.churn.intervalCol' | translate }}</th>
                  <th class="num">{{ 'admin.churn.estimateCol' | translate }}</th>
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
                    <td class="num">
                      {{
                        c.visitIntervalDays === null
                          ? ('admin.churn.intervalOneVisit' | translate)
                          : ('admin.churn.intervalDays' | translate: { days: days(c.visitIntervalDays) })
                      }}
                    </td>
                    <td class="num">≈ {{ price(c.lostRevenueCents) }}</td>
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
      .rt-definition {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 0;
        padding: 12px 16px;
        border-radius: 14px;
        background: var(--color-cream);
        font-size: 13px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }
      .rt-definition p {
        margin: 0;
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
      .rt-elsewhere {
        margin: 12px 0 0;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--color-cream);
        font-size: 13px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }
      .rt-store-link {
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        font-weight: 600;
        color: var(--color-caramel);
        cursor: pointer;
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
  private readonly translate = inject(TranslateService);
  readonly plans = inject(PlanAccess);
  protected readonly fmt = inject(LocaleFormatService);

  readonly brandId = input.required<string>();
  readonly period = input.required<AnalyticsPeriod>();
  readonly currency = input<string | null | undefined>(null);
  /**
   * Days without an order that make a regular inactive, picked under the
   * definition (back since 2026-11-18, now with 7 / 14 / 30 / 90 / «Свой…»):
   * 14, or the threshold of the dashboard card the tab was opened from, so
   * the two show the same people.
   */
  readonly inactiveDays = model<number>(DEFAULT_INACTIVE_DAYS);
  /** A store from «ещё N чел. перестали ходить в одну из точек» — the page narrows to it. */
  readonly storePicked = output<string>();

  readonly minOrders = INACTIVE_MIN_ORDERS;
  readonly winBack = signal<WinBackStats | null>(null);
  readonly churn = signal<ChurnStats | null>(null);
  /**
   * The size of the segment the action buttons reach — the dashboard card's
   * count, from the same request: the same people as «Клиенты → Неактивные».
   */
  readonly inactiveNow = signal<number | null>(null);

  readonly segment = computed<InactiveSegment>(() => ({
    days: this.inactiveDays(),
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

  private requests: Subscription[] = [];

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      const period = this.period();
      const days = this.inactiveDays();
      untracked(() => {
        // Answers for a threshold or period no longer on screen are dropped.
        this.requests.forEach((r) => r.unsubscribe());
        this.requests = [
          this.api.winBack(brandId, period, days, 20).subscribe({ next: (w) => this.winBack.set(w) }),
          this.api.churn(brandId, period, days, 50).subscribe({ next: (c) => this.churn.set(c) }),
          // Only the count: the people are listed under «Все неактивные клиенты».
          this.api.inactive(brandId, period, days, 0).subscribe({
            next: (now) => this.inactiveNow.set(now.count),
            error: () => this.inactiveNow.set(null),
          }),
        ];
      });
    });
    inject(DestroyRef).onDestroy(() => this.requests.forEach((r) => r.unsubscribe()));
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }

  /** A usual interval between visits, one decimal: «1,4», «4». */
  days(value: number): string {
    return new Intl.NumberFormat(this.fmt.lang() === 'ru' ? 'ru-RU' : 'en-GB', { maximumFractionDigits: 1 }).format(
      value,
    );
  }

  deltaColor(value: number | null): string {
    if (value === null || value === 0) return 'var(--color-text-tertiary)';
    return value > 0 ? '#3E8868' : 'var(--color-berry)';
  }
}
