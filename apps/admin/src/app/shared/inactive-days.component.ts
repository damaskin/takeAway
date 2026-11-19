import { Component, computed, forwardRef, input, model, signal } from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import {
  DEFAULT_INACTIVE_DAYS,
  INACTIVE_DAY_PRESETS,
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
  isInactiveDays,
  parseInactiveDays,
} from '../core/customers/inactive-segment';

/**
 * «Не заказывали: 7 / 14 / 30 / 90 дн. / Свой…» — the inactivity threshold,
 * one picker for the whole admin (owner, 2026-11-18): the dashboard card,
 * «Возврат клиентов», «Клиенты → Неактивные», the campaign audience and the
 * promo form. «Свой…» opens a field for any whole number of days from 1 to
 * 365; a custom choice then reads as its own pill («45 дн.»).
 *
 * `[(days)]` on a page, `formControlName` in a reactive form. It holds no
 * state of its own beyond the field being open.
 */
@Component({
  selector: 'app-inactive-days',
  standalone: true,
  imports: [TranslatePipe],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => InactiveDaysComponent), multi: true }],
  template: `
    <div class="idays" role="group" [attr.aria-label]="'admin.inactiveDays.label' | translate">
      @if (showLabel()) {
        <span class="idays-label">{{ 'admin.inactiveDays.label' | translate }}</span>
      }
      @for (d of presets; track d) {
        <button
          type="button"
          class="idays-pill"
          [class.idays-on]="!editing() && days() === d"
          [attr.aria-pressed]="!editing() && days() === d"
          [disabled]="off()"
          (click)="pick(d)"
        >
          {{ 'admin.churn.window' | translate: { days: d } }}
        </button>
      }
      <button
        type="button"
        class="idays-pill"
        data-testid="inactive-days-custom"
        [class.idays-on]="editing() || custom()"
        [attr.aria-pressed]="custom()"
        [attr.aria-expanded]="editing()"
        [disabled]="off()"
        (click)="toggleCustom()"
      >
        {{
          custom() && !editing()
            ? ('admin.churn.window' | translate: { days: days() })
            : ('admin.inactiveDays.custom' | translate)
        }}
      </button>
      @if (editing()) {
        <span class="idays-custom">
          <input
            type="number"
            inputmode="numeric"
            class="idays-input"
            step="1"
            [min]="min"
            [max]="max"
            [value]="draft()"
            [attr.aria-label]="'admin.inactiveDays.input' | translate: { min: min, max: max }"
            (input)="draft.set(read($event))"
            (keydown.enter)="$event.preventDefault(); apply()"
          />
          <button type="button" class="idays-apply" [disabled]="!draftValid()" (click)="apply()">
            {{ 'admin.inactiveDays.apply' | translate }}
          </button>
        </span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .idays {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-family: var(--font-sans);
      }
      .idays-label {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .idays-pill {
        height: 28px;
        padding: 0 10px;
        border-radius: 9999px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        color: var(--color-text-secondary);
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }
      /* Espresso, not the period picker's caramel: a threshold, not a period. */
      .idays-on {
        background: var(--color-espresso);
        border-color: transparent;
        color: white;
      }
      .idays-pill:disabled,
      .idays-apply:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .idays-custom {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .idays-input {
        width: 72px;
        height: 28px;
        padding: 0 8px;
        border-radius: 8px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        font-family: inherit;
        font-size: 13px;
      }
      .idays-apply {
        height: 28px;
        padding: 0 12px;
        border-radius: 9999px;
        border: 0;
        background: var(--color-caramel);
        color: white;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ],
})
export class InactiveDaysComponent implements ControlValueAccessor {
  /** Days without an order. */
  readonly days = model<number>(DEFAULT_INACTIVE_DAYS);
  readonly disabled = input(false);
  /** «Не заказывали» in front of the pills; off where a field label already says it. */
  readonly showLabel = input(true);

  readonly presets = INACTIVE_DAY_PRESETS;
  readonly min = MIN_INACTIVE_DAYS;
  readonly max = MAX_INACTIVE_DAYS;

  readonly editing = signal(false);
  readonly draft = signal('');
  readonly custom = computed(() => !(INACTIVE_DAY_PRESETS as readonly number[]).includes(this.days()));
  readonly draftValid = computed(() => isInactiveDays(Number(this.draft())));

  private readonly formDisabled = signal(false);
  readonly off = computed(() => this.disabled() || this.formDisabled());

  private onChange: (days: number) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  pick(days: number): void {
    this.editing.set(false);
    this.choose(days);
  }

  toggleCustom(): void {
    if (this.editing()) {
      this.editing.set(false);
      return;
    }
    this.draft.set(String(this.days()));
    this.editing.set(true);
  }

  apply(): void {
    const days = Number(this.draft());
    if (!isInactiveDays(days)) return;
    this.editing.set(false);
    this.choose(days);
  }

  read(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  writeValue(value: unknown): void {
    this.days.set(parseInactiveDays(value) ?? DEFAULT_INACTIVE_DAYS);
  }

  registerOnChange(fn: (days: number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.formDisabled.set(disabled);
  }

  private choose(days: number): void {
    this.onTouched();
    if (days === this.days()) return;
    this.days.set(days);
    this.onChange(days);
  }
}
