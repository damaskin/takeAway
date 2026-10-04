import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { map } from 'rxjs';

import {
  AnalyticsApi,
  type AnalyticsPeriod,
  type CohortStats,
  type RevenueSeries,
  type StaffPerformance,
  type StorePerformance,
  type TopProduct,
} from '../../core/analytics/analytics.service';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { DateRangeComponent, type DateRangeValue } from '../../shared/date-range.component';
import { PlanLockComponent } from '../../shared/plan-lock.component';
import { RetentionTabComponent } from './retention-tab.component';

type Tab = 'overview' | 'stores' | 'staff' | 'retention';
const TABS: readonly Tab[] = ['overview', 'stores', 'staff', 'retention'];

interface ChartBar {
  date: string;
  label: string;
  sub: string;
  height: number;
  title: string;
}

/**
 * Admin Analytics — pencil C6 (qZ5Ld), in tabs:
 *
 *   Overview   revenue by day (every plan); top products and customers (PRO)
 *   Stores     revenue and orders per store (every plan); the comparison (PRO)
 *   Staff      orders handled and shift hours per employee (PRO)
 *   Retention  customers lost and won back, with the people behind it (PRO)
 *
 * One period picker and one store filter drive every tab; the tab is in the
 * address (`?tab=stores`) so a link opens the right one.
 */
