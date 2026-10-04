import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A dashboard figure: the number, its change against the period before and
 * a small chart of the period's days (projected with `kpiChart`).
 *
 *  - `size="lg"`: chart under the number, two footnotes at the bottom;
 *  - `size="sm"`: compact, chart to the right of the number (under it on a
 *    phone).
 *
 * `delta` decides the arrow and the colour; `deltaText` is how the page
 * wrote it ("+12,5 %", "−1,2 п.п."). `invert` is for figures where growth is
 * bad news — cancellations, expired orders.
 */
@Component({
  selector: 'app-kpi-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="kpi" [class.kpi-sm]="size() === 'sm'" [attr.aria-label]="label()">
      <div class="kpi-main">
        <span class="kpi-label">{{ label() }}</span>
        <span class="kpi-value" [title]="value()">{{ value() }}</span>
        <span class="kpi-delta" [attr.data-tone]="tone()">
          @if (deltaText()) {
            <span class="kpi-arrow" aria-hidden="true">{{ arrow() }}</span>
            <span>{{ deltaText() }}</span>
          }
          @if (hint()) {
            <span class="kpi-hint">{{ hint() }}</span>
          }
        </span>
      </div>
      <div class="kpi-chart"><ng-content select="[kpiChart]" /></div>
      @if (footLeft() || footRight()) {
        <div class="kpi-foot">
          <span [title]="footLeft()">{{ footLeft() }}</span>
          <span [title]="footRight()">{{ footRight() }}</span>
        </div>
      }
    </article>
  `,
  styles: [
    `
      :host {
        display: flex;
        min-width: 0;
        container-type: inline-size;
      }
      .kpi {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 18px 20px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 20px;
        font-family: var(--font-sans);
      }
      .kpi-main {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .kpi-label {
        font-size: 12px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .kpi-value {
        font-family: var(--font-display);
        font-size: 30px;
        line-height: 1.15;
        font-weight: 700;
        color: var(--color-espresso);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .kpi-delta {
        min-height: 16px;
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 2px 6px;
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-tertiary);
      }
      .kpi-delta[data-tone='up'] {
        color: var(--color-positive);
      }
      .kpi-delta[data-tone='down'] {
        color: var(--color-negative);
      }
      .kpi-arrow {
        margin-right: -2px;
      }
      .kpi-hint {
        font-weight: 400;
        color: var(--color-text-tertiary);
      }
      .kpi-chart {
        margin-top: auto;
        min-width: 0;
      }
      .kpi-chart:empty {
        display: none;
      }
      .kpi-foot {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 2px 10px;
        padding-top: 8px;
        border-top: 1px solid var(--color-border-light);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .kpi-foot span {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .kpi-sm {
        flex-direction: row;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
      }
      .kpi-sm .kpi-main {
        flex: 1;
      }
      .kpi-sm .kpi-label {
        font-size: 11px;
      }
      .kpi-sm .kpi-value {
        font-size: 22px;
      }
      .kpi-sm .kpi-chart {
        flex: 0 0 40%;
        margin-top: 0;
      }
      @media (max-width: 767px) {
        .kpi {
          padding: 14px 16px;
        }
        .kpi-value {
          font-size: 26px;
        }
      }
      /* A narrow small card puts its chart under the number. */
      @container (max-width: 250px) {
        .kpi-sm {
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
        }
        .kpi-sm .kpi-value {
          font-size: 20px;
        }
        .kpi-sm .kpi-chart {
          flex: none;
          width: 100%;
        }
      }
    `,
  ],
})
export class KpiCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly delta = input<number | null>(null);
  readonly deltaText = input('');
  readonly invert = input(false);
  readonly hint = input('');
  readonly size = input<'lg' | 'sm'>('lg');
  readonly footLeft = input('');
  readonly footRight = input('');

  protected readonly arrow = computed(() => {
    const d = this.delta() ?? 0;
    return d > 0 ? '↗' : d < 0 ? '↘' : '→';
  });

  protected readonly tone = computed(() => {
    const d = this.delta();
    if (d === null || Math.abs(d) < 0.05) return 'flat';
    return (this.invert() ? d < 0 : d > 0) ? 'up' : 'down';
  });
}
