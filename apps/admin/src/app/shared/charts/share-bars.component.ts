import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { type ChartTip, type ChartTipLine, injectChartHover } from './chart-tooltip';

export interface ShareRow {
  key: string;
  name: string;
  value: number;
  /** Share of the whole, 0..100. */
  share: number;
  /** The period before; null hides the comparison (a plan without it). */
  previous: number | null;
  /** More rows for the hover card: orders, check… */
  extra?: ReadonlyArray<ChartTipLine | null | false>;
}

/** The words the component prints, already translated. */
export interface ShareBarsText {
  value: string;
  share: string;
  change: string;
  previous: string;
  others: (count: number) => string;
  collapse: string;
  empty: string;
}

/**
 * "Who brought how much": a horizontal bar per row, the value, its share and
 * — when the period before is known — a diverging bar with the change.
 * Rows past `limit` fold into "Others (N)". Hover shows the numbers; a click
 * picks the row.
 */
@Component({
  selector: 'app-share-bars',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sb" [class.sb-compare]="compare()">
      <div class="sb-row sb-head" aria-hidden="true">
        <span></span>
        <span></span>
        <span class="sb-num">{{ text().value }}</span>
        <span class="sb-num sb-share-head">{{ text().share }}</span>
        @if (compare()) {
          <span class="sb-num sb-change-head">{{ text().change }}</span>
        }
      </div>
      @for (r of visible(); track r.key) {
        <div
          class="sb-row sb-body"
          [class.is-active]="hover.active() === $index"
          [class.is-picked]="picked() === r.key"
          [attr.role]="r.isOther ? null : 'button'"
          [attr.tabindex]="r.isOther ? null : 0"
          [attr.aria-pressed]="r.isOther ? null : picked() === r.key"
          (pointerenter)="onRow($event, $index)"
          (pointerup)="onRow($event, $index)"
          (pointerleave)="hover.leave($event)"
          (focus)="hover.focus($index, r.tip, $any($event.target))"
          (blur)="hover.clear()"
          (click)="r.isOther ? expanded.set(true) : pick.emit(r.key)"
          (keydown.enter)="r.isOther ? expanded.set(true) : pick.emit(r.key)"
        >
          <span class="sb-name">
            @if (r.isOther) {
              <button type="button" class="sb-more">{{ text().others(r.count) }} ▾</button>
            } @else {
              <span class="sb-ava" aria-hidden="true">{{ r.name.charAt(0) }}</span>
              <span class="sb-label">{{ r.name }}</span>
            }
          </span>
          <span class="sb-track" aria-hidden="true">
            <span class="sb-bar" [style.width.%]="r.width" [class.sb-bar-other]="r.isOther"></span>
          </span>
          <span class="sb-num sb-value">{{ format()(r.value) }}</span>
          <span class="sb-num sb-share">{{ r.shareText }}</span>
          @if (compare()) {
            <span class="sb-change">
              <span class="sb-diverge" aria-hidden="true">
                <span class="sb-dbar" [class.sb-dbar-neg]="r.diff < 0" [style.width.%]="r.diffWidth"></span>
              </span>
              <span class="sb-num" [class.sb-pos]="r.diff > 0" [class.sb-neg]="r.diff < 0">{{ r.diffText }}</span>
            </span>
          }
        </div>
      } @empty {
        <p class="sb-empty">{{ text().empty }}</p>
      }
      @if (expanded() && rows().length > limit() + 1) {
        <button type="button" class="sb-more sb-collapse" (click)="expanded.set(false)">{{ text().collapse }} ▴</button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        container-type: inline-size;
      }
      .sb {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .sb-row {
        display: grid;
        grid-template-columns: minmax(90px, 170px) minmax(40px, 1fr) minmax(76px, auto) 48px;
        align-items: center;
        gap: 12px;
        min-height: 30px;
      }
      .sb-compare .sb-row {
        grid-template-columns: minmax(90px, 170px) minmax(40px, 1fr) minmax(76px, auto) 48px minmax(120px, 180px);
      }
      .sb-body {
        border-radius: 8px;
        cursor: pointer;
        outline: none;
      }
      .sb-body.is-active,
      .sb-body:focus-visible {
        background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-text-primary) 5%, transparent);
      }
      .sb-body.is-picked {
        box-shadow: inset 3px 0 0 var(--color-caramel);
      }
      .sb-head {
        min-height: 0;
        font-size: 11px;
        color: var(--color-text-tertiary);
      }
      .sb-name {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        color: var(--color-text-primary);
      }
      .sb-ava {
        flex: 0 0 22px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        text-transform: uppercase;
      }
      .sb-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sb-track {
        display: flex;
        height: 8px;
      }
      .sb-bar {
        height: 100%;
        min-width: 3px;
        border-radius: 4px;
        background: var(--chart-money);
      }
      .sb-bar-other {
        background: var(--chart-track);
      }
      .sb-num {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .sb-value {
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .sb-share {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .sb-change {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
      }
      .sb-diverge {
        position: relative;
        height: 8px;
        border-radius: 4px;
        background: var(--chart-track);
      }
      .sb-diverge::after {
        content: '';
        position: absolute;
        left: 50%;
        top: -2px;
        bottom: -2px;
        width: 1px;
        background: var(--color-text-tertiary);
      }
      .sb-dbar {
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        border-radius: 4px;
        background: var(--color-positive);
      }
      .sb-dbar-neg {
        left: auto;
        right: 50%;
        background: var(--chart-negative);
      }
      .sb-pos {
        color: var(--color-positive);
      }
      .sb-neg {
        color: var(--color-negative);
      }
      .sb-more {
        border: none;
        background: none;
        padding: 0;
        cursor: pointer;
        font: inherit;
        color: var(--color-text-secondary);
        text-align: left;
      }
      .sb-collapse {
        font-size: 12px;
      }
      .sb-empty {
        margin: 0;
        padding: 16px 0;
        color: var(--color-text-tertiary);
        text-align: center;
      }
      /* A narrower card drops the share column; the tooltip still has it. */
      @container (max-width: 480px) {
        .sb-compare .sb-row {
          grid-template-columns: minmax(80px, 150px) minmax(30px, 1fr) auto minmax(100px, 150px);
          gap: 10px;
        }
        .sb-compare .sb-share,
        .sb-compare .sb-share-head {
          display: none;
        }
      }
      /* A phone keeps the name, the value and the change. */
      @container (max-width: 400px) {
        .sb-row,
        .sb-compare .sb-row {
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 8px;
        }
        .sb-track,
        .sb-diverge,
        .sb-head > span:nth-child(2) {
          display: none;
        }
        .sb-change {
          display: block;
          min-width: 64px;
        }
        .sb-change .sb-num {
          font-size: 12px;
        }
      }
    `,
  ],
})
export class ShareBarsComponent {
  readonly rows = input<readonly ShareRow[]>([]);
  readonly limit = input(6);
  readonly compare = input(false);
  readonly format = input<(v: number) => string>((v) => String(v));
  readonly percent = input<(v: number) => string>((v) => `${Math.round(v)} %`);
  readonly text = input.required<ShareBarsText>();
  /** The row the page is filtered to, if any. */
  readonly picked = input<string | null>(null);
  readonly pick = output<string>();

  protected readonly expanded = signal(false);
  protected readonly hover = injectChartHover(() => this.visible());

  protected readonly visible = computed(() => {
    const rows = [...this.rows()].sort((a, b) => b.value - a.value);
    const limit = this.limit();
    type Shown = ShareRow & { isOther: boolean; count: number; names: string[] };
    let shown: Shown[] = rows.map((r) => ({ ...r, isOther: false, count: 0, names: [] }));
    if (!this.expanded() && rows.length > limit + 1) {
      const rest = rows.slice(limit);
      const anyPrevious = rest.some((r) => r.previous !== null);
      shown = [
        ...shown.slice(0, limit),
        {
          key: '__other__',
          name: this.text().others(rest.length),
          isOther: true,
          count: rest.length,
          names: rest.map((r) => r.name),
          value: rest.reduce((s, r) => s + r.value, 0),
          share: rest.reduce((s, r) => s + r.share, 0),
          previous: anyPrevious ? rest.reduce((s, r) => s + (r.previous ?? 0), 0) : null,
        },
      ];
    }
    const max = Math.max(1, ...shown.map((r) => r.value));
    const maxDiff = Math.max(1, ...shown.map((r) => Math.abs(r.value - (r.previous ?? r.value))));
    const fmt = this.format();
    const pct = this.percent();
    const t = this.text();
    return shown.map((r) => {
      const diff = r.previous === null ? 0 : r.value - r.previous;
      const shareText = pct(r.share);
      const diffText = r.previous === null ? '' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${fmt(Math.abs(diff))}`;
      const tip: ChartTip = {
        title: r.name,
        lines: [
          { label: t.value, value: fmt(r.value), color: r.isOther ? undefined : 'var(--chart-money)', strong: true },
          { label: t.share, value: shareText },
          ...(r.isOther ? [] : (r.extra ?? [])),
          r.previous !== null && { label: t.previous, value: fmt(r.previous) },
          r.previous !== null && { label: t.change, value: diffText || '0' },
        ],
        note: r.names.length ? othersNote(r.names) : undefined,
      };
      return {
        ...r,
        width: (r.value / max) * 100,
        shareText,
        diff,
        diffText,
        diffWidth: Math.min(50, (Math.abs(diff) / maxDiff) * 50),
        tip,
      };
    });
  });

  protected onRow(e: PointerEvent, i: number): void {
    if (!this.hover.accepts(e)) return;
    const row = e.currentTarget as HTMLElement;
    const track = row.querySelector('.sb-track')?.getBoundingClientRect();
    const r = track && track.width > 0 ? track : row.getBoundingClientRect();
    this.hover.show(i, this.visible()[i]?.tip, r.left + Math.min(r.width, 160) / 2, r.top);
  }
}

function othersNote(names: readonly string[]): string {
  const head = names.slice(0, 4).join(', ');
  return names.length > 4 ? `${head} +${names.length - 4}` : head;
}
