import { Component, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';
import { AdminRidersApi } from '../../core/riders/admin-riders.service';
import { FormPageComponent } from '../../shared/form-page.component';

/**
 * Add a rider to a store's roster, on its own route.
 *
 * The store came from the list page's dropdown before; here it is a field
 * of the form, carried in as `?storeId=` so the link from the list opens
 * on the store the user was looking at.
 */
@Component({
  selector: 'app-rider-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/riders']"
      backLabel="admin.riders.title"
      title="admin.riders.addTitle"
      saveLabel="admin.riders.addCta"
      [saveDisabled]="form.invalid"
      [saving]="saving()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <label class="field">
          <span class="field-label">{{ 'admin.riders.pickStore' | translate }}</span>
          <select formControlName="storeId" class="field-input">
            @for (s of stores(); track s.id) {
              <option [value]="s.id">{{ s.name }} · {{ s.city }}</option>
            }
          </select>
        </label>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.riders.columnPhone' | translate }}</span>
            <input
              formControlName="phone"
              type="tel"
              autocomplete="off"
              class="field-input field-input-mono"
              [placeholder]="'admin.riders.phonePlaceholder' | translate"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.riders.columnName' | translate }}</span>
            <input
              formControlName="name"
              type="text"
              autocomplete="off"
              class="field-input"
              [placeholder]="'admin.riders.namePlaceholder' | translate"
            />
          </label>
        </div>
      </form>
    </app-form-page>
  `,
})
export class RiderFormPage {
  /** The store the list page was showing, so the link lands on it. */
  readonly storeId = input<string | undefined>();

  private readonly catalog = inject(AdminCatalogApi);
  private readonly api = inject(AdminRidersApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    storeId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    name: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list);
        if (!this.form.controls.storeId.value) {
          this.form.controls.storeId.setValue(this.storeId() ?? list[0]?.id ?? '');
        }
      },
      error: () => this.error.set(this.translate.instant('admin.riders.loadFailed')),
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
    this.api.add(v.storeId, { phone: v.phone.trim(), name: v.name.trim() || undefined }).subscribe({
      next: () => this.router.navigate(['/riders'], { queryParams: { store: v.storeId } }),
      error: (err) => {
        this.saving.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('admin.riders.addFailed'));
      },
    });
  }
}
