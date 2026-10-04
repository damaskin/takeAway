import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { type ChartTip, injectChartHover } from './chart-tooltip';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

const R = 42;
const C = 2 * Math.PI * R;
/** The surface gap between two slices, in viewBox units. */
const GAP = 1.6;

/**
 * Parts of a whole: a ring with the total in the middle and a legend with
 * each part's count and share, so a colour is never the only way to tell
 * the parts apart. Hover over a slice or a legend row highlights both.
 */
@Component({
  selector: 'app-donut-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dn">
      <div class="dn-ring" [style.width.px]="size()" [style.height.px]="size()">
        <svg viewBox="0 0 100 100" role="img" [attr.aria-label]="label()">
          <circle class="dn-track" cx="50" cy="50" [attr.r]="R" />
          @for (s of arcs(); track s.key) {
            <circle
              class="dn-arc"
              cx="50"
              cy="50"
              [attr.r]="R"
              [attr.stroke]="s.color"
              [attr.stroke-dasharray]="s.dash"
              [attr.stroke-dashoffset]="s.offset"
              [class.is-dim]="hover.active() >= 0 && hover.active() !== $index"
              (pointerenter)="onSlice($event, $index)"
              (pointerup)="onSlice($event, $index)"
              (pointerleave)="hover.leave($event)"
            />
          }
        </svg>
        <div class="dn-center" aria-hidden="true">
          <strong>{{ totalText() }}</strong>
          <span>{{ centerLabel() }}</span>
        </div>
      </div>
      <ul class="dn-legend">
        @for (s of arcs(); track s.key) {
          <li
            [class.is-active]="hover.active() === $index"
            (pointerenter)="onSlice($event, $index)"
            (pointerleave)="hover.leave($event)"
          >
            <i [style.background]="s.color"></i>
            <span class="dn-name">{{ s.label }}</span>
            <span class="dn-value">{{ s.value }}</span>
            <span class="dn-share">{{ s.shareText }}</span>
          </li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .dn {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 20px;
        font-family: var(--font-sans);
      }
      .dn-ring {
        position: relative;
        flex: none;
      }
      .dn-ring svg {
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }
      .dn-track {
        fill: none;
        stroke: var(--chart-track);
        stroke-width: 12;
      }
      .dn-arc {
        fill: none;
        stroke-width: 12;
        transition: opacity 120ms;
        cursor: default;
      }
      .dn-arc.is-dim {
        opacity: 0.35;
      }
      .dn-center {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      .dn-center strong {
        font-family: var(--font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--color-text-primary);
        font-variant-numeric: tabular-nums;
      }
      .dn-center span {
        font-size: 11px;
        color: var(--color-text-tertiary);
      }
      .dn-legend {
        flex: 1 1 160px;
        min-width: 0;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
      }
      .dn-legend li {
        display: grid;
        grid-template-columns: 10px minmax(0, 1fr) auto 48px;
        align-items: center;
        gap: 8px;
        padding: 3px 6px;
        border-radius: 8px;
      }
      .dn-legend li.is-active {
        background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
      }
      .dn-legend i {
        width: 10px;
        height: 10px;
        border-radius: 3px;
      }
      .dn-name {
        color: var(--color-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dn-value {
        font-weight: 600;
        color: var(--color-text-primary);
        font-variant-numeric: tabular-nums;
      }
      .dn-share {
        text-align: right;
        color: var(--color-text-tertiary);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class DonutChartComponent {
  readonly slices = input<readonly DonutSlice[]>([]);
  readonly size = input(150);
  /** Under the total: "всего". */
  readonly centerLabel = input('');
  readonly label = input('');
  readonly percent = input<(v: number) => string>((v) => `${Math.round(v)} %`);

  protected readonly R = R;
  protected readonly hover = injectChartHover(() => this.slices());

  private readonly total = computed(() => this.slices().reduce((sum, s) => sum + s.value, 0));
  protected readonly totalText = computed(() => String(this.total()));

  protected readonly arcs = computed(() => {
    const total = this.total();
    const slices = this.slices().filter((s) => s.value > 0);
    const gap = slices.length > 1 ? GAP : 0;
    let start = 0;
    return slices.map((s) => {
      const len = total > 0 ? (s.value / total) * C : 0;
      const visible = Math.max(0.5, len - gap);
      const arc = {
        ...s,
        dash: `${visible} ${C - visible}`,
        offset: -start,
        shareText: total > 0 ? this.percent()((s.value / total) * 100) : '',
      };
      start += len;
      return arc;
    });
  });

  private readonly tips = computed<ChartTip[]>(() =>
    this.arcs().map((s) => ({
      title: s.label,
      lines: [{ label: this.label(), value: `${s.value} · ${s.shareText}`, color: s.color, strong: true }],
    })),
  );

  protected onSlice(e: PointerEvent, i: number): void {
    if (!this.hover.accepts(e)) return;
    const el = e.currentTarget as Element;
    const r = el.getBoundingClientRect();
    this.hover.show(i, this.tips()[i], r.left + r.width / 2, r.top);
  }
}
