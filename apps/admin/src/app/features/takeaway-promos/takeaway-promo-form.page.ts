import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { CreateTakeawayPromoInput, TakeawayPromo, UpdateTakeawayPromoInput } from '@takeaway/shared-types';
import { TAKEAWAY_PROMO_MAX_PERCENT, TAKEAWAY_PROMO_MIN_PERCENT } from '@takeaway/utils';
import type { Observable } from 'rxjs';

import { BRAND_CURRENCIES } from '../../core/business/business.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { navLink } from '../../core/permissions/permissions';
import { TakeawayPromosApi } from '../../core/takeaway-promos/takeaway-promos.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { TAKEAWAY_PROMO_FORM_ERRORS } from './takeaway-promo-errors';

/** Mirrors the API: 2..32 Latin letters, digits, `_` and `-`; stored uppercase. */
export const TAKEAWAY_PROMO_CODE_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;

const LIST = navLink('takeawayPromos');
const DAY_MS = 24 * 60 * 60_000;
/** The live brand sells in RUP (since 2026-09-23), so a new promo starts there. */
const DEFAULT_CURRENCY = 'RUP';

/** The fields a promo keeps once someone used it (docs/takeaway-promos.md §2.7). */
const FROZEN_WHEN_USED = ['code', 'percent', 'startsAt', 'currency', 'isWelcome'] as const;

/**
 * Create or edit a takeAway promo. Before its first order every field may
 * change; after it only the name, the end and the budget (never below what
 * was spent) — the rest is shown read-only, as the API would refuse it with
 * TAKEAWAY_PROMO_USED. The budget is typed in money and sent in cents.
 */
