import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { BusinessOverview, OverviewRow, OverviewTotals } from '@takeaway/shared-types';
import type { Subscription } from 'rxjs';

import { AnalyticsApi, type AnalyticsPeriod, type OrderStatusStats } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { OrderAlertsService } from '../../core/kitchen/order-alerts.service';
import { AdminOrdersApi, type AdminOrderSummary } from '../../core/orders/orders.service';
import { type AdminRole, canAccess, canOnStores } from '../../core/permissions/permissions';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { DonutChartComponent } from '../../shared/charts/donut-chart.component';
import { KpiCardComponent } from '../../shared/charts/kpi-card.component';
import { MiniBarsComponent } from '../../shared/charts/mini-bars.component';
import { ShareBarsComponent, type ShareRow } from '../../shared/charts/share-bars.component';
import { SparklineComponent } from '../../shared/charts/sparkline.component';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import type { DateRangeValue } from '../../shared/date-range.component';
import { OrderStatusPanelComponent } from '../../shared/order-status-panel.component';
import { OverviewFormat, createSort, todayIn } from '../../shared/overview/overview-format.service';
import { OverviewHeaderComponent } from '../../shared/overview/overview-header.component';
import { OVERVIEW_STYLES } from '../../shared/overview/overview.styles';
import { PlanLockComponent } from '../../shared/plan-lock.component';
import { ChurnWidgetComponent } from './churn-widget.component';
import { MenuSummaryWidgetComponent } from './menu-summary-widget.component';
import { OnboardingChecklistComponent } from './onboarding-checklist.component';
import { StoreShiftsWidgetComponent } from './store-shifts-widget.component';
import { StoreTimezoneAlertComponent } from './store-timezone-alert.component';

type StoreSortKey = 'name' | 'orders' | 'ordersDelta' | 'revenue' | 'avgCheck' | 'customers' | 'cancelled' | 'pickup';

interface DashboardOrder {
  code: string;
  product: string;
  store: string;
  status: 'READY' | 'IN_PROGRESS' | 'ACCEPTED' | 'PAID';
  minutes: number;
}

