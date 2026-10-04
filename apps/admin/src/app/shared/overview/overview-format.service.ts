import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { OverviewDay, OverviewHour, OverviewPeriod, OverviewWeekday } from '@takeaway/shared-types';

import type { BarItem } from '../charts/bar-chart.component';
import type { ChartTip, ChartTipLine } from '../charts/chart-tooltip';
import type { DonutSlice } from '../charts/donut-chart.component';
import type { ShareBarsText } from '../charts/share-bars.component';

/** Percent change from `previous` to `current`; null when there is nothing to compare with. */
export function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Hours the load chart always shows; orders outside them widen it. */
const DAY_HOURS = { from: 7, to: 22 } as const;

/** The status groups of the donut, in ring order, with their colours. */
const STATUS_GROUPS: ReadonlyArray<{ key: string; statuses: readonly string[]; color: string }> = [
  { key: 'done', statuses: ['PICKED_UP', 'DELIVERED'], color: 'var(--chart-customers)' },
  {
    key: 'open',
    statuses: ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'OUT_FOR_DELIVERY'],
    color: 'var(--chart-orders)',
  },
  { key: 'cancelled', statuses: ['CANCELLED'], color: 'var(--chart-negative)' },
  { key: 'expired', statuses: ['EXPIRED'], color: 'var(--chart-warning)' },
];

/** Sort state of a table: the column and the direction, descending first. */
export function createSort<K extends string>(initial: K) {
  const key = signal<K>(initial);
  const desc = signal(true);
  return {
    key: key.asReadonly(),
    desc: desc.asReadonly(),
    toggle(k: K): void {
      if (key() === k) desc.update((v) => !v);
      else {
        key.set(k);
        desc.set(k !== 'name');
      }
    },
    apply<T>(rows: readonly T[], pick: (row: T, k: K) => number | string | null): T[] {
      const k = key();
      const dir = desc() ? -1 : 1;
      return [...rows].sort((a, b) => {
        const va = pick(a, k);
        const vb = pick(b, k);
        // Blanks sink to the bottom whichever way the column runs.
        if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
        if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir;
        return (va - vb) * dir;
      });
    },
  };
}

export type TableSort<K extends string> = ReturnType<typeof createSort<K>>;

/**
 * How the dashboards write their numbers and build their chart cards, in the
 * viewer's language. Shared by a business's dashboard and the platform's.
 */
@Injectable({ providedIn: 'root' })
export class OverviewFormat {
  private readonly fmt = inject(LocaleFormatService);
  private readonly translate = inject(TranslateService);

  /** The UI language as a signal: read it in a `computed` to follow the switcher. */
  readonly lang = this.fmt.lang;