@Component({
  selector: 'app-takeaway-promo-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="[list]"
      backLabel="admin.takeawayPromos.title"
      [title]="editing() ? 'admin.takeawayPromos.editTitle' : 'admin.takeawayPromos.createTitle'"
      [titleParams]="{ code: loaded()?.code ?? '' }"
      [saveLabel]="editing() ? 'admin.takeawayPromos.form.save' : 'admin.takeawayPromos.form.create'"
      [saveDisabled]="form.invalid || (editing() && !loaded())"
      [saving]="saving()"
      [loading]="loadingPromo()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        @if (frozen(); as promo) {
          <p class="tpf-note" data-testid="takeaway-promo-frozen">
            {{ 'admin.takeawayPromos.form.frozen' | translate: { count: promo.redemptionsCount } }}
          </p>
        }

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.takeawayPromos.form.name' | translate }}</span>
            <input
              formControlName="name"
              type="text"
              maxlength="120"
              class="field-input"
              data-testid="takeaway-promo-name"
              [placeholder]="'admin.takeawayPromos.form.namePlaceholder' | translate"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.takeawayPromos.form.code' | translate }}</span>
            <input
              formControlName="code"
              type="text"
              maxlength="32"
              autocapitalize="characters"
              class="field-input field-input-mono"
              style="text-transform: uppercase"
              data-testid="takeaway-promo-code"
            />
            @if (showError('code')) {
              <span class="tpf-error">{{ 'admin.takeawayPromos.form.invalid.code' | translate }}</span>
            } @else {
              <span class="tpf-hint">{{ 'admin.takeawayPromos.form.codeHint' | translate }}</span>
            }
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.takeawayPromos.form.percent' | translate }}</span>
            <input
              formControlName="percent"
              type="number"
              [min]="minPercent"
              [max]="maxPercent"
              step="1"
              class="field-input field-input-mono"
              data-testid="takeaway-promo-percent"
            />
            @if (showError('percent')) {
              <span class="tpf-error">{{ 'admin.takeawayPromos.form.invalid.percent' | translate }}</span>
            } @else {
              <span class="tpf-hint">{{ 'admin.takeawayPromos.form.percentHint' | translate }}</span>
            }
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.takeawayPromos.form.currency' | translate }}</span>
            <select formControlName="currency" class="field-input" data-testid="takeaway-promo-currency">
              @for (c of currencies; track c) {
                <option [value]="c">{{ 'admin.currencies.' + c | translate }}</option>
              }
            </select>
            <span class="tpf-hint">{{ 'admin.takeawayPromos.form.currencyHint' | translate }}</span>
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.takeawayPromos.form.starts' | translate }}</span>
            <input formControlName="startsAt" type="datetime-local" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.takeawayPromos.form.ends' | translate }}</span>
            <input formControlName="endsAt" type="datetime-local" class="field-input" />
            @if (form.hasError('dates')) {
              <span class="tpf-error">{{ 'admin.takeawayPromos.form.invalid.dates' | translate }}</span>
            }
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.takeawayPromos.form.budget' | translate }} · {{ currency() }}</span>
            <input
              formControlName="budget"
              type="number"
              min="0.01"
              step="0.01"
              class="field-input field-input-mono"
              data-testid="takeaway-promo-budget"
            />
            @if (spentHint(); as spent) {
              <span [class]="showError('budget') ? 'tpf-error' : 'tpf-hint'">{{
                'admin.takeawayPromos.form.budgetSpent' | translate: { spent: spent }
              }}</span>
            } @else if (showError('budget')) {
              <span class="tpf-error">{{ 'admin.takeawayPromos.form.invalid.budget' | translate }}</span>
            } @else {
              <span class="tpf-hint">{{ 'admin.takeawayPromos.form.budgetHint' | translate }}</span>
            }
          </label>
        </div>

        <label class="tpf-check">
          <input formControlName="isWelcome" type="checkbox" data-testid="takeaway-promo-welcome" />
          <span>
            <strong>{{ 'admin.takeawayPromos.form.welcome' | translate }}</strong>
            <span class="tpf-hint">{{ 'admin.takeawayPromos.form.welcomeHint' | translate }}</span>
          </span>
        </label>
      </form>
    </app-form-page>
  `,
  styles: [
    `
      .tpf-note {
        margin: 0;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--color-cream);
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .tpf-hint,
      .tpf-error {
        display: block;
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .tpf-error {
        color: var(--color-berry);
      }
      .tpf-check {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-text-primary);
      }
      .tpf-check input {
        margin-top: 3px;
      }
    `,
  ],
})
export class TakeawayPromoFormPage {
  private readonly api = inject(TakeawayPromosApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  /** The `:promoId` route param, bound by `withComponentInputBinding`; absent on «new». */
  readonly promoId = input<string>();

  readonly list = LIST;
  readonly currencies = BRAND_CURRENCIES;
  readonly minPercent = TAKEAWAY_PROMO_MIN_PERCENT;
  readonly maxPercent = TAKEAWAY_PROMO_MAX_PERCENT;

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly loaded = signal<TakeawayPromo | null>(null);
  readonly loadingPromo = signal(false);

  readonly editing = computed(() => Boolean(this.promoId()));
  /** The promo has orders: only name, end and budget stay open. */
  readonly frozen = computed(() => {
    const promo = this.loaded();
    return promo && !promo.editable ? promo : null;
  });
  /** The budget may not go below what was spent; a new promo needs at least one cent. */
  private readonly minBudgetCents = computed(() => Math.max(1, this.loaded()?.spentCents ?? 0));
  readonly spentHint = computed(() => {
    const promo = this.loaded();
    return promo && promo.spentCents > 0 ? this.fmt.money(promo.spentCents, promo.currency) : null;
  });

  readonly form = new FormGroup(
    {
      name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
      code: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(TAKEAWAY_PROMO_CODE_PATTERN)],
      }),
      percent: new FormControl(10, {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.min(TAKEAWAY_PROMO_MIN_PERCENT),
          Validators.max(TAKEAWAY_PROMO_MAX_PERCENT),
          wholeNumber,
        ],
      }),
      startsAt: new FormControl(toLocalInput(new Date()), { nonNullable: true, validators: [Validators.required] }),
      endsAt: new FormControl(toLocalInput(new Date(Date.now() + 30 * DAY_MS)), {
        nonNullable: true,
        validators: [Validators.required],
      }),
      currency: new FormControl<string>(DEFAULT_CURRENCY, { nonNullable: true, validators: [Validators.required] }),
      budget: new FormControl<number | null>(null, {
        validators: [Validators.required, (c) => this.budgetAtLeastMin(c)],
      }),
      isWelcome: new FormControl(false, { nonNullable: true }),
    },
    { validators: [endsAfterStart] },
  );

  readonly currency = toSignal(this.form.controls.currency.valueChanges, {
    initialValue: this.form.controls.currency.value,
  });

  constructor() {
    effect(() => {
      const id = this.promoId();
      if (!id) return;
      untracked(() => this.load(id));
    });
  }

  /** A field's own error, once the person has typed in it. */
  showError(name: 'code' | 'percent' | 'budget'): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.dirty || control.touched);
  }

  submit(): void {
    if (this.form.invalid || this.saving()) return;
    const v = this.form.getRawValue();
    const budgetCents = Math.round(Number(v.budget) * 100);
    const id = this.promoId();
    this.saving.set(true);
    this.error.set(null);

    let request: Observable<TakeawayPromo>;
    if (id && this.frozen()) {
      // Only what may still change: sending the frozen fields would be refused.
      const body: UpdateTakeawayPromoInput = {
        name: v.name.trim(),
        endsAt: new Date(v.endsAt).toISOString(),
        budgetCents,
      };
      request = this.api.update(id, body);
    } else {
      const body: CreateTakeawayPromoInput = {
        name: v.name.trim(),
        code: v.code.trim().toUpperCase(),
        percent: Number(v.percent),
        startsAt: new Date(v.startsAt).toISOString(),
        endsAt: new Date(v.endsAt).toISOString(),
        currency: v.currency,
        budgetCents,
        isWelcome: v.isWelcome,
      };
      request = id ? this.api.update(id, body) : this.api.create(body);
    }
    request.subscribe({
      next: () => {
        this.saving.set(false);
        void this.router.navigate([LIST]);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            ...TAKEAWAY_PROMO_FORM_ERRORS,
            statuses: {
              500: id ? 'admin.takeawayPromos.errors.saveFailed' : 'admin.takeawayPromos.errors.createFailed',
            },
          }),
        );
      },
    });
  }

  private budgetAtLeastMin(control: AbstractControl): ValidationErrors | null {
    if (control.value === null || control.value === '') return null;
    const cents = Math.round(Number(control.value) * 100);
    // `minBudgetCents` is read untracked: the validator runs outside a reactive context.
    return Number.isFinite(cents) && cents >= untracked(this.minBudgetCents) ? null : { budget: true };
  }

  private load(id: string): void {
    this.loadingPromo.set(true);
    this.api.get(id).subscribe({
      next: (promo) => {
        this.loaded.set(promo);
        this.loadingPromo.set(false);
        this.form.patchValue({
          name: promo.name,
          code: promo.code,
          percent: promo.percent,
          startsAt: toLocalInput(new Date(promo.startsAt)),
          endsAt: toLocalInput(new Date(promo.endsAt)),
          currency: promo.currency,
          budget: promo.budgetCents / 100,
          isWelcome: promo.isWelcome,
        });
        if (!promo.editable) {
          for (const name of FROZEN_WHEN_USED) this.form.controls[name].disable();
        }
        this.form.controls.budget.updateValueAndValidity();
      },
      error: (err) => {
        this.loadingPromo.set(false);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 404: 'admin.takeawayPromos.form.loadFailed' },
          }),
        );
      },
    });
  }
}

function wholeNumber(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === null || value === '') return null;
  return Number.isInteger(Number(value)) ? null : { wholeNumber: true };
}

/** The end must come after the start (TAKEAWAY_PROMO_DATES on the API). */
function endsAfterStart(group: AbstractControl): ValidationErrors | null {
  const starts = group.get('startsAt')?.value as string | undefined;
  const ends = group.get('endsAt')?.value as string | undefined;
  if (!starts || !ends) return null;
  return new Date(ends).getTime() > new Date(starts).getTime() ? null : { dates: true };
}

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
