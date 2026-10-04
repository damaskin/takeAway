import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import {
  AnalyticsApi,
  type AnalyticsPeriod,
  type DashboardSummary,
  type OrderStatusStats,
  type StorePerformance,
} from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { OrderAlertsService } from '../../core/kitchen/order-alerts.service';
import { AdminOrdersApi, type AdminOrderSummary } from '../../core/orders/orders.service';
import { type AdminRole, canAccess, canOnStores } from '../../core/permissions/permissions';
import { PlanAccess } from '../../core/plans/plan-access.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { DateRangeComponent, type DateRangeValue } from '../../shared/date-range.component';
import { OrderStatusPanelComponent } from '../../shared/order-status-panel.component';
import { ChurnWidgetComponent } from './churn-widget.component';
import { MenuSummaryWidgetComponent } from './menu-summary-widget.component';
import { OnboardingChecklistComponent } from './onboarding-checklist.component';
import { StoreShiftsWidgetComponent } from './store-shifts-widget.component';
import { StoreTimezoneAlertComponent } from './store-timezone-alert.component';

interface KpiCard {
  label: string;
  value: string;
  /** «▲ 12,5 % к прошлым 7 дням»; empty hides the line. */
  delta: string;
  tone: 'good' | 'bad' | 'neutral';
  accent: string;
}

interface DashboardOrder {
  code: string;
  product: string;
  store: string;
  status: 'READY' | 'IN_PROGRESS' | 'ACCEPTED' | 'PAID';
  minutes: number;
}

