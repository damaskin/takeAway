import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import {
  AdminCatalogApi,
  type CreateStoreInput,
  type StoreAdminDto,
  type UpdateStoreInput,
} from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';
import { FormPageComponent } from '../../shared/form-page.component';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'THB', 'IDR', 'MDL', 'RUP'] as const;

/**
 * Create or edit a store, on its own route.
 *
 * One component for both because the fields are the same ones; what differs
 * is that `slug` and `currency` are fixed once the store exists (changing a
 * slug breaks every link a customer has) and that `status` only means
 * something for a store that is already open for orders.
 */
@Component({
  selector: 'app-store-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, LeafletMapComponent, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/stores']"
      backLabel="admin.stores.title"
      [title]="isEdit() ? 'admin.stores.editTitle' : 'admin.stores.createTitle'"
      [subtitle]="loaded()?.name ?? null"
      [saveLabel]="isEdit() ? 'common.save' : 'admin.stores.create'"
      [saveDisabled]="form.invalid"
      [saving]="saving()"
      [loading]="loading()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.name' | translate }}</span>
            <input formControlName="name" type="text" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.slug' | translate }}</span>
            <input
              formControlName="slug"
              type="text"
              class="field-input field-input-mono"
              [readonly]="isEdit()"
              [attr.aria-describedby]="isEdit() ? 'slug-locked' : null"
            />
            @if (isEdit()) {
              <span id="slug-locked" class="field-label">{{ 'admin.stores.slugLocked' | translate }}</span>
            }
          </label>
        </div>

        <label class="field">
          <span class="field-label">{{ 'admin.stores.fields.addressLine' | translate }}</span>
          <input formControlName="addressLine" type="text" class="field-input" />
        </label>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.city' | translate }}</span>
            <input formControlName="city" type="text" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.country' | translate }}</span>
            <input
              formControlName="country"
              type="text"
              maxlength="2"
              placeholder="MD"
              class="field-input field-input-mono"
              style="text-transform: uppercase"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.currency' | translate }}</span>
            <select formControlName="currency" class="field-input" [attr.disabled]="isEdit() ? '' : null">
              @for (c of currencies; track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select>
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.phone' | translate }}</span>
            <input formControlName="phone" type="tel" placeholder="+37360123456" class="field-input field-input-mono" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.email' | translate }}</span>
            <input
              formControlName="email"
              type="email"
              autocapitalize="none"
              spellcheck="false"
              class="field-input field-input-mono"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.timezone' | translate }}</span>
            <input formControlName="timezone" type="text" placeholder="Europe/Chisinau" class="field-input" />
          </label>
        </div>

        @if (isEdit()) {
          <div class="form-row">
            <label class="field">
              <span class="field-label">{{ 'admin.stores.editor.status' | translate }}</span>
              <select formControlName="status" class="field-input">
                <option value="OPEN">{{ 'admin.stores.status.OPEN' | translate }}</option>
                <option value="OVERLOADED">{{ 'admin.stores.status.OVERLOADED' | translate }}</option>
                <option value="CLOSED">{{ 'admin.stores.status.CLOSED' | translate }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">{{ 'admin.stores.editor.minOrder' | translate }}</span>
              <input formControlName="minOrderCents" type="number" min="0" class="field-input field-input-mono" />
            </label>
          </div>
        }

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.latitude' | translate }}</span>
            <input formControlName="latitude" type="number" step="0.000001" class="field-input field-input-mono" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.longitude' | translate }}</span>
            <input formControlName="longitude" type="number" step="0.000001" class="field-input field-input-mono" />
          </label>
        </div>

        <div class="field">
          <span class="field-label">{{ 'admin.stores.fields.pickOnMap' | translate }}</span>
          <div style="height: 280px; border-radius: 12px; overflow: hidden; border: 1px solid var(--color-border)">
            <lib-leaflet-map [pickable]="true" [markers]="pickerMarkers()" (markerMoved)="onPickerMoved($event)" />
          </div>
        </div>
      </form>

      @if (isEdit()) {
        <a
          formPageExtraActions
          [routerLink]="['/stores', storeId(), 'hours']"
          style="height: 40px; padding: 0 18px; display: inline-flex; align-items: center; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; text-decoration: none"
        >
          {{ 'admin.stores.hours' | translate }}
        </a>
      }
    </app-form-page>
  `,
})
export class StoreFormPage {
  readonly storeId = input<string | undefined>();

  private readonly api = inject(AdminCatalogApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly currencies = CURRENCIES;
  readonly isEdit = computed(() => !!this.storeId());
  readonly loaded = signal<StoreAdminDto | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly pickerMarkers = signal<MapMarker[]>([]);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    slug: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    addressLine: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    country: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(2)],
    }),
    currency: new FormControl<string>('MDL', { nonNullable: true, validators: [Validators.required] }),
    latitude: new FormControl<number | null>(null, { validators: [Validators.required] }),
    longitude: new FormControl<number | null>(null, { validators: [Validators.required] }),
    timezone: new FormControl('UTC', { nonNullable: true }),
    phone: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    status: new FormControl<'OPEN' | 'CLOSED' | 'OVERLOADED'>('OPEN', { nonNullable: true }),
    minOrderCents: new FormControl(0, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const id = this.storeId();
      if (!id) return;
      this.loading.set(true);
      this.api.getStore(id).subscribe({
        next: (store) => {
          this.loaded.set(store);
          this.form.patchValue({
            name: store.name,
            slug: store.slug,
            addressLine: store.addressLine ?? '',
            city: store.city,
            country: store.country,
            currency: store.currency,
            latitude: store.latitude,
            longitude: store.longitude,
            timezone: store.timezone ?? 'UTC',
            phone: store.phone ?? '',
            email: store.email ?? '',
            status: store.status,
            minOrderCents: store.minOrderCents ?? 0,
          });
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
        },
      });
    });

    // A store inherits the currency of the brand it is created under.
    effect(() => {
      const brand = this.activeBrand.active();
      if (brand && !this.isEdit()) this.form.patchValue({ currency: brand.currency }, { emitEvent: false });
    });

    this.form.valueChanges.subscribe((v) => {
      if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
        this.pickerMarkers.set([{ id: this.storeId() ?? 'new', lat: v.latitude, lng: v.longitude, kind: 'store' }]);
      }
    });
  }

  onPickerMoved(p: LatLng): void {
    this.form.patchValue({ latitude: p.lat, longitude: p.lng });
  }

  submit(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    if (v.latitude == null || v.longitude == null) return;

    this.saving.set(true);
    this.error.set(null);

    const id = this.storeId();
    if (id) {
      const payload: UpdateStoreInput = {
        name: v.name.trim(),
        addressLine: v.addressLine.trim(),
        city: v.city.trim(),
        country: v.country.trim().toUpperCase(),
        phone: v.phone.trim() || null,
        email: v.email.trim() || null,
        status: v.status,
        minOrderCents: Number(v.minOrderCents) || 0,
        latitude: Number(v.latitude),
        longitude: Number(v.longitude),
      };
      this.api.updateStore(id, payload).subscribe({
        next: () => this.router.navigate(['/stores']),
        error: (err) => this.fail(err),
      });
      return;
    }

    const brand = this.activeBrand.active();
    if (!brand) {
      this.saving.set(false);
      this.error.set(this.translate.instant('admin.brandContext.noBrandsHint'));
      return;
    }
    const payload: CreateStoreInput = {
      brandId: brand.id,
      slug: v.slug.trim(),
      name: v.name.trim(),
      addressLine: v.addressLine.trim(),
      city: v.city.trim(),
      country: v.country.trim().toUpperCase(),
      currency: v.currency,
      latitude: Number(v.latitude),
      longitude: Number(v.longitude),
      timezone: v.timezone || undefined,
      phone: v.phone || undefined,
      email: v.email || undefined,
    };
    this.api.createStore(payload).subscribe({
      next: () => this.router.navigate(['/stores']),
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.saving.set(false);
    this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
  }
}
