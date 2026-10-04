import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { type InviteStaffRequest, type StaffRole, StaffService } from '../../core/staff/staff.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { staffErrorMessage } from './staff-errors';
import { StaffStorePickerComponent } from './staff-store-picker.component';

/**
 * Invite someone to the team, on its own route. The person can work at
 * several stores from the start; `?storeId=` ticks the store the list was
 * filtered by.
 */
@Component({
  selector: 'app-staff-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent, StaffStorePickerComponent],
  template: `
    <app-form-page
      [backTo]="['/staff']"
      backLabel="admin.staff.title"
      title="admin.staff.addTitle"
      saveLabel="admin.staff.addCta"
      [saveDisabled]="form.invalid || storeIds().length === 0"
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

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.staff.roleLabel' | translate }}</span>
            <select formControlName="role" class="field-input">
              @for (r of roleOptions(); track r) {
                <option [value]="r">{{ 'admin.staff.role.' + r | translate }}</option>
              }
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

        <app-staff-store-picker [stores]="stores()" [(selected)]="storeIds" />
      </form>
    </app-form-page>
  `,
})
export class StaffFormPage {
  /** The store the list page was filtered by. */
  readonly storeId = input<string | undefined>();

  private readonly catalog = inject(AdminCatalogApi);
  private readonly staffApi = inject(StaffService);
  private readonly brandCtx = inject(ActiveBrandService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly storeIds = signal<string[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** A store manager hires kitchen staff and menu editors, not other managers. */
  readonly roleOptions = computed<StaffRole[]>(() =>
    this.authStore.user()?.role === 'STORE_MANAGER'
      ? ['STAFF', 'MENU_EDITOR']
      : ['STORE_MANAGER', 'STAFF', 'MENU_EDITOR'],
  );

  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    name: new FormControl('', { nonNullable: true }),
    role: new FormControl<StaffRole>('STAFF', { nonNullable: true }),
    tempPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
    }),
  });

  constructor() {
    effect(() => {
      const brandId = this.brandCtx.activeId();
      untracked(() =>
        this.catalog.listStores(brandId ?? undefined).subscribe({
          next: (list) => {
            this.stores.set(list);
            const preset = this.storeId();
            // The filtered store, or the only one there is.
            const only = list.length === 1 ? list.map((s) => s.id) : [];
            const wanted = preset && list.some((s) => s.id === preset) ? [preset] : only;
            this.storeIds.update((ids) => {
              const kept = ids.filter((id) => list.some((s) => s.id === id));
              return kept.length > 0 ? kept : wanted;
            });
          },
          error: (err) => this.error.set(staffErrorMessage(err, this.translate)),
        }),
      );
    });
  }

  submit(): void {
    const storeIds = this.storeIds();
    if (this.form.invalid || storeIds.length === 0) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    const body: InviteStaffRequest = {
      email: v.email.trim().toLowerCase(),
      role: v.role,
      tempPassword: v.tempPassword,
      storeIds,
    };
    if (v.name.trim()) body.name = v.name.trim();
    this.staffApi.invite(body, this.brandCtx.activeId()).subscribe({
      next: () => void this.router.navigate(['/staff']),
      error: (err) => {
        this.saving.set(false);
        this.error.set(staffErrorMessage(err, this.translate));
      },
    });
  }
}
