import { Component, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';
import { type AddStaffRequest, type StaffRole, StaffService } from '../../core/staff/staff.service';
import { FormPageComponent } from '../../shared/form-page.component';

/**
 * Invite someone to a store's roster, on its own route.
 *
 * The store used to be whichever tab was open on the list; it is a field
 * here, carried in as `?storeId=` so the link opens on the right one.
 */
@Component({
  selector: 'app-staff-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/staff']"
      backLabel="admin.staff.title"
      title="admin.staff.addTitle"
      saveLabel="admin.staff.addCta"
      [saveDisabled]="form.invalid"
      [saving]="saving()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <label class="field">
          <span class="field-label">{{ 'admin.staff.storeLabel' | translate }}</span>
          <select formControlName="storeId" class="field-input">
            @for (s of stores(); track s.id) {
              <option [value]="s.id">{{ s.name }}</option>
            }
          </select>
        </label>

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

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.staff.roleLabel' | translate }}</span>
            <select formControlName="role" class="field-input">
              <option value="STORE_MANAGER">{{ 'admin.staff.role.STORE_MANAGER' | translate }}</option>
              <option value="STAFF">{{ 'admin.staff.role.STAFF' | translate }}</option>
              <option value="MENU_EDITOR">{{ 'admin.staff.role.MENU_EDITOR' | translate }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.staff.tempPassword' | translate }}</span>
            <input formControlName="tempPassword" type="text" autocomplete="off" class="field-input field-input-mono" />
          </label>
        </div>

        <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
          {{ 'admin.staff.tempPasswordHint' | translate }}
        </p>
      </form>
    </app-form-page>
  `,
})
export class StaffFormPage {
  /** The store whose roster the list page was showing. */
  readonly storeId = input<string | undefined>();

  private readonly catalog = inject(AdminCatalogApi);
  private readonly staffApi = inject(StaffService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    storeId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    name: new FormControl('', { nonNullable: true }),
    role: new FormControl<StaffRole>('STAFF', { nonNullable: true }),
    tempPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
    }),
  });

  constructor() {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list);
        if (!this.form.controls.storeId.value) {
          this.form.controls.storeId.setValue(this.storeId() ?? list[0]?.id ?? '');
        }
      },
      error: (err) => this.error.set(extractMessage(err)),
    });

    effect(() => {
      const preset = this.storeId();
      if (preset && !this.form.controls.storeId.dirty) this.form.controls.storeId.setValue(preset);
    });
  }

  submit(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    const body: AddStaffRequest = {
      email: v.email.trim().toLowerCase(),
      role: v.role,
      tempPassword: v.tempPassword,
    };
    if (v.name.trim()) body.name = v.name.trim();
    this.staffApi.add(v.storeId, body).subscribe({
      next: () => this.router.navigate(['/staff'], { queryParams: { store: v.storeId } }),
      error: (err) => {
        this.saving.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }
}
