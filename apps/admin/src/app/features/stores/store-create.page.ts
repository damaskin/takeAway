import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CreateStoreInput } from '../../core/catalog/admin-catalog.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { storeErrorMessage } from './store-errors';
import { STORE_CURRENCIES, STORE_SLUG_PATTERN, defaultCountryFor } from './store-options';
import { TimezoneSelectComponent, defaultStoreTimeZone } from './timezone-select.component';

/**
 * Create a store, on its own route.
 *
 * The form used to open above the list, which meant a map picker and a
 * dozen fields squeezed into whatever the list left over. It has the page
 * now, and an address that can be linked and reloaded.
 */
@Component({
  selector: 'app-store-create',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent, LeafletMapComponent, TimezoneSelectComponent],
  template: `
    <app-form-page
      [backTo]="['/stores']"
      backLabel="admin.stores.title"
      title="admin.stores.add"
      saveLabel="admin.stores.create"
      [saving]="creating()"
      [error]="createError()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        <p style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
          {{ 'admin.stores.createForm.note' | translate }}
        </p>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.name' | translate }}</span>
            <input
              formControlName="name"
              class="field-input"
              [placeholder]="'admin.stores.placeholders.name' | translate"
              [style.border-color]="invalid('name') ? 'var(--color-berry)' : null"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.addressLine' | translate }}</span>
            <input
              formControlName="addressLine"
              class="field-input"
              [placeholder]="'admin.stores.placeholders.address' | translate"
              [style.border-color]="invalid('addressLine') ? 'var(--color-berry)' : null"
            />
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.city' | translate }}</span>
            <input
              formControlName="city"
              class="field-input"
              [placeholder]="'admin.stores.placeholders.city' | translate"
              [style.border-color]="invalid('city') ? 'var(--color-berry)' : null"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.country' | translate }}</span>
            <input
              formControlName="country"
              maxlength="2"
              class="field-input"
              style="text-transform: uppercase"
              [placeholder]="'admin.stores.placeholders.country' | translate"
              [style.border-color]="invalid('country') ? 'var(--color-berry)' : null"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.currency' | translate }}</span>
            <select formControlName="currency" class="field-input">
              @for (c of currencies; track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select>
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
              'admin.stores.hints.currency' | translate
            }}</span>
          </label>
        </div>

        <div class="form-row">
          <div class="field">
            <span class="field-label">{{ 'admin.stores.fields.timezone' | translate }}</span>
            <app-timezone-select formControlName="timezone" />
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
              'admin.stores.hints.timezone' | translate
            }}</span>
          </div>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.phone' | translate }}</span>
            <input
              formControlName="phone"
              type="tel"
              class="field-input"
              [placeholder]="'admin.stores.placeholders.phone' | translate"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.email' | translate }}</span>
            <input
              formControlName="email"
              type="email"
              autocapitalize="none"
              class="field-input"
              [style.border-color]="invalid('email') ? 'var(--color-berry)' : null"
            />
          </label>
        </div>

        <div class="field">
          <span class="field-label">{{ 'admin.stores.fields.location' | translate }}</span>
          <div
            [style.border-color]="invalid('latitude') ? 'var(--color-berry)' : null"
            style="height: 240px; border-radius: 10px; overflow: hidden; border: 1px solid var(--color-border)"
          >
            <lib-leaflet-map
              [pickable]="true"
              [markers]="pickerMarkers()"
              [zoom]="13"
              (markerMoved)="onPickerMoved($event)"
            />
          </div>
          <span
            [style.color]="invalid('latitude') ? 'var(--color-berry)' : 'var(--color-text-tertiary)'"
            style="font-family: var(--font-sans); font-size: 12px"
            >{{
              (pickerMarkers().length ? 'admin.stores.fields.pickOnMap' : 'admin.stores.hints.clickMap') | translate
            }}</span
          >
        </div>

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

        <details>
          <summary
            style="cursor: pointer; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            {{ 'admin.stores.advanced' | translate }}
          </summary>
          <label class="field" style="margin-top: 10px">
            <span class="field-label">{{ 'admin.stores.fields.slug' | translate }}</span>
            <input
              formControlName="slug"
              autocapitalize="none"
              class="field-input field-input-mono"
              [style.border-color]="invalid('slug') ? 'var(--color-berry)' : null"
            />
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
              (invalid('slug') ? 'admin.stores.errors.slugFormat' : 'admin.stores.hints.slugAuto') | translate
            }}</span>
          </label>
        </details>
      </form>
    </app-form-page>
  `,
})
export class StoreCreatePage {
  private readonly api = inject(AdminCatalogApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly currencies = STORE_CURRENCIES;
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  private readonly submitted = signal(false);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    addressLine: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    country: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)],
    }),
    currency: new FormControl('MDL', { nonNullable: true, validators: [Validators.required] }),
    timezone: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    phone: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.email] }),
    latitude: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(-90), Validators.max(90)],
    }),
    longitude: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(-180), Validators.max(180)],
    }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.minLength(2), Validators.maxLength(80), Validators.pattern(STORE_SLUG_PATTERN)],
    }),
  });

  /** Marker for the map picker — mirrors the lat/lng controls. */
  readonly pickerMarkers = signal<MapMarker[]>([]);

  /** The brand's own currency, once it is known, is the better default. */
  private readonly brandCurrency = computed(() => this.activeBrand.active()?.currency ?? 'MDL');

  constructor() {
    this.reset();

    // Keep the picker marker in sync when lat/lng are typed manually.
    this.form.valueChanges.subscribe(({ latitude, longitude }) => {
      this.pickerMarkers.set(
        typeof latitude === 'number' && typeof longitude === 'number'
          ? [{ id: 'new', lat: latitude, lng: longitude, kind: 'store' }]
          : [],
      );
    });
  }

  onPickerMoved(p: LatLng): void {
    this.form.patchValue({ latitude: round6(p.lat), longitude: round6(p.lng) });
  }

  /** An invalid field is marked once touched or after a submit attempt. */
  invalid(name: keyof StoreCreatePage['form']['controls']): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || this.submitted());
  }

  submit(): void {
    const brand = this.activeBrand.active();
    if (!brand) {
      this.createError.set(
        this.activeBrand.loadError()
          ? `${this.translate.instant('admin.brandContext.loadFailed')} ${this.activeBrand.loadError()}`
          : this.translate.instant('admin.brandContext.noBrandsHint'),
      );
      return;
    }
    this.submitted.set(true);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const onlyMap = Object.entries(this.form.controls)
        .filter(([, control]) => control.invalid)
        .every(([name]) => name === 'latitude' || name === 'longitude');
      this.createError.set(
        this.translate.instant(onlyMap ? 'admin.stores.hints.clickMap' : 'admin.stores.createForm.invalid'),
      );
      return;
    }
    const v = this.form.getRawValue();
    if (v.latitude == null || v.longitude == null) return;
    const payload: CreateStoreInput = {
      brandId: brand.id,
      name: v.name.trim(),
      addressLine: v.addressLine.trim(),
      city: v.city.trim(),
      country: v.country.trim().toUpperCase(),
      currency: v.currency,
      timezone: v.timezone,
      latitude: v.latitude,
      longitude: v.longitude,
      phone: v.phone.trim() || undefined,
      email: v.email.trim() || undefined,
      slug: v.slug.trim() || undefined,
    };
    this.creating.set(true);
    this.createError.set(null);
    this.api.createStore(payload).subscribe({
      next: (store) => this.router.navigate(['/stores', store.id]),
      error: (err) => {
        this.creating.set(false);
        this.createError.set(storeErrorMessage(err, this.translate));
      },
    });
  }

  private reset(): void {
    const currency = this.brandCurrency();
    this.form.reset({
      name: '',
      addressLine: '',
      city: '',
      country: defaultCountryFor(currency),
      currency: STORE_CURRENCIES.includes(currency as (typeof STORE_CURRENCIES)[number]) ? currency : 'MDL',
      timezone: defaultStoreTimeZone(),
      phone: '',
      email: '',
      latitude: null,
      longitude: null,
      slug: '',
    });
  }
}

/** Six decimals is ~10 cm — more is map-click noise. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