/**
 * The business's home: the period against the one before it, its stores
 * side by side, and what is going on right now.
 *
 *   KPI cards with the period's days — revenue, orders, customers, check —
 *   and a row of smaller ones (new customers, cancellations, expired…)
 *   Revenue by store with share and change; order statuses
 *   Load by hour and weekday (PRO)
 *   Stores table, sortable; a row filters the whole page to that store
 *   Right now: kitchen window, live orders, shifts, lost customers, menu
 *
 * Every plan gets the KPIs, revenue and orders per store with shares and the
 * statuses; the per-store comparison and the load charts are PRO.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    OverviewHeaderComponent,
    KpiCardComponent,
    SparklineComponent,
    MiniBarsComponent,
    ShareBarsComponent,
    DonutChartComponent,
    BarChartComponent,
    PlanLockComponent,
    OnboardingChecklistComponent,
    OrderStatusPanelComponent,
    StoreTimezoneAlertComponent,
    StoreShiftsWidgetComponent,
    ChurnWidgetComponent,
    MenuSummaryWidgetComponent,
  ],
  template: `
    <section class="ov" [attr.aria-busy]="loading()">
      <app-overview-header
        [title]="'admin.overview.home' | translate"
        [period]="data()?.period ?? null"
        [loading]="loading()"
        [(range)]="range"
        (refresh)="reload()"
      >
        @if (storeOptions().length > 1) {
          <select
            class="ov-select"
            [attr.aria-label]="'admin.overview.storeFilter' | translate"
            (change)="pickStore($any($event.target).value || null)"
          >
            <option value="" [selected]="!storeId()">{{ 'admin.overview.allStores' | translate }}</option>
            @for (s of storeOptions(); track s.id) {
              <option [value]="s.id" [selected]="storeId() === s.id">{{ s.name }}</option>
            }
          </select>
        }
        @if (plans.has('promo')) {
          <a routerLink="/promo/new" class="ov-new-promo">{{ 'admin.dashboard.newPromo' | translate }}</a>
        }
      </app-overview-header>

      <!-- Open stores still on UTC: their hours are read hours off; hides itself when none -->
      <app-store-timezone-alert />

      <!-- Launch checklist: a new brand owner's next steps; hides itself once done -->
      <app-onboarding-checklist />

      @if (pickedStore(); as store) {
        <div class="ov-chip">
          <span>{{ 'admin.overview.filteredBy' | translate: { name: store.name } }}</span>
          <button type="button" [attr.aria-label]="'admin.overview.clearFilter' | translate" (click)="pickStore(null)">
            ×
          </button>
        </div>
      }

      @if (error() && !data()) {
        <article class="dash-card ov-state">
          <p class="dash-error">{{ 'admin.overview.loadError' | translate }}</p>
          <button type="button" class="dash-link ov-retry" (click)="reload()">
            {{ 'admin.overview.retry' | translate }}
          </button>
        </article>
      } @else if (data(); as d) {
        <div class="ov-kpis">
          <app-kpi-card
            [label]="'admin.overview.kpi.revenue' | translate"
            [value]="money(d.current.revenueCents)"
            [delta]="revenueDelta().delta"
            [deltaText]="revenueDelta().text"
            [hint]="revenueDelta().hint"
            [footLeft]="'admin.overview.foot.avgCheck' | translate: { value: money(d.current.avgCheckCents) }"
            [footRight]="'admin.overview.foot.previous' | translate: { value: money(d.previous.revenueCents) }"
          >
            <app-mini-bars
              kpiChart
              [values]="series().revenue"
              [tips]="tips().revenue"
              color="var(--chart-money)"
              [label]="'admin.overview.kpi.revenue' | translate"
            />
          </app-kpi-card>
          <app-kpi-card
            [label]="'admin.overview.kpi.orders' | translate"
            [value]="fmt.int(d.current.orders)"
            [delta]="ordersDelta().delta"
            [deltaText]="ordersDelta().text"
            [hint]="ordersDelta().hint"
            [footLeft]="
              'admin.overview.foot.perDay' | translate: { value: fmt.decimal(d.current.orders / d.period.days) }
            "
            [footRight]="
              'admin.overview.foot.lost' | translate: { value: fmt.int(d.current.cancelled + d.current.expired) }
            "
          >
            <app-sparkline
              kpiChart
              [values]="series().orders"
              [tips]="tips().orders"
              [height]="56"
              color="var(--chart-orders)"
              [label]="'admin.overview.kpi.orders' | translate"
            />
          </app-kpi-card>
          <app-kpi-card
            [label]="'admin.overview.kpi.customers' | translate"
            [value]="fmt.int(d.current.customers)"
            [delta]="customersDelta().delta"
            [deltaText]="customersDelta().text"
            [hint]="customersDelta().hint"
            [footLeft]="'admin.overview.foot.newCustomers' | translate: { value: fmt.int(d.current.newCustomers) }"
            [footRight]="'admin.overview.foot.repeat' | translate: { value: repeatShare(d.current) }"
          >
            <app-mini-bars
              kpiChart
              [values]="series().customers"
              [tips]="tips().customers"
              color="var(--chart-customers)"
              [label]="'admin.overview.kpi.customers' | translate"
            />
          </app-kpi-card>
          <app-kpi-card
            [label]="'admin.overview.kpi.avgCheck' | translate"
            [value]="money(d.current.avgCheckCents)"
            [delta]="checkDelta().delta"
            [deltaText]="checkDelta().text"
            [hint]="checkDelta().hint"
            [footLeft]="'admin.overview.foot.previousCheck' | translate: { value: money(d.previous.avgCheckCents) }"
            [footRight]="'admin.overview.foot.activeStores' | translate: { value: d.current.activeUnits }"
          >
            <app-sparkline
              kpiChart
              [values]="series().avgCheck"
              [tips]="tips().avgCheck"
              [zeroBased]="false"
              [height]="56"
              color="var(--chart-money)"
              [label]="'admin.overview.kpi.avgCheck' | translate"
            />
          </app-kpi-card>
        </div>

        <div class="ov-kpis-sm">
          <app-kpi-card
            size="sm"
            [label]="'admin.overview.kpi.newCustomers' | translate"
            [value]="fmt.int(d.current.newCustomers)"
            [delta]="newCustomersDelta().delta"
            [deltaText]="newCustomersDelta().text"
          >
            <app-sparkline
              kpiChart
              [values]="series().newCustomers"
              [tips]="tips().newCustomers"
              color="var(--chart-customers)"
              [label]="'admin.overview.kpi.newCustomers' | translate"
            />
          </app-kpi-card>
          <app-kpi-card
            size="sm"
            [label]="'admin.overview.kpi.cancelled' | translate"
            [value]="fmt.int(d.current.cancelled)"
            [invert]="true"
            [delta]="cancelledDelta().delta"
            [deltaText]="cancelledDelta().text"
          >
            <app-sparkline
              kpiChart
              [values]="series().cancelled"
              [tips]="tips().cancelled"
              color="var(--chart-negative)"
              [label]="'admin.overview.kpi.cancelled' | translate"
            />
          </app-kpi-card>
          <app-kpi-card
            size="sm"
            [label]="'admin.overview.kpi.cancelRate' | translate"
            [value]="fmt.percent(d.current.cancelRatePercent)"
            [invert]="true"
            [delta]="cancelRateDelta().delta"
            [deltaText]="cancelRateDelta().text"
            [hint]="'admin.overview.cancelRateHint' | translate"
          />
          <app-kpi-card
            size="sm"
            [label]="'admin.overview.kpi.expired' | translate"
            [value]="fmt.int(d.current.expired)"
            [invert]="true"
            [delta]="expiredDelta().delta"
            [deltaText]="expiredDelta().text"
          >
            <app-mini-bars
              kpiChart
              [values]="series().expired"
              [tips]="tips().expired"
              [height]="40"
              color="var(--chart-warning)"
              [label]="'admin.overview.kpi.expired' | translate"
            />
          </app-kpi-card>
          <app-kpi-card
            size="sm"
            [label]="'admin.overview.kpi.revenuePerDay' | translate"
            [value]="money(d.current.revenueCents / d.period.days)"
            [delta]="revenueDelta().delta"
            [deltaText]="revenueDelta().text"
          >
            <app-sparkline
              kpiChart
              [values]="series().revenue"
              [tips]="tips().revenue"
              color="var(--chart-money)"
              [label]="'admin.overview.kpi.revenuePerDay' | translate"
            />
          </app-kpi-card>
        </div>

        @if (d.current.placed + d.previous.placed === 0) {
          <article class="dash-card ov-state">
            <h2 class="ov-empty-title">{{ 'admin.overview.empty.title' | translate }}</h2>
            <p class="dash-muted">{{ 'admin.overview.empty.body' | translate }}</p>
          </article>
        } @else {
          <div class="ov-panels">
            <article class="dash-card">
              <header class="dash-card-head">
                <h2>{{ 'admin.overview.byStore' | translate }}</h2>
                <span class="ov-hint">{{ 'admin.overview.byStoreHint' | translate }}</span>
              </header>
              <app-share-bars
                [rows]="shareRows()"
                [compare]="d.storeComparison"
                [format]="moneyFn"
                [percent]="percentFn"
                [text]="shareText()"
                [picked]="storeId()"
                (pick)="pickStore($event)"
              />
            </article>
            <article class="dash-card">
              <header class="dash-card-head">
                <h2>{{ 'admin.overview.statuses.title' | translate }}</h2>
              </header>
              <app-donut-chart
                [slices]="statusSlices()"
                [centerLabel]="'admin.overview.statuses.total' | translate"
                [label]="'admin.overview.statuses.label' | translate"
                [percent]="percentFn"
              />
            </article>
          </div>

          @if (d.byHour && d.byWeekday) {
            <div class="ov-panels ov-panels-even">
              <article class="dash-card">
                <header class="dash-card-head">
                  <h2>{{ 'admin.overview.hours.title' | translate }}</h2>
                  <span class="ov-hint">{{ 'admin.overview.hours.hint' | translate: hourRange() }}</span>
                </header>
                <app-bar-chart [items]="hourItems()" [label]="'admin.overview.hours.title' | translate" />
              </article>
              <article class="dash-card">
                <header class="dash-card-head">
                  <h2>{{ 'admin.overview.weekdays.title' | translate }}</h2>
                  <span class="ov-hint">{{ 'admin.overview.weekdays.hint' | translate }}</span>
                </header>
                <app-bar-chart
                  [items]="weekdayItems()"
                  color="var(--chart-orders)"
                  [label]="'admin.overview.weekdays.title' | translate"
                />
              </article>
            </div>
          } @else {
            <article class="dash-card">
              <header class="dash-card-head">
                <h2>
                  {{ 'admin.overview.hours.title' | translate }} · {{ 'admin.overview.weekdays.title' | translate }}
                </h2>
              </header>
              <app-plan-lock feature="deepAnalytics" />
            </article>
          }

          <article class="dash-card ov-table-card">
            <header class="dash-card-head">
              <h2>
                {{ 'admin.overview.table.stores' | translate }}<span class="ov-count">{{ d.byStore.length }}</span>
              </h2>
              @if (d.byStore.length > 3) {
                <input
                  class="ov-search"
                  type="search"
                  [placeholder]="'admin.overview.table.searchStore' | translate"
                  [attr.aria-label]="'admin.overview.table.searchStore' | translate"
                  [value]="query()"
                  (input)="query.set($any($event.target).value)"
                />
              }
            </header>
            <div class="ov-table-wrap">
              <table class="ov-table">
                <thead>
                  <tr>
                    @for (c of columns(); track c.key) {
                      <th scope="col" [attr.aria-sort]="ariaSort(c.key)">
                        <button type="button" (click)="sort.toggle(c.key)">
                          {{ c.label | translate }}{{ sortMark(c.key) }}
                        </button>
                      </th>
                    }
                    @if (!d.storeComparison) {
                      <th scope="col">{{ 'admin.overview.cols.share' | translate }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (s of storeTable(); track s.id) {
                    <tr
                      tabindex="0"
                      [class.is-picked]="storeId() === s.id"
                      [attr.aria-selected]="storeId() === s.id"
                      (click)="pickStore(s.id)"
                      (keydown.enter)="pickStore(s.id)"
                    >
                      <td class="ov-name" [class.is-sorted]="sort.key() === 'name'">{{ s.name }}</td>
                      <td [class.is-sorted]="sort.key() === 'orders'">{{ fmt.int(s.orders) }}</td>
                      @if (s.detailed) {
                        <td
                          [class.is-sorted]="sort.key() === 'ordersDelta'"
                          [class.ov-pos]="ordersDiff(s) > 0"
                          [class.ov-neg]="ordersDiff(s) < 0"
                        >
                          {{ fmt.signedInt(ordersDiff(s)) }}
                        </td>
                      }
                      <td [class.is-sorted]="sort.key() === 'revenue'">{{ money(s.revenueCents) }}</td>
                      @if (s.detailed) {
                        <td [class.is-sorted]="sort.key() === 'avgCheck'">{{ money(s.avgCheckCents) }}</td>
                        <td [class.is-sorted]="sort.key() === 'customers'">{{ fmt.int(s.customers ?? 0) }}</td>
                        <td [class.is-sorted]="sort.key() === 'cancelled'">
                          {{ fmt.int((s.cancelled ?? 0) + (s.expired ?? 0)) }}
                          @if (s.cancelRatePercent) {
                            <span class="ov-muted-cell">· {{ fmt.percent(s.cancelRatePercent) }}</span>
                          }
                        </td>
                        <td [class.is-sorted]="sort.key() === 'pickup'">{{ fmt.duration(s.avgPickupSeconds) }}</td>
                      } @else {
                        <td>{{ fmt.percent(s.sharePercent) }}</td>
                      }
                    </tr>
                  } @empty {
                    <tr>
                      <td class="ov-empty-row" [attr.colspan]="columns().length + 1">
                        {{ 'admin.overview.table.empty' | translate }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (!d.storeComparison && d.byStore.length > 0) {
              <app-plan-lock feature="storeComparison" [compact]="true" />
            }
          </article>
        }
      } @else {
        <article class="dash-card ov-state">
          <p class="dash-muted">{{ 'admin.overview.loading' | translate }}</p>
        </article>
      }

      <h2 class="ov-section-title">{{ 'admin.overview.operations' | translate }}</h2>

      <!-- Kitchen window: open orders now, and how the period ended up -->
      <app-order-status-panel
        [stats]="statuses()"
        [days]="data()?.period?.days ?? 30"
        [kitchenLink]="canSeeKitchen()"
      />

      @if (activeBrand.activeId(); as brandId) {
        <div class="dashboard-widgets grid" style="gap: 16px">
          <article class="dash-card">
            <header class="dash-card-head">
              <h2>{{ 'admin.dashboard.liveOrders' | translate }}</h2>
              <a [routerLink]="canSeeKitchen() ? '/kitchen' : '/orders'">{{
                (canSeeKitchen() ? 'admin.dashboard.openKitchen' : 'admin.dashboard.viewAll') | translate
              }}</a>
            </header>
            <div class="flex flex-col" style="gap: 8px">
              @for (o of liveOrders(); track o.code) {
                <div class="live-row">
                  <span class="live-code">{{ o.code }}</span>
                  <div class="flex flex-col" style="gap: 2px; min-width: 0; flex: 1">
                    <span class="live-product">{{ o.product }}</span>
                    <span class="live-store">{{ o.store }}</span>
                  </div>
                  <div class="flex flex-col items-end" style="gap: 4px">
                    <span class="live-status" [attr.data-status]="o.status">{{
                      statusLabel(o.status) | translate
                    }}</span>
                    <span class="live-store">⏱ {{ o.minutes }} {{ 'common.units.min' | translate }}</span>
                  </div>
                </div>
              } @empty {
                <p class="dash-muted">{{ 'admin.dashboard.noLiveOrders' | translate }}</p>
              }
            </div>
          </article>
          <app-store-shifts-widget [brandId]="brandId" [canToggle]="canToggleShifts()" />
          <app-churn-widget [brandId]="brandId" [period]="period()" [currency]="currency()" />
          @if (canSeeMenu()) {
            <app-menu-summary-widget [brandId]="brandId" />
          }
        </div>
      }
    </section>
  `,
  styles: [
    DASH_CARD_STYLES,
    OVERVIEW_STYLES,
    `
      .ov-new-promo {
        display: inline-flex;
        align-items: center;
        height: 32px;
        padding: 0 14px;
        background: var(--color-caramel);
        color: white;
        border-radius: var(--radius-button);
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
      }
      .ov-empty-title {
        margin: 0 0 6px;
        font-family: var(--font-display);
        font-size: 18px;
        color: var(--color-espresso);
      }
      .ov-retry {
        margin-top: 8px;
        border: 0;
        background: none;
        cursor: pointer;
      }
      .dashboard-widgets {
        grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
      }
      /* Grid items default to min-width: auto — a long value in one widget
         would otherwise widen its track past the row. */
      .dashboard-widgets > * {
        min-width: 0;
      }
      .live-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
      }
      .live-code {
        flex: none;
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 700;
      }
      .live-product {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
      }
      .live-store {
        font-size: 12px;
        color: var(--color-text-tertiary);
        white-space: nowrap;
      }
      .live-status {
        padding: 3px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
        background: var(--color-surface-variant);
        color: var(--color-text-secondary);
      }
      .live-status[data-status='READY'] {
        background: color-mix(in srgb, var(--chart-customers) 18%, transparent);
        color: var(--color-positive);
      }
      .live-status[data-status='IN_PROGRESS'] {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
      }
      .live-status[data-status='ACCEPTED'] {
        background: color-mix(in srgb, var(--chart-warning) 18%, transparent);
        color: var(--chart-warning);
      }
    `,
  ],
})
export class DashboardPage {
  private readonly auth = inject(AuthStore);
  readonly activeBrand = inject(ActiveBrandService);
  readonly plans = inject(PlanAccess);
  readonly fmt = inject(OverviewFormat);
  private readonly analytics = inject(AnalyticsApi);
  private readonly orders = inject(AdminOrdersApi);
  private readonly alerts = inject(OrderAlertsService);
  private readonly translate = inject(TranslateService);

  /** The period every figure on the page covers. */
  readonly range = signal<DateRangeValue>({ days: 30 });
  /** The store the page is narrowed to; null for all of them. */
  readonly storeId = signal<string | null>(null);
  readonly period = computed<AnalyticsPeriod>(() => ({ ...this.range(), storeId: this.storeId() }));

  readonly data = signal<BusinessOverview | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly statuses = signal<OrderStatusStats | null>(null);
  readonly liveRaw = signal<AdminOrderSummary[]>([]);
  /** Every store in scope, from the last unfiltered answer — the selector's options. */
  readonly storeOptions = signal<Array<{ id: string; name: string }>>([]);
  readonly query = signal('');
  readonly sort = createSort<StoreSortKey>('revenue');
  private request: Subscription | null = null;
  private readonly reloadTick = signal(0);

  private readonly role = computed(() => this.auth.user()?.role as AdminRole | undefined);
  readonly canSeeKitchen = computed(() => canAccess(this.role(), 'kitchen'));
  readonly canSeeMenu = computed(() => canAccess(this.role(), 'menu'));
  readonly canToggleShifts = computed(() => canOnStores(this.role(), 'edit'));
  readonly currency = computed(() => this.activeBrand.active()?.currency ?? null);

  readonly moneyFn = (cents: number) => this.money(cents);
  // Whole percents, but a sliver still reads as more than nothing.
  readonly percentFn = (v: number) => this.fmt.percent(v, v > 0 && v < 1 ? 1 : 0);
  readonly shareText = computed(() => {
    this.fmt.lang();
    return this.fmt.shareText();
  });

  readonly pickedStore = computed(() => {
    const id = this.storeId();
    return id ? (this.storeOptions().find((s) => s.id === id) ?? null) : null;
  });

  readonly revenueDelta = computed(() => this.kpiDelta((t) => t.revenueCents));
  readonly ordersDelta = computed(() => this.kpiDelta((t) => t.orders));
  readonly customersDelta = computed(() => this.kpiDelta((t) => t.customers));
  readonly checkDelta = computed(() => this.kpiDelta((t) => t.avgCheckCents));
  readonly newCustomersDelta = computed(() => this.kpiDelta((t) => t.newCustomers));
  readonly cancelledDelta = computed(() => this.kpiDelta((t) => t.cancelled));
  readonly expiredDelta = computed(() => this.kpiDelta((t) => t.expired));
  readonly cancelRateDelta = computed(() => {
    const d = this.data();
    return this.fmt.pointsDelta(d?.current.cancelRatePercent ?? null, d?.previous.cancelRatePercent ?? null);
  });

  /** The period's days as plain series, one per KPI chart. */
  readonly series = computed(() => {
    const days = this.data()?.daily ?? [];
    return {
      revenue: days.map((d) => d.revenueCents),
      orders: days.map((d) => d.orders),
      customers: days.map((d) => d.customers),
      newCustomers: days.map((d) => d.newCustomers),
      cancelled: days.map((d) => d.cancelled),
      expired: days.map((d) => d.expired),
      avgCheck: days.map((d) => (d.orders ? d.revenueCents / d.orders : 0)),
    };
  });

  /** Hover cards for the KPI charts, one per day. */
  readonly tips = computed(() => {
    const data = this.data();
    this.fmt.lang();
    const days = data?.daily ?? [];
    const today = data ? todayIn(data.period.timeZone) : '';
    const s = this.series();
    const t = (key: string) => this.fmt.t(`tip.${key}`);
    const vsDay = (values: number[]) => this.fmt.vsAverage(values, t('vsAverageDay'));
    const revenueVs = vsDay(s.revenue);
    const ordersVs = vsDay(s.orders);
    const customersVs = vsDay(s.customers);
    return {
      revenue: this.fmt.dailyTips(
        days,
        (d, i) => [
          { label: t('revenue'), value: this.money(d.revenueCents), color: 'var(--chart-money)', strong: true },
          { label: t('orders'), value: this.fmt.int(d.orders) },
          d.orders > 0 && { label: t('avgCheck'), value: this.money(d.revenueCents / d.orders) },
          revenueVs(i),
        ],
        today,
      ),
      orders: this.fmt.dailyTips(
        days,
        (d, i) => [
          { label: t('orders'), value: this.fmt.int(d.orders), color: 'var(--chart-orders)', strong: true },
          { label: t('cancelled'), value: this.fmt.int(d.cancelled) },
          { label: t('expired'), value: this.fmt.int(d.expired) },
          { label: t('revenue'), value: this.money(d.revenueCents) },
          ordersVs(i),
        ],
        today,
      ),
      customers: this.fmt.dailyTips(
        days,
        (d, i) => [
          { label: t('customers'), value: this.fmt.int(d.customers), color: 'var(--chart-customers)', strong: true },
          { label: t('newCustomers'), value: this.fmt.int(d.newCustomers) },
          customersVs(i),
        ],
        today,
      ),
      newCustomers: this.fmt.dailyTips(
        days,
        (d) => [
          {
            label: t('newCustomers'),
            value: this.fmt.int(d.newCustomers),
            color: 'var(--chart-customers)',
            strong: true,
          },
          { label: t('customers'), value: this.fmt.int(d.customers) },
        ],
        today,
      ),
      avgCheck: this.fmt.dailyTips(
        days,
        (d) => [
          {
            label: t('avgCheck'),
            value: d.orders ? this.money(d.revenueCents / d.orders) : '—',
            color: 'var(--chart-money)',
            strong: true,
          },
          { label: t('orders'), value: this.fmt.int(d.orders) },
          { label: t('revenue'), value: this.money(d.revenueCents) },
        ],
        today,
      ),
      cancelled: this.fmt.dailyTips(
        days,
        (d) => [
          { label: t('cancelled'), value: this.fmt.int(d.cancelled), color: 'var(--chart-negative)', strong: true },
          { label: t('orders'), value: this.fmt.int(d.orders) },
        ],
        today,
      ),
      expired: this.fmt.dailyTips(
        days,
        (d) => [
          { label: t('expired'), value: this.fmt.int(d.expired), color: 'var(--chart-warning)', strong: true },
          { label: t('orders'), value: this.fmt.int(d.orders) },
        ],
        today,
      ),
    };
  });

  readonly shareRows = computed<ShareRow[]>(() =>
    (this.data()?.byStore ?? []).map((s) => ({
      key: s.id,
      name: s.name,
      value: s.revenueCents,
      share: s.sharePercent,
      previous: s.detailed ? s.previousRevenueCents : null,
      extra: [
        { label: this.fmt.t('tip.orders'), value: this.fmt.int(s.orders) },
        s.detailed &&
          s.avgCheckCents !== null && { label: this.fmt.t('tip.avgCheck'), value: this.money(s.avgCheckCents) },
      ],
    })),
  );

  readonly statusSlices = computed(() => {
    this.fmt.lang();
    return this.fmt.statusSlices(this.data()?.statuses);
  });
  readonly hourItems = computed(() => this.fmt.hourItems(this.data()?.byHour ?? [], this.currency()));
  readonly hourRange = computed(() => this.fmt.hourRange(this.data()?.byHour ?? []));
  readonly weekdayItems = computed(() => this.fmt.weekdayItems(this.data()?.byWeekday ?? [], this.currency()));

  readonly columns = computed(() => {
    const detailed = this.data()?.storeComparison ?? false;
    const all: Array<{ key: StoreSortKey; label: string; pro: boolean }> = [
      { key: 'name', label: 'admin.overview.cols.store', pro: false },
      { key: 'orders', label: 'admin.overview.cols.orders', pro: false },
      { key: 'ordersDelta', label: 'admin.overview.cols.ordersDelta', pro: true },
      { key: 'revenue', label: 'admin.overview.cols.revenue', pro: false },
      { key: 'avgCheck', label: 'admin.overview.cols.avgCheck', pro: true },
      { key: 'customers', label: 'admin.overview.cols.customers', pro: true },
      { key: 'cancelled', label: 'admin.overview.cols.cancelled', pro: true },
      { key: 'pickup', label: 'admin.overview.cols.pickup', pro: true },
    ];
    return all.filter((c) => detailed || !c.pro);
  });

  readonly storeTable = computed(() => {
    const q = this.query().trim().toLowerCase();
    const rows = (this.data()?.byStore ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));
    return this.sort.apply(rows, (s, k) => {
      switch (k) {
        case 'name':
          return s.name;
        case 'orders':
          return s.orders;
        case 'ordersDelta':
          return this.ordersDiff(s);
        case 'revenue':
          return s.revenueCents;
        case 'avgCheck':
          return s.avgCheckCents;
        case 'customers':
          return s.customers;
        case 'cancelled':
          return (s.cancelled ?? 0) + (s.expired ?? 0);
        case 'pickup':
          return s.avgPickupSeconds;
      }
    });
  });

  readonly liveOrders = computed<DashboardOrder[]>(() =>
    this.liveRaw()
      .slice(0, 5)
      .map((o) => ({
        code: o.orderCode,
        product: this.translate.instant('admin.dashboard.orderProductLine', { count: o.itemCount }),
        store: o.storeName,
        status: (['READY', 'IN_PROGRESS', 'ACCEPTED'].includes(o.status)
          ? o.status
          : 'PAID') as DashboardOrder['status'],
        minutes: Math.max(0, Math.round((new Date(o.pickupAt).getTime() - Date.now()) / 60_000)),
      })),
  );

  constructor() {
    // A different brand in the header is a different set of stores.
    effect(() => {
      this.activeBrand.activeId();
      untracked(() => {
        this.storeId.set(null);
        this.storeOptions.set([]);
        this.data.set(null);
      });
    });
    // The overview follows the brand, the period, the store and the refresh button.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const period = this.period();
      this.reloadTick();
      if (!brandId) return;
      untracked(() => this.load(brandId, period));
    });
    // Live figures follow the kitchen feed: every order change in the
    // brand's stores re-reads them, so the page never needs a refresh.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const period = this.period();
      this.alerts.revision();
      this.reloadTick();
      if (!brandId) return;
      untracked(() => {
        this.orders.list({ take: 10, brandId }).subscribe({
          next: (list) =>
            this.liveRaw.set(list.filter((o) => !['PICKED_UP', 'CANCELLED', 'EXPIRED'].includes(o.status))),
        });
        this.analytics.orderStatuses(brandId, period).subscribe({ next: (stats) => this.statuses.set(stats) });
      });
    });
  }

  reload(): void {
    this.reloadTick.update((n) => n + 1);
  }

  /** Narrows the page to one store; the same store again, or null, shows them all. */
  pickStore(id: string | null): void {
    this.storeId.set(id && id !== this.storeId() ? id : null);
  }

  money(cents: number | null | undefined): string {
    return this.fmt.money(cents, this.currency());
  }

  /** Customers who had ordered before the period, among its customers. */
  repeatShare(t: OverviewTotals): string {
    if (t.customers === 0) return '—';
    return this.fmt.percent((Math.max(0, t.customers - t.newCustomers) / t.customers) * 100, 0);
  }

  ordersDiff(s: OverviewRow): number {
    return s.orders - (s.previousOrders ?? s.orders);
  }

  ariaSort(key: StoreSortKey): 'ascending' | 'descending' | null {
    if (this.sort.key() !== key) return null;
    return this.sort.desc() ? 'descending' : 'ascending';
  }

  sortMark(key: StoreSortKey): string {
    if (this.sort.key() !== key) return '';
    return this.sort.desc() ? ' ↓' : ' ↑';
  }

  /** Returns a translation key; translated in the template with | translate. */
  statusLabel(status: DashboardOrder['status']): string {
    return `admin.orders.status.${status}`;
  }

  private load(brandId: string, period: AnalyticsPeriod): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(false);
    this.request = this.analytics.overview(brandId, period).subscribe({
      next: (data) => {
        this.data.set(data);
        if (!period.storeId) this.storeOptions.set(data.byStore.map((s) => ({ id: s.id, name: s.name })));
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  private kpiDelta(pick: (t: OverviewTotals) => number | null) {
    const d = this.data();
    this.fmt.lang();
    if (!d) return { delta: null, text: '', hint: '' };
    return this.fmt.delta(pick(d.current), pick(d.previous));
  }
}
