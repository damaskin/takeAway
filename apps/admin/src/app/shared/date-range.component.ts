import { Component, computed, input, linkedSignal, model } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Ready-made periods, in days ending today. */
export const RANGE_PRESETS = [7, 14, 30, 90] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/**
 * The period a page shows: a preset ("the last 30 days", counted by the API
 * in the brand's time zone) or two calendar days picked by hand, both
 * included. Matches the API's `days` / `from`+`to`.
 */
export type DateRangeValue = { days: RangePreset } | { from: string; to: string };

/** How a page says the range in words: "30 дней" or "1 – 15 сент.". */
export function isCustomRange(value: DateRangeValue): value is { from: string; to: string } {
  return 'from' in value;
}

/** Longest custom range the API accepts. */
const MAX_DAYS = 366;

/**
 * Period picker: preset pills and a "Period" pill that opens two date
 * fields. Used by the dashboard and the analytics page. Wraps on a phone.
 */
@Component({
  selector: 'app-date-range',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="range" role="group" [attr.aria-label]="'admin.dateRange.label' | translate">
      <div class="range-pills">
        @for (d of presets(); track d) {
          <button
            type="button"
            class="range-pill"
            [class.range-pill-on]="activePreset() === d"
            [attr.aria-pressed]="activePreset() === d"
            (click)="pick(d)"
          >
            {{ 'admin.dateRange.days' | translate: { days: d } }}
          </button>
        }
        <button
          type="button"
          class="range-pill"
          [class.range-pill-on]="editing()"
          [attr.aria-pressed]="editing()"
          [attr.aria-expanded]="editing()"
          (click)="openCustom()"
        >
          {{ customLabel() || ('admin.dateRange.custom' | translate) }}
        </button>
      </div>
      @if (editing()) {
        <form class="range-custom" (submit)="$event.preventDefault(); apply()">
          <label class="range-field">
            <span>{{ 'admin.dateRange.from' | translate }}</span>
            <input type="date" [value]="draftFrom()" [max]="today()" (input)="draftFrom.set(read($event))" />
          </label>
          <label class="range-field">
            <span>{{ 'admin.dateRange.to' | translate }}</span>
            <input type="date" [value]="draftTo()" [min]="draftFrom()" (input)="draftTo.set(read($event))" />
          </label>
          <button type="submit" class="range-apply" [disabled]="!draftValid()">
            {{ 'admin.dateRange.apply' | translate }}
          </button>
          @if (draftError(); as error) {
            <span class="range-error">{{ error | translate: { max: maxDays } }}</span>
          }
        </form>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .range {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }
      .range-pills {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }
      .range-pill {
        height: 32px;
        padding: 0 12px;
        border-radius: 9999px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .range-pill-on {
        background: var(--color-caramel);
        border-color: transparent;
        color: white;
      }
      .range-custom {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: flex-end;
        gap: 8px;
      }
      .range-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: var(--font-sans);
        font-size: 11px;
        color: var(--color-text-tertiary);
      }
      .range-field input {
        height: 34px;
        padding: 0 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-cream);
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .range-apply {
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius-button);
        background: var(--color-espresso);
        color: white;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .range-apply:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .range-error {
        flex-basis: 100%;
        text-align: right;
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-berry);
      }
      @media (max-width: 640px) {
        .range,
        .range-pills,
        .range-custom {
          align-items: stretch;
          justify-content: flex-start;
        }
        .range-error {
          text-align: left;
        }
      }
    `,
  ],
})
export class DateRangeComponent {
  readonly value = model.required<DateRangeValue>();
  readonly presets = input<readonly RangePreset[]>(RANGE_PRESETS);

  readonly maxDays = MAX_DAYS;
  readonly activePreset = computed(() => {
    const v = this.value();
    return isCustomRange(v) ? null : v.days;
  });
  readonly customLabel = computed(() => {
    const v = this.value();
    return isCustomRange(v) ? `${shortDate(v.from)} – ${shortDate(v.to)}` : '';
  });

  /** The two fields are open: a custom range is on, or about to be picked. */
  private readonly opened = linkedSignal(() => isCustomRange(this.value()));
  readonly editing = this.opened.asReadonly();

  readonly today = computed(() => localToday());
  readonly draftFrom = linkedSignal(() => {
    const v = this.value();
    return isCustomRange(v) ? v.from : addDays(localToday(), -(v.days - 1));
  });
  readonly draftTo = linkedSignal(() => {
    const v = this.value();
    return isCustomRange(v) ? v.to : localToday();
  });
  readonly draftError = computed<string | null>(() => {
    const from = this.draftFrom();
    const to = this.draftTo();
    if (!from || !to) return null;
    if (from > to) return 'admin.dateRange.reversed';
    if (daysBetween(from, to) + 1 > MAX_DAYS) return 'admin.dateRange.tooLong';
    return null;
  });
  readonly draftValid = computed(() => !!this.draftFrom() && !!this.draftTo() && !this.draftError());

  pick(days: RangePreset): void {
    this.opened.set(false);
    this.value.set({ days });
  }

  openCustom(): void {
    this.opened.set(true);
  }

  apply(): void {
    if (!this.draftValid()) return;
    this.value.set({ from: this.draftFrom(), to: this.draftTo() });
  }

  read(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}

/** Today on the viewer's calendar, `YYYY-MM-DD`. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `2026-09-01` → `01.09`; the year only when it is not this one. */
function shortDate(day: string): string {
  const [y, m, d] = day.split('-');
  const thisYear = String(new Date().getFullYear());
  return y === thisYear ? `${d}.${m}` : `${d}.${m}.${y?.slice(2)}`;
}
