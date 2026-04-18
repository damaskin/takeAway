import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import {
  AnalyticsApi,
  type CohortStats,
  type RevenueSeries,
  type TopProduct,
} from '../../core/analytics/analytics.service';

interface ChartBar {
  label: string;
  sub: string;
  height: number;
}

/**
 * Admin Analytics — pencil C6 (qZ5Ld).
 *
 * Pulls live /admin/analytics endpoints: revenue series (bar chart),
 * top products (progress list), cohort stats (stat grid).
 */
@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div
      class="flex items-center justify-between"
      style="height: 64px; padding: 0 24px; background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        Analytics
      </h1>
      <div class="flex items-center" style="gap: 8px">
        @for (r of ranges; track r.days) {
          <button
            type="button"
            (click)="setRange(r.days)"
            [style.background]="activeRange() === r.days ? 'var(--color-caramel)' : 'var(--color-foam)'"
            [style.color]="activeRange() === r.days ? 'white' : 'var(--color-text-secondary)'"
            [style.border]="activeRange() === r.days ? '1px solid transparent' : '1px solid var(--color-border-light)'"
            style="height: 32px; padding: 0 12px; border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
          >
            {{ r.label }}
          </button>
        }
      </div>
    </div>

    <section style="padding: 24px; display: flex; flex-direction: column; gap: 24px">
      <!-- Revenue chart -->
      <article
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 24px; gap: 20px"
      >
        <header class="flex items-start justify-between" style="gap: 16px">
          <div class="flex flex-col" style="gap: 4px">
            <span
              style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >Revenue · last {{ activeRange() }} days</span
            >
            <div class="flex items-baseline" style="gap: 12px">
              <span
                style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso)"
                >{{ price(revenue()?.totalRevenueCents ?? 0) }}</span
              >
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600"
                [style.color]="(revenue()?.revenueDeltaPercent ?? 0) >= 0 ? '#3E8868' : 'var(--color-berry)'"
              >
                {{ (revenue()?.revenueDeltaPercent ?? 0) >= 0 ? '▲' : '▼' }}
                {{ revenue()?.revenueDeltaPercent ?? 0 | number: '1.1-1' }}%
              </span>
            </div>
          </div>
          @if (revenue()?.bestDay) {
            <div class="flex flex-col" style="gap: 6px; text-align: right">
              <span
                style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >Best day</span
              >
              <span
                style="font-family: var(--font-sans); font-size: 16px; font-weight: 700; color: var(--color-espresso)"
                >{{ formatDate(revenue()!.bestDay!.date) }} · {{ price(revenue()!.bestDay!.revenueCents) }}</span
              >
            </div>
          }
        </header>

        <!-- Bar chart -->
        @if (bars().length === 0) {
          <p
            class="text-center"
            style="padding: 40px 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            No data for this range yet.
          </p>
        } @else {
          <div
            class="flex items-end"
            style="height: 180px; gap: 6px; padding: 0 4px; border-bottom: 1px solid var(--color-border-light)"
          >
            @for (b of bars(); track b.label) {
              <div class="flex flex-col items-center justify-end flex-1" style="height: 100%; gap: 6px">
                <span
                  style="font-family: var(--font-sans); font-size: 10px; color: var(--color-text-tertiary); height: 12px"
                  >{{ b.sub }}</span
                >
                <div
                  [style.height.%]="b.height"
                  style="width: 100%; background: linear-gradient(180deg, var(--color-caramel) 0%, #a0612a 100%); border-radius: 6px 6px 0 0; min-height: 2px"
                ></div>
              </div>
            }
          </div>
          <div class="flex" style="gap: 6px; padding: 0 4px">
            @for (b of bars(); track b.label) {
              <span
                class="flex-1 text-center"
                style="font-family: var(--font-sans); font-size: 10px; color: var(--color-text-tertiary)"
                >{{ b.label }}</span
              >
            }
          </div>
        }
      </article>

      <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 16px">
        <!-- Top products -->
        <article
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
        >
          <h3
            style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            Top products
          </h3>
          @if (topProducts().length === 0) {
            <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
              No orders yet.
            </p>
          } @else {
            @for (row of topProducts(); track row.name) {
              <div class="flex flex-col" style="gap: 6px">
                <div class="flex items-center justify-between">
                  <span
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                    >{{ row.name }}</span
                  >
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
                    >{{ row.unitsSold }} sold · {{ price(row.revenueCents) }}</span
                  >
                </div>
                <div
                  style="height: 6px; border-radius: 9999px; background: var(--color-surface-variant); overflow: hidden"
                >
                  <div
                    [style.width.%]="percentFor(row)"
                    style="height: 100%; background: var(--color-caramel); border-radius: 9999px"
                  ></div>
                </div>
              </div>
            }
          }
        </article>

        <!-- Cohort -->
        <article
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
        >
          <h3
            style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            Customer cohort · last 30 days
          </h3>
          <div class="grid" style="grid-template-columns: repeat(2, 1fr); gap: 16px">
            <div
              style="background: var(--color-cream); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 6px"
            >
              <span
                style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >Repeat rate</span
              >
              <span
                style="font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-espresso)"
                >{{ cohort()?.repeatRatePercent ?? 0 }}%</span
              >
            </div>
            <div
              style="background: var(--color-cream); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 6px"
            >
              <span
                style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >Avg basket</span
              >
              <span
                style="font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-espresso)"
                >{{ price(cohort()?.avgBasketCents ?? 0) }}</span
              >
            </div>
            <div
              style="background: var(--color-cream); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 6px"
            >
              <span
                style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >New customers</span
              >
              <span
                style="font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-espresso)"
                >{{ cohort()?.newCustomers ?? 0 }}</span
              >
            </div>
            <div
              style="background: var(--color-cream); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 6px"
            >
              <span
                style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >Pickup SLA</span
              >
              <span
                style="font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-espresso)"
                >{{ cohort()?.pickupSlaPercent ?? 0 }}%</span
              >
            </div>
          </div>
        </article>
      </div>
    </section>
  `,
})
export class AdminAnalyticsPage implements OnInit {
  private readonly api = inject(AnalyticsApi);

  readonly activeRange = signal(14);
  readonly ranges = [
    { days: 7, label: '7 days' },
    { days: 14, label: '14 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
  ];

  readonly revenue = signal<RevenueSeries | null>(null);
  readonly topProducts = signal<TopProduct[]>([]);
  readonly cohort = signal<CohortStats | null>(null);

  readonly bars = computed<ChartBar[]>(() => {
    const r = this.revenue();
    if (!r || r.points.length === 0) return [];
    const max = Math.max(...r.points.map((p) => p.revenueCents));
    if (max === 0) return r.points.map((p) => ({ label: this.shortDay(p.date), sub: '', height: 0 }));
    const best = r.bestDay;
    return r.points.map((p) => ({
      label: this.shortDay(p.date),
      sub: best && p.date === best.date ? `$${Math.round(p.revenueCents / 100)}` : '',
      height: Math.round((p.revenueCents / max) * 100),
    }));
  });

  ngOnInit(): void {
    this.fetch();
  }

  setRange(days: number): void {
    if (days === this.activeRange()) return;
    this.activeRange.set(days);
    this.fetch();
  }

  percentFor(row: TopProduct): number {
    const max = Math.max(...this.topProducts().map((r) => r.revenueCents), 1);
    return Math.round((row.revenueCents / max) * 100);
  }

  price(cents: number): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  shortDay(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  private fetch(): void {
    this.api.revenue(this.activeRange()).subscribe({ next: (r) => this.revenue.set(r) });
    this.api.topProducts(6).subscribe({ next: (p) => this.topProducts.set(p) });
    this.api.cohort(30).subscribe({ next: (c) => this.cohort.set(c) });
  }
}
