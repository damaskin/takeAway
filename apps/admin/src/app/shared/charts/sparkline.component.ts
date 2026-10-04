import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { type ChartTip, injectChartHover } from './chart-tooltip';

/**
 * A line with a light fill under it, no axes. Stretches to the width of its
 * container at a fixed height. Hover (or a tap) puts a guide and a dot on
 * the nearest point and shows its `tips` card.
 */
@Component({
  selector: 'app-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="sl"
      role="img"
      [attr.aria-label]="label()"
      [style.height.px]="height()"
      [style.color]="color()"
      (pointermove)="onPointer($event)"
      (pointerup)="onPointer($event)"
      (pointerleave)="hover.leave($event)"
    >
      <svg class="sl-svg" [attr.viewBox]="'0 0 ' + W + ' ' + height()" preserveAspectRatio="none" aria-hidden="true">
        @if (geometry(); as g) {
          @if (area()) {
            <path class="sl-area" [attr.d]="g.area" />
          }
          <path class="sl-line" [attr.d]="g.line" />
        }
      </svg>
      <!-- The guide and the dot are HTML on top: inside a stretched svg the circle would squash. -->
      @if (hot(); as p) {
        <span class="sl-guide" [style.left.%]="p[0]"></span>
        <span class="sl-dot" [style.left.%]="p[0]" [style.top.px]="p[1]"></span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .sl {
        position: relative;
        width: 100%;
        touch-action: pan-y;
      }
      .sl-svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .sl-line {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }
      .sl-area {
        fill: currentColor;
        opacity: 0.12;
      }
      .sl-guide {
        position: absolute;
        top: 0;
        bottom: 0;
        border-left: 1px dashed var(--color-text-tertiary);
        pointer-events: none;
      }
      .sl-dot {
        position: absolute;
        box-sizing: border-box;
        width: 10px;
        height: 10px;
        margin: -5px 0 0 -5px;
        border-radius: 50%;
        background: currentColor;
        border: 2px solid var(--color-foam);
        pointer-events: none;
      }
    `,
  ],
})
export class SparklineComponent {
  readonly values = input<readonly number[]>([]);
  readonly height = input(40);
  readonly color = input('var(--chart-orders)');
  readonly area = input(true);
  /** False lets the line use the full height between its own min and max (an average, not a count). */
  readonly zeroBased = input(true);
  /** One card per point; null for none. */
  readonly tips = input<ReadonlyArray<ChartTip | null>>([]);
  /** What the chart shows, for screen readers. */
  readonly label = input('');

  protected readonly W = 100;
  protected readonly hover = injectChartHover(() => [this.values(), this.tips()]);

  protected readonly geometry = computed(() => {
    const vals = this.values();
    if (vals.length < 2) return null;
    const h = this.height();
    const pad = 3;
    const max = Math.max(...vals);
    const min = this.zeroBased() ? Math.min(0, ...vals) : Math.min(...vals.filter((v) => v > 0), max);
    const span = max - min || 1;
    const step = this.W / (vals.length - 1);
    const y = (v: number) => h - pad - (Math.max(0, v - min) / span) * (h - pad * 2);
    const pts = vals.map((v, i) => [i * step, y(v)] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    return { pts, line, area: `${line} L${this.W},${h} L0,${h} Z` };
  });

  /** The point under the pointer: [x in % of the width, y in px]. */
  protected readonly hot = computed(() => {
    const i = this.hover.active();
    return i >= 0 ? (this.geometry()?.pts[i] ?? null) : null;
  });

  protected onPointer(e: PointerEvent): void {
    const g = this.geometry();
    if (!g || !this.hover.accepts(e)) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const n = g.pts.length;
    const i = Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
    const [x, y] = g.pts[i] as readonly [number, number];
    this.hover.show(i, this.tips()[i], r.left + (x / this.W) * r.width, r.top + y);
  }
}
