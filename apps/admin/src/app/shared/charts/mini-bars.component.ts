import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { type ChartTip, injectChartHover } from './chart-tooltip';

/**
 * Compact day-by-day bars without axes, for a KPI card. Each column is the
 * whole width of its day, so the hover target has no gaps; hover or a tap
 * shows that day's `tips` card.
 */
@Component({
  selector: 'app-mini-bars',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mb"
      role="img"
      [attr.aria-label]="label()"
      [style.height.px]="height()"
      [style.--mb-pad.px]="bars().length > 20 ? 0.5 : 1.5"
      (pointermove)="onPointer($event)"
      (pointerup)="onPointer($event)"
      (pointerleave)="hover.leave($event)"
    >
      @for (b of bars(); track $index) {
        <div class="mb-col" [class.is-active]="hover.active() === $index">
          <div
            class="mb-bar"
            [class.mb-bar-zero]="b === 0"
            [style.height.%]="b || 3"
            [style.background]="b ? color() : null"
          ></div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .mb {
        display: flex;
        align-items: stretch;
        width: 100%;
        overflow: hidden;
        touch-action: pan-y;
      }
      .mb-col {
        flex: 1;
        min-width: 0;
        padding: 0 var(--mb-pad);
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: center;
      }
      .mb-col.is-active {
        background: color-mix(in srgb, var(--color-text-primary) 7%, transparent);
      }
      .mb-bar {
        width: 100%;
        max-width: 14px;
        min-height: 2px;
        border-radius: 3px 3px 0 0;
      }
      .mb-bar-zero {
        background: var(--chart-track);
      }
    `,
  ],
})
export class MiniBarsComponent {
  readonly values = input<readonly number[]>([]);
  readonly height = input(56);
  readonly color = input('var(--chart-money)');
  readonly tips = input<ReadonlyArray<ChartTip | null>>([]);
  readonly label = input('');

  protected readonly hover = injectChartHover(() => [this.values(), this.tips()]);

  /** Heights in % of the tallest. */
  protected readonly bars = computed(() => {
    const vals = this.values();
    const max = Math.max(1, ...vals);
    return vals.map((v) => (v > 0 ? Math.max(4, (v / max) * 100) : 0));
  });

  protected onPointer(e: PointerEvent): void {
    const box = e.currentTarget as HTMLElement;
    const n = this.bars().length;
    if (!n || !this.hover.accepts(e)) return;
    const r = box.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
    const col = box.children[i]?.getBoundingClientRect();
    this.hover.show(i, this.tips()[i], col ? col.left + col.width / 2 : e.clientX, r.top);
  }
}
