import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { OverviewTotals, PlatformBrandRow, PlatformOverview } from '@takeaway/shared-types';
import { type Subscription, interval } from 'rxjs';

import { AnalyticsApi, type AnalyticsPeriod, type OrderStatusStats } from '../../core/analytics/analytics.service';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { BrandsService } from '../../core/brands/brands.service';
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

type BrandSortKey =
  | 'name'
  | 'orders'
  | 'ordersDelta'
  | 'revenue'
  | 'avgCheck'
  | 'customers'
  | 'cancelled'
  | 'stores'
  | 'plan'
  | 'commission';

const COLUMNS: ReadonlyArray<{ key: BrandSortKey; label: string }> = [
  { key: 'name', label: 'admin.overview.cols.brand' },
  { key: 'orders', label: 'admin.overview.cols.orders' },
  { key: 'ordersDelta', label: 'admin.overview.cols.ordersDelta' },
  { key: 'revenue', label: 'admin.overview.cols.revenue' },
  { key: 'avgCheck', label: 'admin.overview.cols.avgCheck' },
  { key: 'customers', label: 'admin.overview.cols.customers' },
  { key: 'cancelled', label: 'admin.overview.cols.cancelled' },
  { key: 'stores', label: 'admin.overview.cols.stores' },
  { key: 'plan', label: 'admin.overview.cols.plan' },
  { key: 'commission', label: 'admin.overview.cols.commission' },
];

/** The platform view has no socket of its own; this keeps "right now" fresh. */
const REFRESH_MS = 60_000;

/**
 * "Whole project" — the platform admin's dashboard: every business side by
 * side over the period against the one before, with the commission each
 * brought in. Opening a business switches the header's brand and shows its
 * dashboard exactly as its owner sees it.
 */