/**
 * Admin Dashboard — pencil C1 (P0R5u), on every plan.
 *
 *   Period picker (presets or a calendar range) driving every figure
 *   KPI row — revenue, orders, average check, active orders, pickup time
 *   Kitchen window — orders by status now and in the period, live orders
 *   Revenue share per store
 *   Store management (shifts), customers lost, menu at a glance
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    OnboardingChecklistComponent,
    OrderStatusPanelComponent,
    StoreTimezoneAlertComponent,
    DateRangeComponent,
    StoreShiftsWidgetComponent,
    ChurnWidgetComponent,
    MenuSummaryWidgetComponent,
  ],
  template: `
    <section style="padding: clamp(16px, 4vw, 32px); display: flex; flex-direction: column; gap: 24px">
      <header class="flex items-end justify-between flex-wrap" style="gap: 16px">
        <div class="flex flex-col" style="gap: 4px">
          <h1
            style="font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            {{ 'admin.dashboard.title' | translate: { name: name() ? ', ' + name() : '' } }}
          </h1>
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.dashboard.subtitle' | translate }}
          </p>
        </div>
        <div class="flex items-end flex-wrap justify-end" style="gap: 8px">
          <app-date-range [(value)]="range" />
          @if (plans.has('promo')) {
            <a
              routerLink="/promo/new"
              class="flex items-center"
              style="height: 32px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none"
            >
              {{ 'admin.dashboard.newPromo' | translate }}
            </a>
          }
        </div>
      </header>

      <!-- Open stores still on UTC: their hours are read hours off; hides itself when none -->
      <app-store-timezone-alert />

      <!-- Launch checklist: a new brand owner's next steps; hides itself once done -->
      <app-onboarding-checklist />

      <!-- KPI grid -->
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px">
        @for (kpi of kpis(); track kpi.label) {
          <article
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 10px"
          >
            <span
              style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >{{ kpi.label | translate }}</span
            >
            <span
              style="font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-espresso)"
              >{{ kpi.value }}</span
            >
            <span
              class="flex items-center"
              [style.color]="toneColor(kpi.tone)"
              style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; gap: 4px; min-height: 16px"
            >
              {{ kpi.delta }}
            </span>
            <div style="height: 4px; border-radius: 9999px; margin-top: 2px" [style.background]="kpi.accent"></div>
          </article>
        }
      </div>

      <!-- Kitchen window: open orders now, and how the period ended up -->
      <app-order-status-panel [stats]="statuses()" [days]="summary()?.days ?? 7" [kitchenLink]="canSeeKitchen()" />

      <!-- Two-column body -->
      <div class="dashboard-body grid" style="grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 16px">
        <!-- Live orders -->
        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.dashboard.liveOrders' | translate }}</h2>
            <a [routerLink]="canSeeKitchen() ? '/kitchen' : '/orders'">{{
              (canSeeKitchen() ? 'admin.dashboard.openKitchen' : 'admin.dashboard.viewAll') | translate
            }}</a>
          </header>
          <div class="flex flex-col" style="gap: 8px">
            @for (o of liveOrders(); track o.code) {
              <div
                class="flex items-center justify-between"
                style="padding: 12px 14px; border: 1px solid var(--color-border-light); border-radius: 14px; gap: 16px"
              >
                <div class="flex items-center" style="gap: 14px; min-width: 0">
                  <span
                    class="flex items-center justify-center"
                    style="flex: none; width: 44px; height: 44px; border-radius: 10px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-mono); font-size: 14px; font-weight: 700"
                    >{{ o.code }}</span
                  >
                  <div class="flex flex-col" style="gap: 2px; min-width: 0">
                    <span
                      style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                      >{{ o.product }}</span
                    >
                    <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                      o.store
                    }}</span>
                  </div>
                </div>
                <div class="flex items-center flex-wrap justify-end" style="gap: 8px 16px">
                  <span
                    [style.background]="statusBg(o.status)"
                    [style.color]="statusColor(o.status)"
                    style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                    >{{ statusLabel(o.status) | translate }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); min-width: 56px; text-align: right"
                    >⏱ {{ o.minutes }} {{ 'common.units.min' | translate }}</span
                  >
                </div>
              </div>
            } @empty {
              <p class="dash-muted">{{ 'admin.dashboard.noLiveOrders' | translate }}</p>
            }
          </div>
        </article>

        <!-- Store performance -->
        <article class="dash-card">
          <header class="dash-card-head">
            <h2>{{ 'admin.dashboard.storePerf' | translate }}</h2>
            @if (canSeeAnalytics()) {
              <a routerLink="/analytics" [queryParams]="{ tab: 'stores' }">{{
                'admin.dashboard.compareStores' | translate
              }}</a>
            }
          </header>
          <div class="flex flex-col" style="gap: 12px">
            @for (s of storePerf(); track s.id) {
              <div class="flex flex-col" style="gap: 6px">
                <div class="flex items-center justify-between" style="gap: 8px">
                  <span
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                    >{{ s.name }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-caramel); white-space: nowrap"
                    >{{ s.value }}</span
                  >
                </div>
                <div
                  style="height: 6px; border-radius: 9999px; background: var(--color-surface-variant); overflow: hidden"
                >
                  <div
                    [style.width.%]="s.percent"
                    style="height: 100%; background: var(--color-caramel); border-radius: 9999px"
                  ></div>
                </div>
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                  'admin.dashboard.storeLine' | translate: { orders: s.orders, share: s.share }
                }}</span>
              </div>
            } @empty {
              <p class="dash-muted">{{ 'admin.analytics.noOrders' | translate }}</p>
            }
          </div>
        </article>
      </div>

      @if (activeBrand.activeId(); as brandId) {
        <div class="dashboard-widgets grid" style="gap: 16px">
          <app-store-shifts-widget [brandId]="brandId" [canToggle]="canToggleShifts()" />
          <app-churn-widget [brandId]="brandId" [period]="period()" [currency]="activeBrand.active()?.currency" />
          @if (canSeeMenu()) {
            <app-menu-summary-widget [brandId]="brandId" />
          }
        </div>
      }
    </section>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      .dashboard-widgets {
        grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
      }
      @media (max-width: 768px) {
        .dashboard-body {
          grid-template-columns: 1fr !important;
        }
      }
    `,
  ],
})
export class DashboardPage {
  private readonly store = inject(AuthStore);
  readonly activeBrand = inject(ActiveBrandService);
  readonly plans = inject(PlanAccess);
  private readonly analytics = inject(AnalyticsApi);
  private readonly orders = inject(AdminOrdersApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  /** The period every figure on the page covers. */
  readonly range = signal<DateRangeValue>({ days: 7 });
  readonly period = computed<AnalyticsPeriod>(() => ({ ...this.range() }));

  readonly summary = signal<DashboardSummary | null>(null);
  readonly liveRaw = signal<AdminOrderSummary[]>([]);
  readonly storePerfRaw = signal<StorePerformance[]>([]);
  readonly statuses = signal<OrderStatusStats | null>(null);

  private readonly alerts = inject(OrderAlertsService);
  private readonly role = computed(() => this.store.user()?.role as AdminRole | undefined);
  readonly canSeeKitchen = computed(() => canAccess(this.role(), 'kitchen'));
  readonly canSeeMenu = computed(() => canAccess(this.role(), 'menu'));
  readonly canSeeAnalytics = computed(() => canAccess(this.role(), 'analytics'));
  readonly canToggleShifts = computed(() => canOnStores(this.role(), 'edit'));

  readonly kpis = computed<KpiCard[]>(() => {
    const s = this.summary();
    const days = s?.days ?? 7;
    const revenue = this.change(s?.revenueDeltaPercent, days, (v) => this.fmt.percent(v));
    const orders = this.change(s?.ordersDeltaPercent, days, (v) => this.fmt.percent(v));
    const check = this.change(s?.avgCheckDeltaPercent, days, (v) => this.fmt.percent(v));
    // A shorter wait is the good direction.
    const pickup = this.change(s?.pickupDeltaSeconds, days, (v) => this.duration(v), true);
    return [
      {
        label: 'admin.dashboard.kpi.revenue',
        value: this.price(s?.revenueCents ?? 0),
        ...revenue,
        accent: 'var(--color-caramel)',
      },
      {
        label: 'admin.dashboard.kpi.orders',
        value: String(s?.orders ?? 0),
        ...orders,
        accent: 'var(--color-mint)',
      },
      {
        label: 'admin.dashboard.kpi.avgCheck',
        value: s?.avgCheckCents ? this.price(s.avgCheckCents) : '—',
        ...check,
        accent: 'var(--color-latte)',
      },
      {
        label: 'admin.dashboard.kpi.activeOrders',
        value: String(this.statuses()?.liveTotal ?? 0),
        delta: this.translate.instant('admin.dashboard.kpi.activeNow'),
        tone: 'neutral',
        accent: 'var(--color-berry)',
      },
      {
        label: 'admin.dashboard.kpi.pickupTime',
        value: s?.avgPickupSeconds ? this.duration(s.avgPickupSeconds) : '—',
        ...pickup,
        accent: 'var(--color-amber)',
      },
    ];
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

  readonly storePerf = computed(() => {
    const rows = this.storePerfRaw();
    const max = Math.max(1, ...rows.map((r) => r.revenueCents));
    return rows.slice(0, 6).map((r) => ({
      id: r.storeId,
      name: r.storeName,
      value: this.price(r.revenueCents),
      orders: r.orders,
      share: this.fmt.percent(r.sharePercent),
      percent: Math.round((r.revenueCents / max) * 100),
    }));
  });

  constructor() {
    // The numbers belong to the brand picked in the header — a brand owner's
    // own, or whichever one a platform admin is looking at — and follow it.
    // Live figures also follow the kitchen feed: every order change in the
    // brand's stores re-reads them, so the page never needs a refresh.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const period = this.period();
      this.alerts.revision();
      if (!brandId) return;
      untracked(() => {
        this.orders.list({ take: 10, brandId }).subscribe({
          next: (list) =>
            this.liveRaw.set(list.filter((o) => !['PICKED_UP', 'CANCELLED', 'EXPIRED'].includes(o.status))),
        });
        this.analytics.orderStatuses(brandId, period).subscribe({ next: (stats) => this.statuses.set(stats) });
      });
    });
    // The KPI cards and the store list cover the period picked in the header.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const period = this.period();
      if (!brandId) return;
      untracked(() => {
        this.analytics.summary(brandId, period).subscribe({ next: (s) => this.summary.set(s) });
        this.analytics.storePerformance(brandId, period).subscribe({ next: (rows) => this.storePerfRaw.set(rows) });
      });
    });
  }

  name(): string {
    return this.store.user()?.name ?? '';
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.activeBrand.active()?.currency, { round: true });
  }

  /** «4 мин 30 с», «45 с». */
  duration(seconds: number): string {
    const total = Math.round(Math.abs(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    const min = this.translate.instant('common.units.min');
    const sec = this.translate.instant('common.units.sShort');
    if (m === 0) return `${s} ${sec}`;
    return s === 0 ? `${m} ${min}` : `${m} ${min} ${s} ${sec}`;
  }

  toneColor(tone: KpiCard['tone']): string {
    if (tone === 'good') return '#3E8868';
    if (tone === 'bad') return 'var(--color-berry)';
    return 'var(--color-text-tertiary)';
  }

  /**
   * «▲ 12,5 % к прошлым 7 дням». `lowerIsBetter` flips the colour for figures
   * where a drop is the good news, like the pickup wait.
   */
  private change(
    value: number | null | undefined,
    days: number,
    format: (abs: number) => string,
    lowerIsBetter = false,
  ): Pick<KpiCard, 'delta' | 'tone'> {
    if (!this.summary()) return { delta: '', tone: 'neutral' };
    if (value == null) return { delta: this.translate.instant('admin.dashboard.noComparison'), tone: 'neutral' };
    const arrow = value > 0 ? '▲ ' : value < 0 ? '▼ ' : '';
    const delta = `${arrow}${format(Math.abs(value))} ${this.translate.instant('admin.dashboard.vsPrevious', { days })}`;
    if (value === 0) return { delta, tone: 'neutral' };
    return { delta, tone: value > 0 !== lowerIsBetter ? 'good' : 'bad' };
  }

  /** Returns a translation key; translated in the template with | translate. */
  statusLabel(status: DashboardOrder['status']): string {
    return {
      READY: 'admin.orders.status.READY',
      IN_PROGRESS: 'admin.orders.status.IN_PROGRESS',
      ACCEPTED: 'admin.orders.status.ACCEPTED',
      PAID: 'admin.orders.status.PAID',
    }[status];
  }

  statusBg(status: DashboardOrder['status']): string {
    if (status === 'READY') return '#7BC4A433';
    if (status === 'IN_PROGRESS') return 'var(--color-caramel-light)';
    if (status === 'ACCEPTED') return '#E9A84B33';
    return 'var(--color-surface-variant)';
  }

  statusColor(status: DashboardOrder['status']): string {
    if (status === 'READY') return '#3E8868';
    if (status === 'IN_PROGRESS') return 'var(--color-caramel)';
    if (status === 'ACCEPTED') return '#8A6720';
    return 'var(--color-text-secondary)';
  }
}
