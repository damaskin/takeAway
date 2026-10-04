import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { type ChartTip, injectChartHover } from './chart-tooltip';

export interface BarItem {
  /** Under the bar: "14", "Пн". */
  label: string;
  value: number;
  /** The same value in words, for the screen-reader table. */
  valueText: string;
  /** Longer name for the table: "14:00–15:00", "Понедельник". */
  title: string;
  tip: ChartTip | null;
}

/**
 * Vertical bars over categories — load by hour or by weekday. The tallest
 * bar wears the full colour, the rest a lighter step, so the peak reads at a
 * glance; hover or a tap shows the card. A hidden table carries the same
 * numbers for screen readers.
 */
@Component({
  selector: 'app-bar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bc" [style.--bar-h.px]="height()" [style.--bar-color]="color()">
      <div
        class="bc-bars"
        aria-hidden="true"
        (pointermove)="onPointer($event)"
        (pointerup)="onPointer($event)"
        (pointerleave)="hover.leave($event)"
      >
        @for (it of bars(); track it.label) {
          <div class="bc-col" [class.is-active]="hover.active() === $index">
            <div class="bc-wrap">
              <div
                class="bc-bar"
                [class.bc-bar-peak]="it.peak"
                [class.bc-bar-zero]="it.value === 0"
                [style.height.%]="it.height"
              ></div>
            </div>
            <span class="bc-label">{{ it.label }}</span>
          </div>
        }
      </div>
      <table class="sr-only-table">
        <caption>
          {{
            label()
          }}
        </caption>
        <tbody>
          @for (it of items(); track it.label) {
            <tr>
              <th scope="row">{{ it.title }}</th>
              <td>{{ it.valueText }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .bc {
        position: relative;
        width: 100%;
      }
      .bc-bars {
        display: flex;
        align-items: stretch;
        height: var(--bar-h);
        touch-action: pan-y;
      }
      .bc-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        min-width: 0;
        padding: 0 2px;
      }
      .bc-wrap {
        flex: 1;
        display: flex;
        align-items: flex-end;
        padding: 2px 0;
        border-radius: 6px;
        border-bottom: 1px solid var(--chart-grid);
      }
      .bc-col.is-active .bc-wrap {
        background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
      }
      .bc-col.is-active .bc-label {
        color: var(--color-text-primary);
      }
      .bc-bar {
        width: 100%;
        min-height: 2px;
        border-radius: 4px 4px 0 0;
        background: color-mix(in srgb, var(--bar-color) 55%, var(--color-foam));
        transition: height 200ms ease-out;
      }
      .bc-bar-peak {
        background: var(--bar-color);
      }
      .bc-bar-zero {
        background: var(--chart-track);
      }
      .bc-label {
        margin-top: 4px;
        font-family: var(--font-sans);
        font-size: 10px;
        text-align: center;
        color: var(--color-text-tertiary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class BarChartComponent {
  readonly items = input.required<readonly BarItem[]>();
  readonly height = input(150);
  readonly color = input('var(--chart-orders)');
  /** Caption of the screen-reader table. */
  readonly label = input('');

  protected readonly hover = injectChartHover(() => this.items());

  protected readonly bars = computed(() => {
    const items = this.items();
    const max = Math.max(...items.map((i) => i.value), 0);
    return items.map((it) => ({
      label: it.label,
      value: it.value,
      peak: max > 0 && it.value === max,
      height: max > 0 ? (it.value / max) * 100 : 0,
    }));
  });

  protected onPointer(e: PointerEvent): void {
    const box = e.currentTarget as HTMLElement;
    const n = this.items().length;
    if (!n || !this.hover.accepts(e)) return;
    const r = box.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
    const col = box.children[i]?.getBoundingClientRect();
    this.hover.show(i, this.items()[i]?.tip, col ? col.left + col.width / 2 : e.clientX, r.top);
  }
}