@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [TranslatePipe, DateRangeComponent, PlanLockComponent, RetentionTabComponent],
  template: `
    <section class="an">
      <header class="an-head">
        <h1>{{ 'admin.analytics.title' | translate }}</h1>
        <div class="an-controls">
          @if (stores().length > 1 && tab() !== 'stores') {
            <select
              class="an-select"
              [attr.aria-label]="'admin.analytics.storeFilter' | translate"
              (change)="storeId.set($any($event.target).value || null)"
            >
              <option value="" [selected]="!storeId()">{{ 'admin.analytics.allStores' | translate }}</option>
              @for (s of stores(); track s.id) {
                <option [value]="s.id" [selected]="storeId() === s.id">{{ s.name }}</option>
              }
            </select>
          }
          <app-date-range [(value)]="range" />
        </div>
      </header>

      <nav class="an-tabs" role="tablist">
        @for (t of tabs; track t) {
          <button
            type="button"
            role="tab"
            class="an-tab"
            [class.an-tab-on]="tab() === t"
            [attr.aria-selected]="tab() === t"
            (click)="setTab(t)"
          >
            {{ 'admin.analytics.tabs.' + t | translate }}
            @if (tabLocked(t)) {
              <span class="an-tab-lock">{{ 'admin.plans.proBadge' | translate }}</span>
            }
          </button>
        }
      </nav>

      @switch (tab()) {
        @case ('overview') {
          <article class="dash-card">
            <header class="an-revenue-head">
              <div class="flex flex-col" style="gap: 4px">
                <span class="an-caption">{{ 'admin.analytics.revenueTitle' | translate: periodWords() }}</span>
                <div class="flex items-baseline flex-wrap" style="gap: 12px">
                  <span class="an-big">{{ price(revenue()?.totalRevenueCents ?? 0) }}</span>
                  @if (revenue(); as r) {
                    <span
                      class="an-delta"
                      [style.color]="r.revenueDeltaPercent >= 0 ? '#3E8868' : 'var(--color-berry)'"
                    >
                      {{ r.revenueDeltaPercent >= 0 ? '▲' : '▼' }} {{ fmt.percent(abs(r.revenueDeltaPercent)) }}
                      <span class="an-delta-note">{{
                        'admin.analytics.vsPrevious' | translate: { amount: price(r.previousRevenueCents) }
                      }}</span>
                    </span>
                  }
                </div>
                @if (revenue(); as r) {
                  <span class="dash-hint">{{
                    'admin.analytics.ordersAndCheck'
                      | translate: { orders: r.totalOrders, check: price(r.avgBasketCents) }
                  }}</span>
                }
              </div>
              @if (revenue()?.bestDay; as best) {
                <div class="flex flex-col" style="gap: 6px; text-align: right">
                  <span class="an-caption">{{ 'admin.analytics.bestDay' | translate }}</span>
                  <span class="an-strong">{{ fmt.dayMonth(best.date, 'UTC') }} · {{ price(best.revenueCents) }}</span>
                </div>
              }
            </header>

            @if (bars().length === 0) {
              <p class="dash-muted" style="padding: 40px 0; text-align: center">
                {{ 'admin.analytics.noData' | translate }}
              </p>
            } @else {
              <div
                class="an-chart"
                [style.gap.px]="barGap()"
                role="img"
                [attr.aria-label]="'admin.analytics.chartLabel' | translate"
              >
                @for (b of bars(); track b.date) {
                  <div class="an-bar-col" [attr.title]="b.title">
                    <span class="an-bar-sub">{{ b.sub }}</span>
                    <div class="an-bar" [style.height.%]="b.height"></div>
                  </div>
                }
              </div>
              <div class="an-axis" [style.gap.px]="barGap()">
                @for (b of bars(); track b.date) {
                  <span>{{ b.label }}</span>
                }
              </div>
            }
          </article>

          <div class="an-two">
            <article class="dash-card">
              <header class="dash-card-head">
                <h2>{{ 'admin.analytics.topProducts' | translate }}</h2>
              </header>
              @if (!plans.has('deepAnalytics')) {
                <app-plan-lock feature="deepAnalytics" [compact]="true" />
              } @else if (topProducts().length === 0) {
                <p class="dash-muted">{{ 'admin.analytics.noOrders' | translate }}</p>
              } @else {
                @for (row of topProducts(); track row.name) {
                  <div class="flex flex-col" style="gap: 6px">
                    <div class="flex items-center justify-between" style="gap: 8px">
                      <span class="an-row-name">{{ row.name }}</span>
                      <span class="an-row-note"
                        >{{ row.unitsSold }} {{ 'admin.analytics.unitsSold' | translate }} ·
                        {{ price(row.revenueCents) }}</span
                      >
                    </div>
                    <div class="an-track"><div class="an-fill" [style.width.%]="productPercent(row)"></div></div>
                  </div>
                }
              }
            </article>

            <article class="dash-card">
              <header class="dash-card-head">
                <h2>{{ 'admin.analytics.cohortTitle' | translate }}</h2>
              </header>
              @if (!plans.has('deepAnalytics')) {
                <app-plan-lock feature="deepAnalytics" [compact]="true" />
              } @else {
                <div class="an-tiles">
                  <div class="an-tile">
                    <span>{{ 'admin.analytics.repeatRate' | translate }}</span>
                    <strong>{{ fmt.percent(cohort()?.repeatRatePercent ?? 0) }}</strong>
                  </div>
                  <div class="an-tile">
                    <span>{{ 'admin.analytics.avgBasket' | translate }}</span>
                    <strong>{{ price(cohort()?.avgBasketCents ?? 0) }}</strong>
                  </div>
                  <div class="an-tile">
                    <span>{{ 'admin.analytics.newCustomers' | translate }}</span>
                    <strong>{{ cohort()?.newCustomers ?? 0 }}</strong>
                  </div>
                  <div class="an-tile">
                    <span>{{ 'admin.analytics.pickupSla' | translate }}</span>
                    <strong>{{ fmt.percent(cohort()?.pickupSlaPercent ?? 0) }}</strong>
                  </div>
                </div>
              }
            </article>
          </div>
        }

        @case ('stores') {
          <article class="dash-card">
            <header class="dash-card-head">
              <h2>{{ 'admin.analytics.stores.shareTitle' | translate }}</h2>
            </header>
            <p class="dash-hint">{{ 'admin.analytics.stores.profitHint' | translate }}</p>
            @for (s of storeRows(); track s.storeId) {
              <div class="an-share">
                <div class="flex items-center justify-between" style="gap: 8px">
                  <span class="an-row-name">{{ s.storeName }}</span>
                  <span class="an-row-note">{{ fmt.percent(s.sharePercent) }} · {{ price(s.revenueCents) }}</span>
                </div>
                <div class="an-track"><div class="an-fill" [style.width.%]="s.sharePercent"></div></div>
                @if (s.detailed && s.ordersSharePercent !== null) {
                  <div class="an-track an-track-thin">
                    <div class="an-fill an-fill-orders" [style.width.%]="s.ordersSharePercent"></div>
                  </div>
                }
              </div>
            } @empty {
              <p class="dash-muted">{{ 'admin.analytics.noOrders' | translate }}</p>
            }
            @if (storesDetailed()) {
              <div class="an-legend">
                <span><i class="an-key"></i>{{ 'admin.analytics.stores.revenueShare' | translate }}</span>
                <span><i class="an-key an-key-orders"></i>{{ 'admin.analytics.stores.ordersShare' | translate }}</span>
              </div>
            }
          </article>

          <article class="dash-card">
            <header class="dash-card-head">
              <h2>{{ 'admin.analytics.stores.tableTitle' | translate }}</h2>
            </header>
            <div class="an-table-wrap">
              <table class="an-table">
                <thead>
                  <tr>
                    <th>{{ 'admin.analytics.stores.cols.store' | translate }}</th>
                    <th class="num">{{ 'admin.analytics.stores.cols.revenue' | translate }}</th>
                    <th class="num">{{ 'admin.analytics.stores.cols.orders' | translate }}</th>
                    @if (storesDetailed()) {
                      <th class="num">{{ 'admin.analytics.stores.cols.change' | translate }}</th>
                      <th class="num">{{ 'admin.analytics.stores.cols.avgCheck' | translate }}</th>
                      <th class="num">{{ 'admin.analytics.stores.cols.pickup' | translate }}</th>
                      <th class="num">{{ 'admin.analytics.stores.cols.prep' | translate }}</th>
                      <th class="num">{{ 'admin.analytics.stores.cols.cancelled' | translate }}</th>
                      <th class="num">{{ 'admin.analytics.stores.cols.customers' | translate }}</th>
                      <th class="num">{{ 'admin.analytics.stores.cols.staff' | translate }}</th>
                      <th class="num">{{ 'admin.analytics.stores.cols.perStaff' | translate }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (s of storeRows(); track s.storeId) {
                    <tr>
                      <td class="an-row-name">{{ s.storeName }}</td>
                      <td class="num">{{ price(s.revenueCents) }}</td>
                      <td class="num">{{ s.orders }}</td>
                      @if (s.detailed) {
                        <td class="num" [style.color]="deltaColor(s.revenueDeltaPercent)">
                          {{ signedPercent(s.revenueDeltaPercent) }}
                        </td>
                        <td class="num">{{ s.avgCheckCents ? price(s.avgCheckCents) : '—' }}</td>
                        <td class="num">{{ duration(s.avgPickupSeconds) }}</td>
                        <td class="num">{{ duration(s.avgPrepSeconds) }}</td>
                        <td class="num">
                          {{ (s.cancelled ?? 0) + (s.expired ?? 0) }}
                          @if (s.cancelRatePercent !== null) {
                            <span class="an-row-note">({{ fmt.percent(s.cancelRatePercent) }})</span>
                          }
                        </td>
                        <td class="num">{{ s.customers }}</td>
                        <td class="num">{{ s.staff }}</td>
                        <td class="num">{{ s.ordersPerStaff ?? '—' }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (!storesDetailed() && storeRows().length > 0) {
              <app-plan-lock feature="storeComparison" />
            }
          </article>
        }

        @case ('staff') {
          @if (!plans.has('staffAnalytics')) {
            <app-plan-lock feature="staffAnalytics" />
          } @else {
            <article class="dash-card">
              <header class="dash-card-head">
                <h2>{{ 'admin.analytics.staff.title' | translate }}</h2>
              </header>
              <p class="dash-hint">{{ 'admin.analytics.staff.hint' | translate }}</p>
              @if (staff().length === 0) {
                <p class="dash-muted">{{ 'admin.analytics.staff.empty' | translate }}</p>
              } @else {
                <div class="an-table-wrap">
                  <table class="an-table">
                    <thead>
                      <tr>
                        <th>{{ 'admin.analytics.staff.cols.person' | translate }}</th>
                        <th class="num">{{ 'admin.analytics.staff.cols.accepted' | translate }}</th>
                        <th class="num">{{ 'admin.analytics.staff.cols.ready' | translate }}</th>
                        <th class="num">{{ 'admin.analytics.staff.cols.completed' | translate }}</th>
                        <th class="num">{{ 'admin.analytics.staff.cols.handled' | translate }}</th>
                        <th class="num">{{ 'admin.analytics.staff.cols.shifts' | translate }}</th>
                        <th class="num">{{ 'admin.analytics.staff.cols.hours' | translate }}</th>
                        <th class="num">{{ 'admin.analytics.staff.cols.perHour' | translate }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (p of staff(); track p.userId) {
                        <tr>
                          <td>
                            <div class="an-row-name">{{ p.name || p.email || '—' }}</div>
                            <div class="an-row-note">{{ 'admin.layout.role.' + p.role | translate }}</div>
                          </td>
                          <td class="num">{{ p.accepted }}</td>
                          <td class="num">{{ p.ready }}</td>
                          <td class="num">{{ p.completed }}</td>
                          <td class="num">{{ p.handled }}</td>
                          <td class="num">{{ p.shifts }}</td>
                          <td class="num">{{ p.shiftHours }}</td>
                          <td class="num">{{ p.ordersPerHour ?? '—' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </article>
          }
        }

        @case ('retention') {
          @if (!plans.has('winBack')) {
            <app-plan-lock feature="winBack" />
          } @else if (brandId(); as id) {
            <app-retention-tab [brandId]="id" [period]="period()" [currency]="currency()" />
          }
        }
      }
    </section>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      .an {
        padding: clamp(16px, 4vw, 24px);
        display: flex;
        flex-direction: column;
        gap: 20px;
        font-family: var(--font-sans);
      }
      .an-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }
      .an-head h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .an-controls {
        display: flex;
        align-items: flex-end;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .an-select {
        height: 32px;
        max-width: 220px;
        padding: 0 10px;
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-button);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-size: 13px;
      }
      .an-tabs {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        border-bottom: 1px solid var(--color-border-light);
      }
      .an-tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 10px 14px;
        border: 0;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: var(--color-text-secondary);
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }
      .an-tab-on {
        color: var(--color-caramel);
        border-bottom-color: var(--color-caramel);
      }
      .an-tab-lock {
        padding: 1px 6px;
        border-radius: 9999px;
        border: 1px solid var(--color-border);
        color: var(--color-text-tertiary);
        font-size: 9px;
        letter-spacing: 0.5px;
      }
      .an-revenue-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
      }
      .an-caption {
        font-size: 12px;
        color: var(--color-text-tertiary);
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .an-big {
        font-family: var(--font-display);
        font-size: 32px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .an-delta {
        font-size: 14px;
        font-weight: 600;
      }
      .an-delta-note {
        font-weight: 400;
        color: var(--color-text-tertiary);
      }
      .an-strong {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .an-chart {
        display: flex;
        align-items: flex-end;
        height: 180px;
        padding: 0 4px;
        border-bottom: 1px solid var(--color-border-light);
      }
      .an-bar-col {
        flex: 1 1 0;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
      }
      .an-bar-sub {
        height: 12px;
        font-size: 10px;
        color: var(--color-text-tertiary);
        white-space: nowrap;
      }
      .an-bar {
        width: 100%;
        min-height: 2px;
        border-radius: 4px 4px 0 0;
        background: linear-gradient(180deg, var(--color-caramel) 0%, #a0612a 100%);
      }
      .an-axis {
        display: flex;
        padding: 0 4px;
      }
      .an-axis span {
        flex: 1 1 0;
        min-width: 0;
        overflow: visible;
        text-align: center;
        white-space: nowrap;
        font-size: 10px;
        color: var(--color-text-tertiary);
      }
      .an-two {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
        gap: 16px;
      }
      .an-track {
        height: 6px;
        border-radius: 9999px;
        background: var(--color-surface-variant);
        overflow: hidden;
      }
      .an-track-thin {
        height: 4px;
        margin-top: 3px;
      }
      .an-fill {
        height: 100%;
        border-radius: 9999px;
        background: var(--color-caramel);
      }
      .an-fill-orders {
        background: var(--color-mint);
      }
      .an-share {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .an-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .an-key {
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-right: 6px;
        border-radius: 3px;
        background: var(--color-caramel);
        vertical-align: -1px;
      }
      .an-key-orders {
        background: var(--color-mint);
      }
    `,
  ],
})
export class AdminAnalyticsPage {
  private readonly api = inject(AnalyticsApi);
  private readonly catalog = inject(AdminCatalogApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  readonly plans = inject(PlanAccess);
  protected readonly fmt = inject(LocaleFormatService);

  readonly tabs = TABS;
  readonly tab = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((q) => {
        const t = q.get('tab') as Tab | null;
        return t && TABS.includes(t) ? t : 'overview';
      }),
    ),
    { initialValue: 'overview' as Tab },
  );

  readonly range = signal<DateRangeValue>({ days: 14 });
  readonly storeId = signal<string | null>(null);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly revenue = signal<RevenueSeries | null>(null);
  readonly topProducts = signal<TopProduct[]>([]);
  readonly cohort = signal<CohortStats | null>(null);
  readonly storeRows = signal<StorePerformance[]>([]);
  readonly staff = signal<StaffPerformance[]>([]);

  readonly storesDetailed = computed(() => this.storeRows().some((s) => s.detailed));

  readonly period = computed<AnalyticsPeriod>(() => ({ ...this.range(), storeId: this.storeId() }));
  readonly brandId = this.activeBrand.activeId;
  readonly currency = computed(() => this.activeBrand.active()?.currency);

  /** «за 14 дней» or «01.09 – 15.09», for the revenue caption. */
  readonly periodWords = computed(() => {
    const r = this.revenue();
    return { from: r ? this.fmt.dayMonth(r.from, 'UTC') : '', to: r ? this.fmt.dayMonth(r.to, 'UTC') : '' };
  });

  readonly bars = computed<ChartBar[]>(() => {
    const r = this.revenue();
    if (!r || r.points.length === 0) return [];
    const max = Math.max(...r.points.map((p) => p.revenueCents));
    // Every label on a week, about ten of them on a quarter.
    const every = Math.max(1, Math.ceil(r.points.length / 10));
    const best = r.bestDay;
    return r.points.map((p, i) => ({
      date: p.date,
      label: i % every === 0 ? this.fmt.shortDay(p.date, 'UTC') : '',
      sub: best && p.date === best.date && r.points.length <= 31 ? this.price(p.revenueCents, true) : '',
      height: max === 0 ? 0 : Math.round((p.revenueCents / max) * 100),
      title: `${this.fmt.dayMonth(p.date, 'UTC')}: ${this.price(p.revenueCents)} · ${p.orderCount}`,
    }));
  });
  readonly barGap = computed(() => (this.bars().length > 31 ? 1 : this.bars().length > 14 ? 3 : 6));

  constructor() {
    // Stores for the filter follow the brand picked in the header.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) return;
      untracked(() => {
        this.storeId.set(null);
        this.catalog.listStores(brandId).subscribe({ next: (list) => this.stores.set(list) });
      });
    });
    // Only the open tab is fetched, and again whenever its inputs change.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const tab = this.tab();
      const period = this.period();
      if (!brandId) return;
      untracked(() => this.fetch(tab, brandId, period));
    });
  }

  setTab(tab: Tab): void {
    void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  tabLocked(tab: Tab): boolean {
    if (tab === 'staff') return !this.plans.has('staffAnalytics');
    if (tab === 'retention') return !this.plans.has('winBack');
    return false;
  }

  productPercent(row: TopProduct): number {
    const max = Math.max(...this.topProducts().map((r) => r.revenueCents), 1);
    return Math.round((row.revenueCents / max) * 100);
  }

  price(cents: number, wholeUnits = false): string {
    return this.fmt.money(cents, this.activeBrand.active()?.currency, { round: wholeUnits });
  }

  abs(value: number): number {
    return Math.abs(value);
  }

  signedPercent(value: number | null): string {
    if (value === null) return '—';
    const arrow = value > 0 ? '▲ ' : value < 0 ? '▼ ' : '';
    return `${arrow}${this.fmt.percent(Math.abs(value))}`;
  }

  deltaColor(value: number | null): string {
    if (value === null || value === 0) return 'var(--color-text-tertiary)';
    return value > 0 ? '#3E8868' : 'var(--color-berry)';
  }

  /** «4 мин 30 с»; a dash without a sample. */
  duration(seconds: number | null): string {
    if (seconds === null) return '—';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    const min = this.translate.instant('common.units.min');
    const sec = this.translate.instant('common.units.sShort');
    if (m === 0) return `${s} ${sec}`;
    return s === 0 ? `${m} ${min}` : `${m} ${min} ${s} ${sec}`;
  }

  private fetch(tab: Tab, brandId: string, period: AnalyticsPeriod): void {
    switch (tab) {
      case 'overview':
        this.api.revenue(brandId, period).subscribe({ next: (r) => this.revenue.set(r) });
        if (this.plans.has('deepAnalytics')) {
          this.api.topProducts(brandId, period, 6).subscribe({ next: (p) => this.topProducts.set(p) });
          this.api.cohort(brandId, period).subscribe({ next: (c) => this.cohort.set(c) });
        }
        break;
      case 'stores':
        // The comparison is across stores: the store filter does not apply.
        this.api
          .storePerformance(brandId, { ...period, storeId: null })
          .subscribe({ next: (rows) => this.storeRows.set(rows) });
        break;
      case 'staff':
        if (this.plans.has('staffAnalytics')) {
          this.api.staff(brandId, period).subscribe({ next: (rows) => this.staff.set(rows) });
        }
        break;
      case 'retention':
        // The tab fetches its own figures.
        break;
    }
  }
}
