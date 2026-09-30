import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { extractMessage } from '../../core/http/extract-message';
import { type SetOwnerRequest, StaffService } from '../../core/staff/staff.service';
import { FormPageComponent } from '../../shared/form-page.component';

/** Set or replace the brand owner (SUPER_ADMIN only), on its own route. */
@Component({
  selector: 'app-staff-owner',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/staff']"
      backLabel="admin.staff.title"
      title="admin.staff.owner.title"
      [subtitle]="hint"
      saveLabel="admin.staff.owner.cta"
      [saveDisabled]="form.invalid"
      [saving]="saving()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.staff.email' | translate }}</span>
            <input formControlName="email" type="email" autocapitalize="none" spellcheck="false" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.staff.name' | translate }}</span>
            <input formControlName="name" type="text" autocomplete="name" class="field-input" />
          </label>
        </div>

        <label class="field">
          <span class="field-label">{{ 'admin.staff.owner.tempPasswordHint' | translate }}</span>
          <input
            formControlName="tempPassword"
            type="text"
            autocomplete="off"
            class="field-input field-input-mono"
            [placeholder]="'admin.staff.owner.tempPasswordPlaceholder' | translate"
          />
        </label>
      </form>
    </app-form-page>
  `,
})
export class StaffOwnerPage {
  private readonly staffApi = inject(StaffService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly brandCtx = inject(ActiveBrandService);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly hint: string = this.translate.instant('admin.staff.owner.subtitle');

  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    name: new FormControl('', { nonNullable: true }),
    tempPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.minLength(8), Validators.maxLength(128)],
    }),
  });

  submit(): void {
    const brandId = this.brandCtx.activeId();
    if (!brandId || this.form.invalid) return;
    this.saving.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const body: SetOwnerRequest = { email: v.email.trim().toLowerCase() };
    if (v.name.trim()) body.name = v.name.trim();
    if (v.tempPassword.trim()) body.tempPassword = v.tempPassword.trim();
    this.staffApi.setOwner(brandId, body).subscribe({
      next: () => this.router.navigate(['/staff']),
      error: (err) => {
        this.saving.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }
}
