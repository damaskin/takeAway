import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { interval } from 'rxjs';

import {
  AnalyticsApi,
  type BrandPerformance,
  type DashboardSummary,
  type OrderStatusStats,
} from '../../core/analytics/analytics.service';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { BrandsService } from '../../core/brands/brands.service';
import { OrderStatusPanelComponent } from '../../shared/order-status-panel.component';

interface PlatformKpi {
  label: string;
  value: string;
  note: { key: string; params?: Record<string, unknown> } | null;
}

const PERIODS = [7, 14, 30] as const;
type Period = (typeof PERIODS)[number];

/** The platform view has no socket of its own; this keeps "right now" fresh. */
const REFRESH_MS = 60_000;

/**
 * "Whole project" — the platform admin's own screen: every brand's orders
 * together, where they stand, and each brand side by side with a way into
 * its cabinet. Opening a brand switches the header's brand, so every other
 * page then shows exactly what that brand's owner sees.
 */
@Component({
  selector: 'app-platform',
  standalone: true,
  imports: [RouterLink, TranslatePipe, OrderStatusPanelComponent],
  template: `
    <section class="plat">
      <header class="plat-head">
        <div class="flex flex-col" style="gap: 4px">
          <h1 class="plat-title">{{ 'admin.platform.title' | translate }}</h1>
          <p class="plat-muted">{{ 'admin.platform.subtitle' | translate }}</p>
        </div>
        <select
          class="plat-select"
          [attr.aria-label]="'admin.dashboard.period' | translate"
          (change)="setDays($any($event.target).value)"
        >
          @for (d of periods; track d) {
            <option [value]="d" [selected]="d === days()">
              {{ 'admin.dashboard.range' | translate: { days: d } }}
            </option>
          }
        </select>
      </header>

      <div class="plat-kpis">
        @for (kpi of kpis(); track kpi.label) {
          <article class="plat-card">
            <span class="plat-caption">{{ kpi.label | translate }}</span>
            <span class="plat-value">{{ kpi.value }}</span>
            <span class="plat-muted">
              @if (kpi.note; as note) {
                {{ note.key | translate: note.params }}
              }
            </span>
          </article>
        }
      </div>

      <app-order-status-panel [stats]="statuses()" [days]="days()" />

      <article class="plat-card">
        <header class="flex items-center justify-between flex-wrap" style="gap: 8px">
          <h2 class="plat-h2">{{ 'admin.platform.brandsTitle' | translate }}</h2>
          @if (pending(); as count) {
            <a routerLink="/brands" class="plat-link">
              {{ 'admin.platform.pending' | translate: { count: count } }} · {{ 'admin.platform.review' | translate }}
            </a>
          }
        </header>
        <div class="plat-table-wrap">
          <table class="plat-table">
            <thead>
              <tr>
                <th>{{ 'admin.platform.cols.brand' | translate }}</th>
                <th>{{ 'admin.platform.cols.status' | translate }}</th>
                <th class="num">{{ 'admin.platform.cols.stores' | translate }}</th>
                <th class="num">{{ 'admin.platform.cols.orders' | translate }}</th>
                <th class="num">{{ 'admin.platform.cols.revenue' | translate }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (b of brands(); track b.brandId) {
                <tr>
                  <td class="plat-brand">{{ b.brandName }}</td>
                  <td>
                    <span class="plat-badge" [attr.data-status]="b.moderationStatus">{{
                      'admin.brands.status.' + b.moderationStatus | translate
                    }}</span>
                  </td>
                  <td class="num">{{ b.stores }}</td>
                  <td class="num">{{ b.orders }}</td>
                  <td class="num">{{ money(b.revenueCents, b.currency) }}</td>
                  <td class="num">
                    <button type="button" class="plat-open" (click)="openAsOwner(b.brandId)">
                      {{ 'admin.platform.open' | translate }}
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="plat-muted" style="padding: 24px 0; text-align: center">
                    {{ 'admin.platform.empty' | translate }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `,
  styles: [
    `
      .plat {
        padding: clamp(16px, 4vw, 32px);
        display: flex;
        flex-direction: column;
        gap: 24px;
        font-family: var(--font-sans);
      }
      .plat-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
      }
      .plat-title {
        font-family: var(--font-display);
        font-size: 28px;
        font-weight: 700;
        color: var(--color-espresso);
        margin: 0;
      }
      .plat-h2 {
        font-family: var(--font-display);
        font-size: 18px;
        font-weight: 700;
        color: var(--color-espresso);
        margin: 0;
      }
      .plat-muted {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0;
      }
      .plat-select {
        height: 36px;
        padding: 0 10px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-button);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .plat-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
      }
      .plat-card {
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 20px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }
      .plat-caption {
        font-size: 12px;
        color: var(--color-text-tertiary);
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .plat-value {
        font-family: var(--font-display);
        font-size: 28px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .plat-link {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-caramel);
      }
      .plat-table-wrap {
        overflow-x: auto;
      }
      .plat-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      .plat-table th {
        text-align: left;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-tertiary);
        padding: 8px 10px;
        border-bottom: 1px solid var(--color-border-light);
        white-space: nowrap;
      }
      .plat-table td {
        padding: 10px;
        border-bottom: 1px solid var(--color-border-light);
        color: var(--color-text-primary);
        white-space: nowrap;
      }
      .plat-table .num {
        text-align: right;
      }
      .plat-brand {
        font-weight: 600;
      }
      .plat-badge {
        padding: 3px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        background: var(--color-surface-variant);
        color: var(--color-text-secondary);
      }
      .plat-badge[data-status='APPROVED'] {
        background: #7bc4a433;
        color: #3e8868;
      }
      .plat-badge[data-status='PENDING'] {
        background: #e9a84b33;
        color: #8a6720;
      }
      .plat-open {
        height: 32px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid var(--color-caramel);
        color: var(--color-caramel);
        font-size: 13px;
        font-weight: 600;
      }
    `,
  ],
})
export class PlatformPage {
  private readonly analytics = inject(AnalyticsApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly brandsApi = inject(BrandsService);
  private readonly router = inject(Router);
  private readonly fmt = inject(LocaleFormatService);

  readonly periods = PERIODS;
  readonly days = signal<Period>(7);
  readonly summary = signal<DashboardSummary | null>(null);
  readonly statuses = signal<OrderStatusStats | null>(null);
  readonly brands = signal<BrandPerformance[]>([]);
  private readonly tick = signal(0);

  readonly pending = computed(() => this.brandsApi.pendingCount() ?? 0);

  readonly kpis = computed<PlatformKpi[]>(() => {
    const brands = this.brands();
    const s = this.summary();
    // Brands price in their own currencies; one total only makes sense
    // when every brand that sold anything sold in the same one.
    const currencies = [...new Set(brands.filter((b) => b.revenueCents > 0).map((b) => b.currency))];
    const mixed = currencies.length > 1;
    return [
      { label: 'admin.platform.kpi.orders', value: String(s?.orders ?? 0), note: null },
      {
        label: 'admin.platform.kpi.revenue',
        value: mixed ? '—' : this.money(s?.revenueCents ?? 0, currencies[0] ?? brands[0]?.currency ?? null),
        note: mixed ? { key: 'admin.platform.mixedCurrencies' } : null,
      },
      {
        label: 'admin.platform.kpi.brands',
        value: String(brands.length),
        note: { key: 'admin.platform.activeBrands', params: { count: brands.filter((b) => b.orders > 0).length } },
      },
      { label: 'admin.platform.kpi.stores', value: String(brands.reduce((n, b) => n + b.stores, 0)), note: null },
    ];
  });

  constructor() {
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.tick.update((n) => n + 1));
    effect(() => {
      const days = this.days();
      this.tick();
      untracked(() => {
        // No brandId: a platform admin's scope is every brand.
        this.analytics.summary(null, days).subscribe({ next: (s) => this.summary.set(s) });
        this.analytics.orderStatuses(null, days).subscribe({ next: (s) => this.statuses.set(s) });
        this.analytics.brandPerformance(days).subscribe({ next: (rows) => this.brands.set(rows) });
        this.brandsApi.loadPendingCount();
      });
    });
  }

  setDays(value: string): void {
    const days = Number(value);
    if (PERIODS.includes(days as Period)) this.days.set(days as Period);
  }

  /** Switches the header to this brand and opens its dashboard, as its owner sees it. */
  openAsOwner(brandId: string): void {
    this.activeBrand.select(brandId);
    void this.router.navigate(['/dashboard']);
  }

  money(cents: number, currency: string | null): string {
    return this.fmt.money(cents, currency, { round: true });
  }
}
