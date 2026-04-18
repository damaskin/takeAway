import { Component, inject } from '@angular/core';

import { AuthStore } from '../../core/auth/auth.store';

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
  template: `
    <section style="padding: 32px; display: flex; flex-direction: column; gap: 24px">
      <header class="flex items-end justify-between" style="gap: 24px">
        <div class="flex flex-col" style="gap: 4px">
          <h1
            style="font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            Welcome back{{ name() ? ', ' + name() : '' }}
          </h1>
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            Here's what's happening across your takeAway network today.
          </p>
        </div>
        <div class="flex items-center" style="gap: 8px">
          <button
            type="button"
            class="flex items-center"
            style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            Last 7 days ▾
          </button>
          <button
            type="button"
            class="flex items-center"
            style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
          >
            + New promo
          </button>
        </div>
      </header>

      <!-- KPI grid -->
      <div class="grid" style="grid-template-columns: repeat(4, 1fr); gap: 16px">
        @for (kpi of kpis; track kpi.label) {
          <article
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 10px"
          >
            <span
              style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >{{ kpi.label }}</span
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
      <div class="grid" style="grid-template-columns: 2fr 1fr; gap: 16px">
        <!-- Live orders -->
        <article
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
        >
          <header class="flex items-center justify-between">
            <h2
              style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
            >
              Live orders
            </h2>
            <a
              href="#/orders"
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-caramel)"
              >View all →</a
            >
          </header>
          <div class="flex flex-col" style="gap: 8px">
            @for (o of liveOrders; track o.code) {
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
                    >{{ statusLabel(o.status) }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); min-width: 56px; text-align: right"
                    >⏱ {{ o.minutes }} min</span
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
            Stores performance
          </h2>
          <div class="flex flex-col" style="gap: 12px">
            @for (s of storePerf; track s.name) {
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
})
export class DashboardPage {
  private readonly store = inject(AuthStore);

  readonly kpis: KpiCard[] = [
    { label: 'Revenue today', value: '$8,412', delta: '+12.3%', positive: true, accent: 'var(--color-caramel)' },
    { label: 'Orders today', value: '412', delta: '+4.1%', positive: true, accent: 'var(--color-mint)' },
    { label: 'Avg pickup time', value: '6m 20s', delta: '+14s', positive: false, accent: 'var(--color-amber)' },
    { label: 'NPS', value: '82', delta: '+3', positive: true, accent: 'var(--color-cat-signature)' },
  ];

  readonly liveOrders: DashboardOrder[] = [
    { code: '2471', product: 'Caramel latte · Large', store: 'Downtown Hub', status: 'IN_PROGRESS', minutes: 3 },
    { code: '2472', product: 'Avocado toast + tea', store: 'Marina Bay', status: 'ACCEPTED', minutes: 5 },
    { code: '2473', product: 'Double espresso', store: 'Airport T3', status: 'READY', minutes: 0 },
    { code: '2474', product: 'Matcha oat + croissant', store: 'Downtown Hub', status: 'PAID', minutes: 8 },
  ];

  readonly storePerf = [
    { name: 'Downtown Hub', value: '$3,120', percent: 92 },
    { name: 'Marina Bay', value: '$2,580', percent: 78 },
    { name: 'Airport T3', value: '$1,640', percent: 54 },
    { name: 'Parkside', value: '$1,072', percent: 38 },
  ];

  name(): string {
    return this.store.user()?.name ?? '';
  }

  statusLabel(status: DashboardOrder['status']): string {
    return {
      READY: 'Ready',
      IN_PROGRESS: 'Preparing',
      ACCEPTED: 'Accepted',
      PAID: 'Queued',
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
