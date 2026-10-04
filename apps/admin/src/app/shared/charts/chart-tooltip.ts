import { DOCUMENT, DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';

export interface ChartTipLine {
  label: string;
  value: string;
  /** Swatch of the series to the left of the label. */
  color?: string;
  /** The headline row: darker label, bolder value. */
  strong?: boolean;
}

/** What the card shows for one bar, point or row. */
export interface ChartTip {
  title: string;
  /** A pill next to the title, e.g. "today" for a day still running. */
  badge?: string;
  /** Falsy entries are skipped — handy for optional rows. */
  lines: ReadonlyArray<ChartTipLine | null | undefined | false>;
  /** Small print under a rule. */
  note?: string;
}

/**
 * One tooltip card for the whole admin. A chart calls `show()` with an
 * anchor in viewport coordinates: the card sits above it (below when there
 * is no room) and stays inside the window. The node lives in <body> with
 * `position: fixed`, so no `overflow: hidden` card or table clips it; its
 * styles are global (`.chart-tip` in styles.css).
 *
 * Scrolling, resizing, the window losing focus and a tap anywhere else hide
 * it.
 */
@Injectable({ providedIn: 'root' })
export class ChartTooltipService {
  private readonly doc = inject(DOCUMENT);
  private node: HTMLElement | null = null;
  /** The chart that owns the card now: its callback resets its highlight. */
  private owner: (() => void) | null = null;

  constructor() {
    const hide = () => this.hide();
    const win = this.doc.defaultView;
    win?.addEventListener('scroll', hide, true);
    win?.addEventListener('resize', hide);
    win?.addEventListener('blur', hide);
    // A touch anywhere closes the card; a tap on a chart then opens its own
    // on pointerup. A mouse closes it by leaving the chart.
    this.doc.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && hide(), true);
  }

  show(tip: ChartTip, x: number, y: number, owner: () => void): void {
    if (this.owner !== owner) {
      const previous = this.owner;
      this.owner = owner;
      previous?.();
    }
    const el = this.ensureNode();
    this.render(el, tip);
    el.classList.add('is-on');
    const r = el.getBoundingClientRect();
    const vw = this.doc.documentElement.clientWidth;
    const left = Math.min(Math.max(8, x - r.width / 2), vw - r.width - 8);
    let top = y - r.height - 10;
    if (top < 8) top = y + 16;
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  hide(): void {
    const owner = this.owner;
    this.owner = null;
    this.node?.classList.remove('is-on');
    owner?.();
  }

  /** Hides the card only if this chart owns it. */
  release(owner: () => void): void {
    if (this.owner === owner) this.hide();
  }

  private ensureNode(): HTMLElement {
    if (!this.node) {
      this.node = this.doc.createElement('div');
      this.node.className = 'chart-tip';
      this.node.setAttribute('role', 'tooltip');
      this.doc.body.appendChild(this.node);
    }
    return this.node;
  }

  /** textContent only: store and brand names are user input. */
  private render(el: HTMLElement, tip: ChartTip): void {
    const make = (tag: string, cls: string, text?: string) => {
      const n = this.doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const title = make('div', 'chart-tip__title');
    title.append(make('span', '', tip.title));
    if (tip.badge) title.append(make('span', 'chart-tip__badge', tip.badge));
    const parts: Node[] = [title];
    for (const l of tip.lines) {
      if (!l) continue;
      const row = make('div', l.strong ? 'chart-tip__line chart-tip__line--strong' : 'chart-tip__line');
      const label = make('span', 'chart-tip__label');
      if (l.color) {
        const swatch = make('i', '');
        swatch.style.background = l.color;
        label.append(swatch);
      }
      label.append(l.label);
      row.append(label, make('span', 'chart-tip__value', l.value));
      parts.push(row);
    }
    if (tip.note) parts.push(make('div', 'chart-tip__note', tip.note));
    el.replaceChildren(...parts);
  }
}

/**
 * Hover for one chart: the highlighted index and the card. Call it in a
 * field initialiser; `source` is the chart's data — when it changes, the
 * highlight and the card reset so stale numbers never show.
 *
 * Mouse and pen follow `pointermove`/`pointerenter`; a finger only
 * `pointerup`, so a scroll swipe (which ends in `pointercancel`) does not
 * flash a card. Handlers start with `if (!hover.accepts(e)) return;`.
 */
export function injectChartHover(source?: () => unknown) {
  const tips = inject(ChartTooltipService);
  const active = signal(-1);
  let shown: ChartTip | null = null;
  const reset = () => {
    active.set(-1);
    shown = null;
  };
  const clear = () => {
    tips.release(reset);
    reset();
  };
  inject(DestroyRef).onDestroy(() => tips.release(reset));
  if (source) {
    effect(() => {
      source();
      untracked(clear);
    });
  }

  return {
    active: active.asReadonly(),
    accepts(e: PointerEvent): boolean {
      return e.pointerType !== 'touch' || e.type === 'pointerup';
    },
    /** Shows `tip` for item `i`, anchored at viewport point (x, y). */
    show(i: number, tip: ChartTip | null | undefined, x: number, y: number): void {
      if (!tip) {
        clear();
        return;
      }
      if (active() === i && shown === tip) return;
      active.set(i);
      shown = tip;
      tips.show(tip, x, y, reset);
    },
    /** Keyboard focus: the same card, anchored at the focused element. */
    focus(i: number, tip: ChartTip | null | undefined, el: Element): void {
      const r = el.getBoundingClientRect();
      this.show(i, tip, r.left + r.width / 2, r.top);
    },
    clear,
    /** For `(pointerleave)`: touch leaves right after lifting, so it is ignored. */
    leave(e: PointerEvent): void {
      if (e.pointerType !== 'touch') clear();
    },
  };
}

export type ChartHover = ReturnType<typeof injectChartHover>;
