import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AnalyticsApi, type DashboardSummary, type StorePerformance } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { AdminOrdersApi, type AdminOrderSummary } from '../../core/orders/orders.service';

interface KpiCard {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
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
 * Admin Dashboard — pencil C1 (P0R5u).
 *
 * content (padding 32, gap 24):
 *   KPI row (4 cards) — revenue, orders today, avg pickup time, NPS
 *   Live orders panel + store performance list
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TranslatePipe],
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
        <div class="flex items-center" style="gap: 8px">
          <button
            type="button"
            class="flex items-center"
            style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            {{ 'admin.dashboard.range' | translate }} ▾
          </button>
          <button
            type="button"
            class="flex items-center"
            style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
          >
            {{ 'admin.dashboard.newPromo' | translate }}
          </button>
        </div>
      </header>

      <!-- KPI grid -->
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px">
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
              [style.color]="kpi.positive ? '#3E8868' : 'var(--color-berry)'"
              style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; gap: 4px"
            >
              {{ kpi.positive ? '▲' : '▼' }} {{ kpi.delta }}
            </span>
            <div style="height: 4px; border-radius: 9999px; margin-top: 2px" [style.background]="kpi.accent"></div>
          </article>
        }
      </div>

      <!-- Two-column body -->
      <div class="dashboard-body grid" style="grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 16px">
        <!-- Live orders -->
        <article
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
        >
          <header class="flex items-center justify-between">
            <h2
              style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
            >
              {{ 'admin.dashboard.liveOrders' | translate }}
            </h2>
            <a
              href="#/orders"
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-caramel)"
              >{{ 'admin.dashboard.viewAll' | translate }}</a
            >
          </header>
          <div class="flex flex-col" style="gap: 8px">
            @for (o of liveOrders(); track o.code) {
              <div
                class="flex items-center justify-between"
                style="padding: 12px 14px; border: 1px solid var(--color-border-light); border-radius: 14px; gap: 16px"
              >
                <div class="flex items-center" style="gap: 14px">
                  <span
                    class="flex items-center justify-center"
                    style="width: 44px; height: 44px; border-radius: 10px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-mono); font-size: 14px; font-weight: 700"
                    >{{ o.code }}</span
                  >
                  <div class="flex flex-col" style="gap: 2px">
                    <span
                      style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                      >{{ o.product }}</span
                    >
                    <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                      o.store
                    }}</span>
                  </div>
                </div>
                <div class="flex items-center" style="gap: 16px">
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
            }
          </div>
        </article>

        <!-- Store performance -->
        <article
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
        >
          <h2
            style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            {{ 'admin.dashboard.storePerf' | translate }}
          </h2>
          <div class="flex flex-col" style="gap: 12px">
            @for (s of storePerf(); track s.name) {
              <div class="flex flex-col" style="gap: 6px">
                <div class="flex items-center justify-between">
                  <span
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                    >{{ s.name }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-caramel)"
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
              </div>
            }
          </div>
        </article>
      </div>
    </section>
  `,
  styles: [
    `
      @media (max-width: 768px) {
        .dashboard-body {
          grid-template-columns: 1fr !important;
        }
      }
    `,
  ],
})
export class DashboardPage implements OnInit {
  private readonly store = inject(AuthStore);
  private readonly analytics = inject(AnalyticsApi);
  private readonly orders = inject(AdminOrdersApi);
  private readonly translate = inject(TranslateService);

  readonly summary = signal<DashboardSummary | null>(null);
  readonly liveRaw = signal<AdminOrderSummary[]>([]);
  readonly storePerfRaw = signal<StorePerformance[]>([]);

  readonly kpis = computed<KpiCard[]>(() => {
    const s = this.summary();
    return [
      {
        label: 'admin.dashboard.kpi.revenueToday',
        value: this.price(s?.revenueTodayCents ?? 0),
        delta: s?.deltas['revenue'] ?? '—',
        positive: (s?.deltas['revenue'] ?? '+0%').startsWith('+'),
        accent: 'var(--color-caramel)',
      },
      {
        label: 'admin.dashboard.kpi.ordersToday',
        value: String(s?.ordersToday ?? 0),
        delta: s?.deltas['orders'] ?? '—',
        positive: (s?.deltas['orders'] ?? '+0%').startsWith('+'),
        accent: 'var(--color-mint)',
      },
      {
        label: 'admin.dashboard.kpi.pickupTime',
        value: this.formatSeconds(s?.avgPickupSeconds ?? 0),
        delta: s?.deltas['pickup'] ?? '0s',
        positive: (s?.deltas['pickup'] ?? '+0').startsWith('-') || s?.avgPickupSeconds === 0,
        accent: 'var(--color-amber)',
      },
      {
        label: 'admin.dashboard.kpi.nps',
        value: String(s?.nps ?? '—'),
        delta: s?.deltas['nps'] ?? '0',
        positive: true,
        accent: 'var(--color-cat-signature)',
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
      name: r.storeName,
      value: this.price(r.revenueCents),
      percent: Math.round((r.revenueCents / max) * 100),
    }));
  });

  ngOnInit(): void {
    this.analytics.summary().subscribe({ next: (s) => this.summary.set(s) });
    this.orders.list({ take: 10 }).subscribe({
      next: (list) => this.liveRaw.set(list.filter((o) => !['PICKED_UP', 'CANCELLED', 'EXPIRED'].includes(o.status))),
    });
    this.analytics.storePerformance(14).subscribe({ next: (rows) => this.storePerfRaw.set(rows) });
  }

  name(): string {
    return this.store.user()?.name ?? '';
  }

  price(cents: number): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
      cents / 100,
    );
  }

  formatSeconds(sec: number): string {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const mShort = this.translate.instant('common.units.mShort');
    const sShort = this.translate.instant('common.units.sShort');
    return `${m}${mShort} ${s}${sShort}`;
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