  t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(`admin.overview.${key}`, params);
  }

  money(cents: number | null | undefined, currency: string | null | undefined): string {
    if (cents === null || cents === undefined) return '—';
    return this.fmt.money(cents, currency, { round: true });
  }

  int(value: number): string {
    return new Intl.NumberFormat(this.fmt.lang()).format(Math.round(value));
  }

  decimal(value: number): string {
    return new Intl.NumberFormat(this.fmt.lang(), { maximumFractionDigits: 1 }).format(value);
  }

  percent(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined) return '—';
    return this.fmt.percent(value, { maxDigits: digits });
  }

  signedPercent(value: number | null): string {
    if (value === null) return '';
    return this.fmt.percent(value, { signed: true });
  }

  /** "+1,5 п.п." */
  signedPoints(value: number): string {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${this.t('points', { value: this.decimal(Math.abs(value)) })}`;
  }

  /** "+3", "−2", "0". */
  signedInt(value: number): string {
    return value > 0 ? `+${this.int(value)}` : value < 0 ? `−${this.int(-value)}` : '0';
  }

  /** "4 мин 30 с". */
  duration(seconds: number | null): string {
    if (seconds === null) return '—';
    const total = Math.round(Math.abs(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    const min = this.translate.instant('common.units.min');
    const sec = this.translate.instant('common.units.sShort');
    if (m === 0) return `${s} ${sec}`;
    return s === 0 ? `${m} ${min}` : `${m} ${min} ${s} ${sec}`;
  }

  /** "4 сент. 2026 — 3 окт. 2026 · сравнение с предыдущими 30 днями". */
  periodLine(period: OverviewPeriod | null | undefined): string {
    if (!period) return '';
    const range = `${this.fmt.date(`${period.from}T00:00:00Z`, 'UTC')} — ${this.fmt.date(`${period.to}T00:00:00Z`, 'UTC')}`;
    return `${range} · ${this.fmt.plural('admin.overview.compareWith', period.days)}`;
  }

  /** "12 сент., пт". */
  dayTitle(date: string): string {
    const at = new Date(`${date}T00:00:00Z`);
    const weekday = new Intl.DateTimeFormat(this.fmt.lang(), { weekday: 'short', timeZone: 'UTC' }).format(at);
    return `${this.fmt.dayMonth(at, 'UTC')}, ${weekday}`;
  }

  /** The KPI delta: the number for the colour and how it reads. */
  delta(current: number | null, previous: number | null): { delta: number | null; text: string; hint: string } {
    if (current === null || previous === null) return { delta: null, text: '', hint: '' };
    const d = deltaPercent(current, previous);
    if (d === null) return { delta: null, text: '', hint: current > 0 ? this.t('newInPeriod') : '' };
    return { delta: d, text: this.signedPercent(d), hint: this.t('vsPrevious') };
  }

  /** The same for a share, in percentage points. */
  pointsDelta(current: number | null, previous: number | null): { delta: number | null; text: string; hint: string } {
    if (current === null || previous === null) return { delta: null, text: '', hint: '' };
    const d = current - previous;
    return { delta: d, text: this.signedPoints(d), hint: this.t('vsPrevious') };
  }

  /**
   * One card per day. The last day of a period that ends today is still
   * running: the badge keeps a dip from reading as a slump.
   */
  dailyTips(
    days: readonly OverviewDay[],
    lines: (d: OverviewDay, i: number) => ChartTip['lines'],
    today: string,
  ): ChartTip[] {
    return days.map((d, i) => ({
      title: this.dayTitle(d.date),
      badge: d.date === today ? this.t('today') : undefined,
      lines: lines(d, i),
    }));
  }

  /** "к среднему дню +12 %" for day `i`; the average is over the period's days. */
  vsAverage(values: readonly number[], label: string): (i: number) => ChartTipLine | null {
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    return (i) => {
      const p = deltaPercent(values[i] ?? 0, avg);
      return avg > 0 && p !== null ? { label, value: this.signedPercent(p) } : null;
    };
  }

  /** The load by hour, trimmed to the café day (7–22) unless orders came outside it. */
  hourItems(hours: readonly OverviewHour[], currency: string | null | undefined): BarItem[] {
    const busy = hours.filter((h) => h.orders > 0).map((h) => h.hour);
    const from = Math.min(DAY_HOURS.from, ...busy);
    const to = Math.max(DAY_HOURS.to, ...busy);
    const shown = hours.filter((h) => h.hour >= from && h.hour <= to);
    const total = shown.reduce((s, h) => s + h.orders, 0);
    const vs = this.vsAverage(
      shown.map((h) => h.orders),
      this.t('tip.vsAverageHour'),
    );
    return shown.map((h, i) => {
      const title = `${pad(h.hour)}:00–${pad((h.hour + 1) % 24)}:00`;
      return {
        label: String(h.hour),
        title,
        value: h.orders,
        valueText: this.int(h.orders),
        tip: {
          title,
          lines: [
            { label: this.t('tip.orders'), value: this.int(h.orders), color: 'var(--chart-orders)', strong: true },
            { label: this.t('tip.revenue'), value: this.money(h.revenueCents, currency) },
            total > 0 && { label: this.t('tip.share'), value: this.percent((h.orders / total) * 100, 0) },
            vs(i),
          ],
        },
      };
    });
  }

  hourRange(hours: readonly OverviewHour[]): { from: number; to: number } {
    const busy = hours.filter((h) => h.orders > 0).map((h) => h.hour);
    return { from: Math.min(DAY_HOURS.from, ...busy), to: Math.max(DAY_HOURS.to, ...busy) + 1 };
  }

  weekdayItems(days: readonly OverviewWeekday[], currency: string | null | undefined): BarItem[] {
    const total = days.reduce((s, d) => s + d.orders, 0);
    const vs = this.vsAverage(
      days.map((d) => d.orders),
      this.t('tip.vsAverageWeekday'),
    );
    const lang = this.fmt.lang();
    // 2024-01-01 was a Monday.
    const name = (weekday: number, style: 'short' | 'long') =>
      new Intl.DateTimeFormat(lang, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, weekday)));
    return days.map((d, i) => {
      const title = capitalize(name(d.weekday, 'long'));
      return {
        label: capitalize(name(d.weekday, 'short')),
        title,
        value: d.orders,
        valueText: this.int(d.orders),
        tip: {
          title,
          lines: [
            { label: this.t('tip.orders'), value: this.int(d.orders), color: 'var(--chart-orders)', strong: true },
            { label: this.t('tip.revenue'), value: this.money(d.revenueCents, currency) },
            total > 0 && { label: this.t('tip.share'), value: this.percent((d.orders / total) * 100, 0) },
            vs(i),
          ],
        },
      };
    });
  }

  statusSlices(statuses: Record<string, number> | null | undefined): DonutSlice[] {
    if (!statuses) return [];
    return STATUS_GROUPS.map((g) => ({
      key: g.key,
      label: this.t(`statuses.${g.key}`),
      value: g.statuses.reduce((sum, s) => sum + (statuses[s] ?? 0), 0),
      color: g.color,
    }));
  }

  shareText(): ShareBarsText {
    return {
      value: this.t('share.value'),
      share: this.t('share.share'),
      change: this.t('share.change'),
      previous: this.t('share.previous'),
      others: (count) => this.t('share.others', { count }),
      collapse: this.t('share.collapse'),
      empty: this.t('share.empty'),
    };
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Today in `timeZone`, `YYYY-MM-DD` — the day a period ending today is still running. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      now,
    );
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