@Component({
  selector: 'app-platform',
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
    OrderStatusPanelComponent,
  ],
  template: `
    <section class="ov" [attr.aria-busy]="loading()">
      <app-overview-header
        [title]="'admin.platform.title' | translate"
        [period]="data()?.period ?? null"
        [loading]="loading()"
        [(range)]="range"
        (refresh)="reload()"
      >
        @if ((data()?.currencies?.length ?? 0) > 1) {
          <select
            class="ov-select"
            [attr.aria-label]="'admin.overview.currency' | translate"
            (change)="currency.set($any($event.target).value)"
          >
            @for (c of data()?.currencies ?? []; track c) {
              <option [value]="c" [selected]="c === data()?.currency">{{ c }}</option>
            }
          </select>
        }
      </app-overview-header>

      @if (pending(); as count) {
        <a routerLink="/brands" class="plat-pending">
          {{ 'admin.platform.pending' | translate: { count: count } }} · {{ 'admin.platform.review' | translate }}
        </a>
      }
      @if ((data()?.currencies?.length ?? 0) > 1) {
        <p class="dash-hint">{{ 'admin.overview.currencyNote' | translate: { currency: data()?.currency } }}</p>
      }

      @if (error() && !data()) {
        <article class="dash-card ov-state">
          <p class="dash-error">{{ 'admin.overview.loadError' | translate }}</p>
        </article>
      } @else if (data(); as d) {
        <div class="ov-kpis">
          <app-kpi-card
            [label]="'admin.overview.kpi.revenue' | translate"
            [value]="money(d.current.revenueCents)"
            [delta]="deltas().revenue.delta"
            [deltaText]="deltas().revenue.text"
            [hint]="deltas().revenue.hint"
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
            [delta]="deltas().orders.delta"
            [deltaText]="deltas().orders.text"
            [hint]="deltas().orders.hint"
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
            [delta]="deltas().customers.delta"
            [deltaText]="deltas().customers.text"
            [hint]="deltas().customers.hint"
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
            [label]="'admin.overview.kpi.commission' | translate"
            [value]="money(d.current.commissionCents)"
            [delta]="deltas().commission.delta"
            [deltaText]="deltas().commission.text"
            [hint]="deltas().commission.hint"
            [footLeft]="'admin.overview.foot.commissionRate' | translate: { value: commissionRate(d.current) }"
            [footRight]="'admin.overview.foot.previous' | translate: { value: money(d.previous.commissionCents) }"
          >
            <app-sparkline
              kpiChart
              [values]="series().commission"
              [tips]="tips().commission"
              [height]="56"
              color="var(--chart-money)"
              [label]="'admin.overview.kpi.commission' | translate"
            />
          </app-kpi-card>
        </div>

        <div class="ov-kpis-sm">
          <app-kpi-card
            size="sm"
            [label]="'admin.overview.kpi.avgCheck' | translate"
            [value]="money(d.current.avgCheckCents)"
            [delta]="deltas().avgCheck.delta"
            [deltaText]="deltas().avgCheck.text"
          />
          <app-kpi-card
            size="sm"
            [label]="'admin.overview.kpi.newCustomers' | translate"
            [value]="fmt.int(d.current.newCustomers)"
            [delta]="deltas().newCustomers.delta"
            [deltaText]="deltas().newCustomers.text"
          >
            <app-sparkline
              kpiChart
              [values]="series().newCustomers"
              color="var(--chart-customers)"
              [label]="'admin.overview.kpi.newCustomers' | translate"
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
            [delta]="deltas().expired.delta"
            [deltaText]="deltas().expired.text"
          >
            <app-mini-bars
              kpiChart
              [values]="series().expired"
              [height]="40"
              color="var(--chart-warning)"
              [label]="'admin.overview.kpi.expired' | translate"
            />
          </app-kpi-card>
          <app-kpi-card
            size="sm"
            [label]="'admin.overview.kpi.activeBrands' | translate"
            [value]="fmt.int(d.current.activeUnits) + ' / ' + fmt.int(d.byBrand.length)"
            [delta]="deltas().active.delta"
            [deltaText]="deltas().active.text"
          />
        </div>

        <div class="ov-panels">
          <article class="dash-card">
            <header class="dash-card-head">
              <h2>{{ 'admin.overview.byBrand' | translate }}</h2>
              <span class="ov-hint">{{ 'admin.overview.byBrandHint' | translate }}</span>
            </header>
            <app-share-bars
              [rows]="shareRows()"
              [compare]="true"
              [format]="moneyFn"
              [percent]="percentFn"
              [text]="shareText()"
              (pick)="openAsOwner($event)"
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
            <app-bar-chart [items]="weekdayItems()" [label]="'admin.overview.weekdays.title' | translate" />
          </article>
        </div>

        <article class="dash-card">
          <header class="dash-card-head">
            <h2>
              {{ 'admin.overview.table.brands' | translate }}<span class="ov-count">{{ d.byBrand.length }}</span>
            </h2>
            <input
              class="ov-search"
              type="search"
              [placeholder]="'admin.overview.table.searchBrand' | translate"
              [attr.aria-label]="'admin.overview.table.searchBrand' | translate"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />
          </header>
          <div class="ov-table-wrap">
            <table class="ov-table">
              <thead>
                <tr>
                  @for (c of columns; track c.key) {
                    <th scope="col" [attr.aria-sort]="ariaSort(c.key)">
                      <button type="button" (click)="sort.toggle(c.key)">
                        {{ c.label | translate }}{{ sortMark(c.key) }}
                      </button>
                    </th>
                  }
                  <th scope="col">
                    <span class="sr-only-table">{{ 'admin.platform.open' | translate }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (b of brandTable(); track b.id) {
                  <tr tabindex="0" (click)="openAsOwner(b.id)" (keydown.enter)="openAsOwner(b.id)">
                    <td class="ov-name" [class.is-sorted]="sort.key() === 'name'">
                      {{ b.name }}
                      <span class="ov-sub">
                        <span class="plat-badge" [attr.data-status]="b.moderationStatus">{{
                          'admin.brands.status.' + b.moderationStatus | translate
                        }}</span>
                      </span>
                    </td>
                    <td [class.is-sorted]="sort.key() === 'orders'">{{ fmt.int(b.orders) }}</td>
                    <td
                      [class.is-sorted]="sort.key() === 'ordersDelta'"
                      [class.ov-pos]="ordersDiff(b) > 0"
                      [class.ov-neg]="ordersDiff(b) < 0"
                    >
                      {{ fmt.signedInt(ordersDiff(b)) }}
                    </td>
                    <td [class.is-sorted]="sort.key() === 'revenue'">{{ money(b.revenueCents) }}</td>
                    <td [class.is-sorted]="sort.key() === 'avgCheck'">{{ money(b.avgCheckCents) }}</td>
                    <td [class.is-sorted]="sort.key() === 'customers'">{{ fmt.int(b.customers ?? 0) }}</td>
                    <td [class.is-sorted]="sort.key() === 'cancelled'">
                      {{ fmt.int((b.cancelled ?? 0) + (b.expired ?? 0)) }}
                    </td>
                    <td [class.is-sorted]="sort.key() === 'stores'">{{ b.stores }}</td>
                    <td [class.is-sorted]="sort.key() === 'plan'">
                      {{ 'admin.plans.names.' + b.plan | translate }}
                      <span class="ov-muted-cell">· {{ fmt.decimal(b.commissionBps / 100) }} %</span>
                    </td>
                    <td [class.is-sorted]="sort.key() === 'commission'">{{ money(b.commissionCents) }}</td>
                    <td>
                      <button type="button" class="plat-open" (click)="$event.stopPropagation(); openAsOwner(b.id)">
                        {{ 'admin.platform.open' | translate }}
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td class="ov-empty-row" [attr.colspan]="columns.length + 1">
                      {{ (d.byBrand.length ? 'admin.overview.table.empty' : 'admin.platform.empty') | translate }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </article>
      } @else {
        <article class="dash-card ov-state">
          <p class="dash-muted">{{ 'admin.overview.loading' | translate }}</p>
        </article>
      }

      <h2 class="ov-section-title">{{ 'admin.overview.operations' | translate }}</h2>
      <app-order-status-panel [stats]="statuses()" [days]="data()?.period?.days ?? 30" />
    </section>
  `,
  styles: [
    DASH_CARD_STYLES,
    OVERVIEW_STYLES,
    `
      .plat-pending {
        align-self: flex-start;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-caramel);
      }
      .plat-badge {
        display: inline-block;
        margin-top: 2px;
        padding: 1px 8px;
        border-radius: 9999px;
        font-size: 10px;
        font-weight: 700;
        background: var(--color-surface-variant);
        color: var(--color-text-secondary);
      }
      .plat-badge[data-status='APPROVED'] {
        background: color-mix(in srgb, var(--chart-customers) 18%, transparent);
        color: var(--color-positive);
      }
      .plat-badge[data-status='PENDING'] {
        background: color-mix(in srgb, var(--chart-warning) 18%, transparent);
        color: var(--chart-warning);
      }
      .plat-open {
        height: 30px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid var(--color-caramel);
        background: transparent;
        color: var(--color-caramel);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
    `,
  ],
})
export class PlatformPage {
  private readonly analytics = inject(AnalyticsApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly brandsApi = inject(BrandsService);
  private readonly router = inject(Router);
  readonly fmt = inject(OverviewFormat);

  readonly range = signal<DateRangeValue>({ days: 30 });
  /** The currency picked in the header; null lets the API choose. */
  readonly currency = signal<string | null>(null);
  readonly data = signal<PlatformOverview | null>(null);
  readonly statuses = signal<OrderStatusStats | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly query = signal('');
  readonly sort = createSort<BrandSortKey>('revenue');
  readonly columns = COLUMNS;
  private readonly tick = signal(0);
  private request: Subscription | null = null;

  readonly pending = computed(() => this.brandsApi.pendingCount() ?? 0);
  readonly moneyFn = (cents: number) => this.money(cents);
  // Whole percents, but a sliver still reads as more than nothing.
  readonly percentFn = (v: number) => this.fmt.percent(v, v > 0 && v < 1 ? 1 : 0);
  readonly shareText = computed(() => {
    this.fmt.lang();
    return this.fmt.shareText();
  });

  readonly deltas = computed(() => {
    const d = this.data();
    this.fmt.lang();
    const pick = (f: (t: OverviewTotals) => number | null) =>
      d ? this.fmt.delta(f(d.current), f(d.previous)) : { delta: null, text: '', hint: '' };
    return {
      revenue: pick((t) => t.revenueCents),
      orders: pick((t) => t.orders),
      customers: pick((t) => t.customers),
      commission: pick((t) => t.commissionCents),
      avgCheck: pick((t) => t.avgCheckCents),
      newCustomers: pick((t) => t.newCustomers),
      expired: pick((t) => t.expired),
      active: pick((t) => t.activeUnits),
    };
  });
  readonly cancelRateDelta = computed(() => {
    const d = this.data();
    return this.fmt.pointsDelta(d?.current.cancelRatePercent ?? null, d?.previous.cancelRatePercent ?? null);
  });

  readonly series = computed(() => {
    const days = this.data()?.daily ?? [];
    return {
      revenue: days.map((d) => d.revenueCents),
      orders: days.map((d) => d.orders),
      customers: days.map((d) => d.customers),
      newCustomers: days.map((d) => d.newCustomers),
      expired: days.map((d) => d.expired),
      commission: days.map((d) => d.commissionCents),
    };
  });

  readonly tips = computed(() => {
    const data = this.data();
    this.fmt.lang();
    const days = data?.daily ?? [];
    const today = data ? todayIn(data.period.timeZone) : '';
    const t = (key: string) => this.fmt.t(`tip.${key}`);
    const s = this.series();
    const vs = (values: number[]) => this.fmt.vsAverage(values, t('vsAverageDay'));
    const revenueVs = vs(s.revenue);
    const ordersVs = vs(s.orders);
    return {
      revenue: this.fmt.dailyTips(
        days,
        (d, i) => [
          { label: t('revenue'), value: this.money(d.revenueCents), color: 'var(--chart-money)', strong: true },
          { label: t('orders'), value: this.fmt.int(d.orders) },
          { label: t('commission'), value: this.money(d.commissionCents) },
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
          ordersVs(i),
        ],
        today,
      ),
      customers: this.fmt.dailyTips(
        days,
        (d) => [
          { label: t('customers'), value: this.fmt.int(d.customers), color: 'var(--chart-customers)', strong: true },
          { label: t('newCustomers'), value: this.fmt.int(d.newCustomers) },
        ],
        today,
      ),
      commission: this.fmt.dailyTips(
        days,
        (d) => [
          { label: t('commission'), value: this.money(d.commissionCents), color: 'var(--chart-money)', strong: true },
          { label: t('revenue'), value: this.money(d.revenueCents) },
        ],
        today,
      ),
    };
  });

  readonly shareRows = computed<ShareRow[]>(() =>
    (this.data()?.byBrand ?? []).map((b) => ({
      key: b.id,
      name: b.name,
      value: b.revenueCents,
      share: b.sharePercent,
      previous: b.previousRevenueCents,
      extra: [
        { label: this.fmt.t('tip.orders'), value: this.fmt.int(b.orders) },
        { label: this.fmt.t('tip.commission'), value: this.money(b.commissionCents) },
      ],
    })),
  );

  readonly statusSlices = computed(() => {
    this.fmt.lang();
    return this.fmt.statusSlices(this.data()?.statuses);
  });
  readonly hourItems = computed(() => this.fmt.hourItems(this.data()?.byHour ?? [], this.data()?.currency));
  readonly hourRange = computed(() => this.fmt.hourRange(this.data()?.byHour ?? []));
  readonly weekdayItems = computed(() => this.fmt.weekdayItems(this.data()?.byWeekday ?? [], this.data()?.currency));

  readonly brandTable = computed(() => {
    const q = this.query().trim().toLowerCase();
    const rows = (this.data()?.byBrand ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
    return this.sort.apply(rows, (b, k) => {
      switch (k) {
        case 'name':
          return b.name;
        case 'orders':
          return b.orders;
        case 'ordersDelta':
          return this.ordersDiff(b);
        case 'revenue':
          return b.revenueCents;
        case 'avgCheck':
          return b.avgCheckCents;
        case 'customers':
          return b.customers;
        case 'cancelled':
          return (b.cancelled ?? 0) + (b.expired ?? 0);
        case 'stores':
          return b.stores;
        case 'plan':
          return b.commissionBps;
        case 'commission':
          return b.commissionCents;
      }
    });
  });

  constructor() {
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.tick.update((n) => n + 1));
    effect(() => {
      const range = this.range();
      const currency = this.currency();
      this.tick();
      untracked(() => this.load(range, currency));
    });
  }

  reload(): void {
    this.tick.update((n) => n + 1);
  }

  /** Switches the header to this brand and opens its dashboard, as its owner sees it. */
  openAsOwner(brandId: string): void {
    this.activeBrand.select(brandId);
    void this.router.navigate(['/dashboard']);
  }

  money(cents: number | null | undefined): string {
    return this.fmt.money(cents, this.data()?.currency);
  }

  repeatShare(t: OverviewTotals): string {
    if (t.customers === 0) return '—';
    return this.fmt.percent((Math.max(0, t.customers - t.newCustomers) / t.customers) * 100, 0);
  }

  /** The commission as a share of revenue: the blended rate across plans. */
  commissionRate(t: OverviewTotals): string {
    return t.revenueCents > 0 ? this.fmt.percent((t.commissionCents / t.revenueCents) * 100) : '—';
  }

  ordersDiff(b: PlatformBrandRow): number {
    return b.orders - (b.previousOrders ?? b.orders);
  }

  ariaSort(key: BrandSortKey): 'ascending' | 'descending' | null {
    if (this.sort.key() !== key) return null;
    return this.sort.desc() ? 'descending' : 'ascending';
  }

  sortMark(key: BrandSortKey): string {
    if (this.sort.key() !== key) return '';
    return this.sort.desc() ? ' ↓' : ' ↑';
  }

  private load(range: DateRangeValue, currency: string | null): void {
    const period: AnalyticsPeriod = { ...range };
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(false);
    this.request = this.analytics.platformOverview(period, currency).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
    // No brandId: a platform admin's scope is every brand.
    this.analytics.orderStatuses(null, period).subscribe({ next: (s) => this.statuses.set(s) });
    this.brandsApi.loadPendingCount();
  }
}
