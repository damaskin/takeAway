import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import { AnalyticsApi, type DashboardSummary, type StorePerformance } from '../../core/analytics/analytics.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminOrdersApi, type AdminOrderSummary } from '../../core/orders/orders.service';
import { OnboardingChecklistComponent } from './onboarding-checklist.component';

interface KpiCard {
  label: string;
  value: string;
  /** «▲ 12,5 % к прошлым 7 дням»; empty hides the line. */
  delta: string;
  tone: 'good' | 'bad' | 'neutral';
  accent: string;
}

/** The periods the dashboard can show, in days. */
const PERIODS = [7, 14, 30] as const;
type Period = (typeof PERIODS)[number];

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
  imports: [RouterLink, TranslatePipe, OnboardingChecklistComponent],
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
          <select
            [attr.aria-label]="'admin.dashboard.period' | translate"
            (change)="setDays($any($event.target).value)"
            style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); cursor: pointer"
          >
            @for (d of periods; track d) {
              <option [value]="d" [selected]="d === days()">
                {{ 'admin.dashboard.range' | translate: { days: d } }}
              </option>
            }
          </select>
          <a
            routerLink="/promo"
            [queryParams]="{ create: 1 }"
            class="flex items-center"
            style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none"
          >
            {{ 'admin.dashboard.newPromo' | translate }}
          </a>
        </div>
      </header>

      <!-- Launch checklist: a new brand owner's next steps; hides itself once done -->
      <app-onboarding-checklist />

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
              [style.color]="toneColor(kpi.tone)"
              style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; gap: 4px; min-height: 16px"
            >
              {{ kpi.delta }}
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
              routerLink="/orders"
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
export class DashboardPage {
  private readonly store = inject(AuthStore);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly analytics = inject(AnalyticsApi);
  private readonly orders = inject(AdminOrdersApi);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly periods = PERIODS;
  /** The period every figure on the page covers; the store list follows it too. */
  readonly days = signal<Period>(7);

  readonly summary = signal<DashboardSummary | null>(null);
  readonly liveRaw = signal<AdminOrderSummary[]>([]);
  readonly storePerfRaw = signal<StorePerformance[]>([]);

  readonly kpis = computed<KpiCard[]>(() => {
    const s = this.summary();
    const days = s?.days ?? this.days();
    const revenue = this.change(s?.revenueDeltaPercent, days, (v) => this.fmt.percent(v));
    const orders = this.change(s?.ordersDeltaPercent, days, (v) => this.fmt.percent(v));
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
        label: 'admin.dashboard.kpi.pickupTime',
        value: s?.avgPickupSeconds ? this.duration(s.avgPickupSeconds) : '—',
        ...pickup,
        accent: 'var(--color-amber)',
      },
      {
        label: 'admin.dashboard.kpi.nps',
        value: s?.nps == null ? '—' : String(s.nps),
        delta: '',
        tone: 'neutral',
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

  constructor() {
    // The numbers belong to the brand picked in the header — a brand owner's
    // own, or whichever one a platform admin is looking at — and follow it.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) return;
      this.orders.list({ take: 10, brandId }).subscribe({
        next: (list) => this.liveRaw.set(list.filter((o) => !['PICKED_UP', 'CANCELLED', 'EXPIRED'].includes(o.status))),
      });
    });
    // The KPI cards and the store list cover the period picked in the header.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      const days = this.days();
      if (!brandId) return;
      this.analytics.summary(brandId, days).subscribe({ next: (s) => this.summary.set(s) });
      this.analytics.storePerformance(days, brandId).subscribe({ next: (rows) => this.storePerfRaw.set(rows) });
    });
  }

  setDays(value: string): void {
    const days = Number(value);
    if (PERIODS.includes(days as Period)) this.days.set(days as Period);
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
