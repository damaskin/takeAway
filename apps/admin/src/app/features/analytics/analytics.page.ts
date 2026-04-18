import { Component } from '@angular/core';

interface ChartBar {
  label: string;
  height: number;
  sub: string;
}

/**
 * Admin Analytics — pencil C6 (qZ5Ld).
 *
 * aTop (foam, 64px) — title + range selector
 * aBody (padding 24, gap 24):
 *   Revenue chart (foam 20-radius card with 40-bar column chart)
 *   Product mix + cohort cards row
 */
@Component({
  selector: 'app-admin-analytics',
  standalone: true,
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
        @for (r of ranges; track r) {
          <button
            type="button"
            [style.background]="r === activeRange ? 'var(--color-caramel)' : 'var(--color-foam)'"
            [style.color]="r === activeRange ? 'white' : 'var(--color-text-secondary)'"
            [style.border]="r === activeRange ? '1px solid transparent' : '1px solid var(--color-border-light)'"
            style="height: 32px; padding: 0 12px; border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
          >
            {{ r }}
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
              >Revenue · last 14 days</span
            >
            <div class="flex items-baseline" style="gap: 12px">
              <span
                style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso)"
                >$58,214</span
              >
              <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: #3E8868">
                ▲ 18.2%
              </span>
            </div>
          </div>
          <div class="flex flex-col" style="gap: 6px; text-align: right">
            <span
              style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >Best day</span
            >
            <span style="font-family: var(--font-sans); font-size: 16px; font-weight: 700; color: var(--color-espresso)"
              >Apr 12 · $5,120</span
            >
          </div>
        </header>

        <!-- Bar chart -->
        <div
          class="flex items-end"
          style="height: 180px; gap: 6px; padding: 0 4px; border-bottom: 1px solid var(--color-border-light)"
        >
          @for (b of bars; track b.label) {
            <div class="flex flex-col items-center justify-end flex-1" style="height: 100%; gap: 6px">
              <span style="font-family: var(--font-sans); font-size: 10px; color: var(--color-text-tertiary)">{{
                b.sub
              }}</span>
              <div
                [style.height.%]="b.height"
                style="width: 100%; background: linear-gradient(180deg, var(--color-caramel) 0%, #a0612a 100%); border-radius: 6px 6px 0 0; min-height: 6px"
              ></div>
            </div>
          }
        </div>
        <div class="flex" style="gap: 6px; padding: 0 4px">
          @for (b of bars; track b.label) {
            <span
              class="flex-1 text-center"
              style="font-family: var(--font-sans); font-size: 10px; color: var(--color-text-tertiary)"
              >{{ b.label }}</span
            >
          }
        </div>
      </article>

      <!-- Product mix + cohort stats -->
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 16px">
        <article
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
        >
          <h3
            style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            Top products
          </h3>
          @for (row of topProducts; track row.name) {
            <div class="flex flex-col" style="gap: 6px">
              <div class="flex items-center justify-between">
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                  >{{ row.name }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
                  >{{ row.units }} sold · {{ row.revenue }}</span
                >
              </div>
              <div
                style="height: 6px; border-radius: 9999px; background: var(--color-surface-variant); overflow: hidden"
              >
                <div
                  [style.width.%]="row.percent"
                  style="height: 100%; background: var(--color-caramel); border-radius: 9999px"
                ></div>
              </div>
            </div>
          }
        </article>

        <article
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px"
        >
          <h3
            style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            Customer cohort
          </h3>
          <div class="grid" style="grid-template-columns: repeat(2, 1fr); gap: 16px">
            @for (k of cohortStats; track k.label) {
              <div
                class="flex flex-col"
                style="background: var(--color-cream); border-radius: 14px; padding: 14px; gap: 6px"
              >
                <span
                  style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                  >{{ k.label }}</span
                >
                <span
                  style="font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-espresso)"
                  >{{ k.value }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                  k.note
                }}</span>
              </div>
            }
          </div>
        </article>
      </div>
    </section>
  `,
})
export class AdminAnalyticsPage {
  readonly ranges = ['7 days', '14 days', '30 days', '90 days'];
  readonly activeRange = '14 days';

  // 14 bars of varying heights. "height" is a percentage of the chart area.
  readonly bars: ChartBar[] = [
    { label: 'Apr 5', height: 52, sub: '' },
    { label: 'Apr 6', height: 48, sub: '' },
    { label: 'Apr 7', height: 62, sub: '' },
    { label: 'Apr 8', height: 70, sub: '' },
    { label: 'Apr 9', height: 55, sub: '' },
    { label: 'Apr 10', height: 78, sub: '' },
    { label: 'Apr 11', height: 82, sub: '' },
    { label: 'Apr 12', height: 95, sub: '$5.1k' },
    { label: 'Apr 13', height: 68, sub: '' },
    { label: 'Apr 14', height: 74, sub: '' },
    { label: 'Apr 15', height: 81, sub: '' },
    { label: 'Apr 16', height: 76, sub: '' },
    { label: 'Apr 17', height: 88, sub: '' },
    { label: 'Apr 18', height: 90, sub: '' },
  ];

  readonly topProducts = [
    { name: 'Caramel latte', units: '1,842', revenue: '$10,680', percent: 92 },
    { name: 'Matcha oat', units: '1,214', revenue: '$8,112', percent: 72 },
    { name: 'Avocado toast', units: '942', revenue: '$7,820', percent: 68 },
    { name: 'Cold brew', units: '784', revenue: '$5,330', percent: 48 },
    { name: 'Almond croissant', units: '612', revenue: '$3,240', percent: 32 },
  ];

  readonly cohortStats = [
    { label: 'Repeat rate', value: '68%', note: '+3% vs prior period' },
    { label: 'Avg basket', value: '$6.82', note: '+$0.18' },
    { label: 'New signups', value: '412', note: '+11%' },
    { label: 'Pickup SLA', value: '94%', note: '≤ 7 min goal' },
  ];
}
