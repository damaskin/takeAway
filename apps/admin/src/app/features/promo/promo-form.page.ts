import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { extractMessage } from '../../core/http/extract-message';
import type { PromoStatus, PromoType } from '@takeaway/shared-types';

import { AdminPromoApi } from '../../core/promo/promo.service';
import { FormPageComponent } from '../../shared/form-page.component';

/** Create a promo code, on its own route. */
@Component({
  selector: 'app-promo-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/promo']"
      backLabel="admin.promo.title"
      title="admin.promo.createTitle"
      saveLabel="admin.promo.form.create"
      [saveDisabled]="form.invalid"
      [saving]="saving()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.code' | translate }}</span>
            <input
              formControlName="code"
              type="text"
              class="field-input field-input-mono"
              style="text-transform: uppercase"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.label' | translate }}</span>
            <input formControlName="label" type="text" class="field-input" />
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.promo.table.type' | translate }}</span>
            <select formControlName="type" class="field-input">
              <option value="PERCENT">{{ 'admin.promo.form.typePercent' | translate }}</option>
              <option value="FIXED">{{ 'admin.promo.form.typeFixed' | translate }}</option>
              <option value="BOGO">{{ 'admin.promo.form.typeBogo' | translate }}</option>
              <option value="POINTS_MULTIPLIER">{{ 'admin.promo.form.typePoints' | translate }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.value' | translate }}</span>
            <input formControlName="value" type="number" min="0" class="field-input field-input-mono" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.promo.table.status' | translate }}</span>
            <select formControlName="status" class="field-input">
              <option value="DRAFT">{{ 'admin.promo.form.statusDraft' | translate }}</option>
              <option value="SCHEDULED">{{ 'admin.promo.form.statusScheduled' | translate }}</option>
              <option value="RUNNING">{{ 'admin.promo.form.statusRunning' | translate }}</option>
            </select>
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.starts' | translate }}</span>
            <input formControlName="startsAt" type="datetime-local" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.ends' | translate }}</span>
            <input formControlName="endsAt" type="datetime-local" class="field-input" />
          </label>
        </div>
      </form>
    </app-form-page>
  `,
})
export class PromoFormPage {
  private readonly api = inject(AdminPromoApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    label: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    type: new FormControl<PromoType>('PERCENT', { nonNullable: true }),
    value: new FormControl(10, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    startsAt: new FormControl(toLocalInput(new Date()), { nonNullable: true }),
    endsAt: new FormControl(toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60_000)), { nonNullable: true }),
    status: new FormControl<PromoStatus>('SCHEDULED', { nonNullable: true }),
  });

  submit(): void {
    if (this.form.invalid) return;
    const brandId = this.activeBrand.activeId();
    if (!brandId) {
      this.error.set(this.translate.instant('admin.brandContext.noBrandsHint'));
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    this.api
      .create({
        brandId,
        code: v.code.toUpperCase(),
        label: v.label,
        type: v.type,
        value: Number(v.value),
        startsAt: new Date(v.startsAt).toISOString(),
        endsAt: new Date(v.endsAt).toISOString(),
        status: v.status,
      })
      .subscribe({
        next: () => this.router.navigate(['/promo']),
        error: (err) => {
          this.saving.set(false);
          this.error.set(extractMessage(err) ?? this.translate.instant('admin.promo.errors.createFailed'));
        },
      });
  }
}

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
