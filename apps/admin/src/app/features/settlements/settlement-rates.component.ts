import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { CommissionRateEntry, CommissionRateHistory } from '@takeaway/shared-types';

import { apiErrorMessage } from '../../core/http/api-error';
import { SettlementsApi } from '../../core/settlements/settlements.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';
import { todayIn } from './settlement-periods';

/** The highest rate the API accepts, in percent. */
const MAX_PERCENT = 50;

/**
 * The brand's commission rate and its history. The platform admin adds a
 * dated rate (an individual deal, or back to the plan's rate) or removes one;
 * a brand owner only reads. Every order is charged the rate in force when
 * it settled, so a change never rewrites a period that came before it.
 */
@Component({
  selector: 'app-settlement-rates',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <article class="dash-card">
      <header class="dash-card-head">
        <h2>{{ 'admin.settlements.rates.title' | translate }}</h2>
        @if (history(); as h) {
          <span class="sr-now">
            {{ 'admin.settlements.rates.current' | translate: { rate: percent(h.currentBps) } }} ·
            {{
              'admin.settlements.rates.plan'
                | translate: { plan: ('admin.plans.names.' + h.plan | translate), rate: percent(h.planBps) }
            }}
          </span>
        }
      </header>

      @if (error()) {
        <p class="dash-error" role="alert">{{ error() }}</p>
      }

      @if (history(); as h) {
        @if (h.rates.length === 0) {
          <p class="dash-muted">{{ 'admin.settlements.rates.empty' | translate }}</p>
        } @else {
          <ul class="sr-list">
            @for (r of newestFirst(); track r.id) {
              <li class="sr-row">
                <span class="sr-rate">{{ percent(r.bps) }}</span>
                <span class="sr-source" [attr.data-source]="r.source">{{
                  'admin.settlements.rates.sources.' + r.source | translate
                }}</span>
                <span class="sr-dates">
                  {{ 'admin.settlements.rates.since' | translate: { date: since(r) } }}
                  @if (r.effectiveTo) {
                    {{ 'admin.settlements.rates.until' | translate: { date: until(r) } }}
                  } @else {
                    · {{ 'admin.settlements.rates.open' | translate }}
                  }
                </span>
                @if (r.note) {
                  <span class="sr-note">{{ r.note }}</span>
                }
                @if (canEdit()) {
                  <button type="button" class="sr-remove" [disabled]="busy()" (click)="remove(r)">
                    {{ 'admin.settlements.rates.remove' | translate }}
                  </button>
                }
              </li>
            }
          </ul>
        }

        @if (canEdit()) {
          <form class="sr-form" (submit)="$event.preventDefault(); save()">
            <h3>{{ 'admin.settlements.rates.newTitle' | translate }}</h3>
            <label class="sr-check">
              <input type="checkbox" [checked]="planRate()" (change)="planRate.set($any($event.target).checked)" />
              <span>{{ 'admin.settlements.rates.planRate' | translate }} ({{ percent(h.planBps) }})</span>
            </label>
            <div class="sr-fields">
              @if (!planRate()) {
                <label>
                  <span>{{ 'admin.settlements.rates.percent' | translate }}</span>
                  <input
                    type="number"
                    min="0"
                    [max]="maxPercent"
                    step="0.01"
                    inputmode="decimal"
                    [value]="percentDraft()"
                    (input)="percentDraft.set($any($event.target).value)"
                  />
                </label>
              }
              <label>
                <span>{{ 'admin.settlements.rates.effectiveFrom' | translate }}</span>
                <input type="date" [value]="fromDraft()" (input)="fromDraft.set($any($event.target).value)" />
              </label>
              <label class="sr-wide">
                <span>{{ 'admin.settlements.rates.note' | translate }}</span>
                <input
                  type="text"
                  maxlength="500"
                  [value]="noteDraft()"
                  (input)="noteDraft.set($any($event.target).value)"
                />
              </label>
            </div>
            @if (!planRate() && !percentValid()) {
              <p class="dash-error">{{ 'admin.settlements.rates.invalid' | translate }}</p>
            }
            @if (inPast()) {
              <p class="dash-hint">{{ 'admin.settlements.rates.pastWarning' | translate }}</p>
            }
            <button type="submit" class="sr-save" [disabled]="busy() || !canSave()">
              {{ 'admin.settlements.rates.save' | translate }}
            </button>
          </form>
        }
      }
    </article>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      .sr-now {
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .sr-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .sr-row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 10px;
        padding: 10px 0;
        border-bottom: 1px solid var(--color-border-light);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .sr-rate {
        font-weight: 700;
        font-size: 15px;
        color: var(--color-text-primary);
        font-variant-numeric: tabular-nums;
      }
      .sr-source {
        padding: 1px 8px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 600;
        background: var(--color-surface-variant);
      }
      .sr-source[data-source='INDIVIDUAL'] {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
      }
      .sr-note {
        flex-basis: 100%;
        color: var(--color-text-tertiary);
      }
      .sr-remove {
        margin-left: auto;
        border: 0;
        background: none;
        color: var(--color-berry);
        font-size: 12px;
        cursor: pointer;
      }
      .sr-form {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .sr-form h3 {
        margin: 0;
        font-size: 14px;
        color: var(--color-text-primary);
      }
      .sr-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .sr-fields {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .sr-fields label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
        color: var(--color-text-tertiary);
      }
      .sr-fields .sr-wide {
        flex: 1 1 240px;
      }
      .sr-fields input {
        height: 34px;
        padding: 0 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-cream);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .sr-save {
        align-self: flex-start;
        height: 36px;
        padding: 0 16px;
        border: 0;
        border-radius: var(--radius-button);
        background: var(--color-espresso);
        color: white;
        font-weight: 600;
        cursor: pointer;
      }
      .sr-save:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `,
  ],
})
export class SettlementRatesComponent {
  private readonly api = inject(SettlementsApi);
  private readonly fmt = inject(LocaleFormatService);
  private readonly translate = inject(TranslateService);

  /** Null for a brand owner, who gets their own brand. */
  readonly brandId = input<string | null>(null);
  readonly canEdit = input(false);
  /** A new history arrived: the settlement on the page is out of date. */
  readonly changed = output<void>();

  readonly maxPercent = MAX_PERCENT;
  readonly history = signal<CommissionRateHistory | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly planRate = signal(false);
  readonly percentDraft = signal('');
  readonly fromDraft = signal('');
  readonly noteDraft = signal('');

  readonly newestFirst = computed(() => [...(this.history()?.rates ?? [])].reverse());
  readonly today = computed(() => todayIn(this.history()?.timeZone));
  readonly percentValid = computed(() => {
    const value = Number(this.percentDraft());
    return this.percentDraft().trim() !== '' && Number.isFinite(value) && value >= 0 && value <= MAX_PERCENT;
  });
  readonly canSave = computed(() => !!this.fromDraft() && (this.planRate() || this.percentValid()));
  readonly inPast = computed(() => !!this.fromDraft() && this.fromDraft() < this.today());

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      untracked(() => this.load(brandId));
    });
  }

  percent(bps: number): string {
    return this.fmt.percent(bps / 100, { maxDigits: 2 });
  }

  since(rate: CommissionRateEntry): string {
    return this.fmt.date(rate.effectiveFrom, this.history()?.timeZone);
  }

  /** The last day the rate applied: `effectiveTo` is the next rate's first instant. */
  until(rate: CommissionRateEntry): string {
    if (!rate.effectiveTo) return '';
    return this.fmt.date(new Date(Date.parse(rate.effectiveTo) - 1), this.history()?.timeZone);
  }

  save(): void {
    const brandId = this.history()?.brandId;
    if (!brandId || !this.canSave()) return;
    const bps = this.planRate() ? null : Math.round(Number(this.percentDraft()) * 100);
    this.run(
      this.api.setRate({
        brandId,
        bps,
        effectiveFrom: this.fromDraft(),
        note: this.noteDraft().trim() || undefined,
      }),
      () => {
        this.percentDraft.set('');
        this.noteDraft.set('');
        this.planRate.set(false);
      },
    );
  }

  remove(rate: CommissionRateEntry): void {
    const ok = window.confirm(
      this.translate.instant('admin.settlements.rates.removeConfirm', {
        rate: this.percent(rate.bps),
        date: this.since(rate),
      }),
    );
    if (!ok) return;
    this.run(this.api.deleteRate(rate.id));
  }

  private load(brandId: string | null): void {
    if (this.canEdit() && !brandId) {
      this.history.set(null);
      return;
    }
    this.error.set(null);
    this.api.rates(brandId).subscribe({
      next: (history) => {
        this.history.set(history);
        if (!this.fromDraft()) this.fromDraft.set(todayIn(history.timeZone));
      },
      error: (err) => this.error.set(apiErrorMessage(err, this.translate)),
    });
  }

  private run(request: ReturnType<SettlementsApi['rates']>, done?: () => void): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (history) => {
        this.history.set(history);
        this.busy.set(false);
        done?.();
        this.changed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err, this.translate));
      },
    });
  }
}
