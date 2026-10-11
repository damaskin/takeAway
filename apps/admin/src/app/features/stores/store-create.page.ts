import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
import { STORE_KINDS, STORE_PHOTO_RULE } from '@takeaway/shared-types';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { suggestStoreTimeZone } from '@takeaway/utils';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CreateStoreInput, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { OnboardingFlowService } from '../../core/onboarding/onboarding-flow.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { acceptFor, imageFileError, imageUploadRefusal, ruleParams } from '../../shared/image-rules';
import { AddressLocator } from './address-locator';
import { LocatorStatusComponent } from './locator-status.component';
import { storeErrorMessage } from './store-errors';
import { STORE_CURRENCIES, STORE_SLUG_PATTERN, defaultCountryFor } from './store-options';
import { TimezoneSelectComponent, defaultStoreTimeZone } from './timezone-select.component';

function atLeastOneKind(group: AbstractControl): ValidationErrors | null {
  const values = Object.values((group as FormGroup).getRawValue() as Record<string, boolean>);
  return values.some(Boolean) ? null : { noneChecked: true };
}

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
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    FormPageComponent,
    LeafletMapComponent,
    TimezoneSelectComponent,
    LocatorStatusComponent,
  ],
  providers: [AddressLocator],
  styles: [
    `
      .check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-text-primary);
      }
      .hint {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .error {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-berry);
      }
    `,
  ],
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
              (blur)="locator.flush()"
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
              (blur)="locator.flush()"
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
              (blur)="locator.flush()"
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
              (zoneDerived() ? 'admin.stores.timezone.derived' : 'admin.stores.hints.timezone') | translate
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

        <div
          class="field"
          formGroupName="kinds"
          role="group"
          data-testid="store-kinds"
          [attr.aria-label]="'admin.stores.kinds.title' | translate"
        >
          <span class="field-label">{{ 'admin.stores.kinds.title' | translate }}</span>
          <div class="flex flex-wrap" style="gap: 16px">
            @for (k of kindOptions; track k) {
              <label class="check">
                <input type="checkbox" [formControlName]="k" />
                <span>{{ 'admin.stores.kinds.' + k | translate }}</span>
              </label>
            }
          </div>
          @if (form.controls.kinds.invalid) {
            <span class="error">{{ 'admin.stores.kinds.required' | translate }}</span>
          } @else {
            <span class="hint">{{ 'admin.stores.kinds.hint' | translate }}</span>
          }
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
              [center]="locator.area()"
              [zoom]="13"
              (markerMoved)="onPickerMoved($event)"
            />
          </div>
          <app-locator-status [locator]="locator" [hasPin]="pickerMarkers().length > 0" />
          @if (invalid('latitude') && !pickerMarkers().length) {
            <span class="error">{{ 'admin.stores.hints.clickMap' | translate }}</span>
          }
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.latitude' | translate }}</span>
            <input
              formControlName="latitude"
              type="number"
              step="0.000001"
              class="field-input field-input-mono"
              (change)="locator.pinnedByHand(null)"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.stores.fields.longitude' | translate }}</span>
            <input
              formControlName="longitude"
              type="number"
              step="0.000001"
              class="field-input field-input-mono"
              (change)="locator.pinnedByHand(null)"
            />
          </label>
        </div>

        <div class="field" data-testid="store-create-photo">
          <span class="field-label">{{ 'admin.stores.createForm.photo' | translate }}</span>
          <span class="hint">{{ 'admin.stores.photos.heroHint' | translate }}</span>
          <span class="hint" style="color: var(--color-text-secondary)">{{
            'admin.images.storeRule' | translate: photoRule
          }}</span>
          <div class="flex items-center flex-wrap" style="gap: 12px; margin-top: 4px">
            @if (photoPreview(); as preview) {
              <img
                [src]="preview"
                alt=""
                style="width: 180px; max-width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 10px; border: 1px solid var(--color-border-light)"
              />
            }
            <label
              style="padding: 8px 14px; background: var(--color-latte); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-espresso); cursor: pointer"
            >
              {{ (photo() ? 'admin.stores.createForm.photoChange' : 'admin.stores.createForm.photoPick') | translate }}
              <input type="file" [accept]="photoAccept" (change)="onPhotoPicked($event)" style="display: none" />
            </label>
            @if (photo()) {
              <button
                type="button"
                (click)="clearPhoto()"
                style="padding: 0; background: none; border: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-berry); cursor: pointer"
              >
                {{ 'admin.stores.createForm.photoRemove' | translate }}
              </button>
            } @else {
              <span class="hint">{{ 'admin.stores.createForm.photoLater' | translate }}</span>
            }
          </div>
          @if (photoError(); as message) {
            <span role="alert" class="error">{{ message }}</span>
          }
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
  private readonly onboarding = inject(OnboardingFlowService);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  readonly locator = inject(AddressLocator);

  readonly currencies = STORE_CURRENCIES;
  readonly kindOptions = STORE_KINDS;
  readonly photoAccept = acceptFor(STORE_PHOTO_RULE);
  readonly photoRule = ruleParams(STORE_PHOTO_RULE);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  private readonly submitted = signal(false);

  /** The cover photo picked here; uploaded right after the store is created. */
  readonly photo = signal<File | null>(null);
  readonly photoPreview = signal<string | null>(null);
  readonly photoError = signal<string | null>(null);

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
    kinds: new FormGroup(
      {
        COFFEE: new FormControl(true, { nonNullable: true }),
        FOOD: new FormControl(false, { nonNullable: true }),
      },
      { validators: [atLeastOneKind] },
    ),
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
  /** The zone shown was derived from the address, not picked by hand. */
  readonly zoneDerived = signal(false);

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
      this.deriveZone();
    });

    const c = this.form.controls;
    this.locator.connect(
      { addressLine: c.addressLine, city: c.city, country: c.country },
      { pinned: false, place: (p) => this.form.patchValue({ latitude: round6(p.lat), longitude: round6(p.lng) }) },
    );
    inject(DestroyRef).onDestroy(() => this.revokePreview());
  }

  /**
   * Follows the address and the map pin with the zone they imply (Tiraspol →
   * Europe/Chisinau) until the owner picks a zone by hand — that choice is
   * never overwritten. Nobody types a zone unprompted, and a wrong one moves
   * every working hour.
   */
  private deriveZone(): void {
    const zone = this.form.controls.timezone;
    if (zone.dirty) {
      this.zoneDerived.set(false);
      return;
    }
    const v = this.form.getRawValue();
    const suggested = suggestStoreTimeZone(v);
    if (!suggested) return;
    if (suggested !== zone.value) zone.setValue(suggested, { emitEvent: false });
    this.zoneDerived.set(true);
  }

  onPickerMoved(p: LatLng): void {
    const point = { lat: round6(p.lat), lng: round6(p.lng) };
    this.form.patchValue({ latitude: point.lat, longitude: point.lng });
    this.locator.pinnedByHand(point);
  }

  /** Checked at once, so a wrong file is reported before the store is created, not after. */
  onPhotoPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const problem = imageFileError(file, STORE_PHOTO_RULE, this.translate);
    this.photoError.set(problem);
    if (problem) return;
    this.revokePreview();
    this.photo.set(file);
    this.photoPreview.set(URL.createObjectURL(file));
  }

  clearPhoto(): void {
    this.revokePreview();
    this.photo.set(null);
    this.photoError.set(null);
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
      kinds: STORE_KINDS.filter((k) => v.kinds[k]),
    };
    this.creating.set(true);
    this.createError.set(null);
    this.api.createStore(payload).subscribe({
      next: (store) => this.afterCreate(store),
      error: (err) => {
        this.creating.set(false);
        this.createError.set(storeErrorMessage(err, this.translate));
      },
    });
  }

  /**
   * The photo needs the store's id, so it goes up once the store exists. The
   * store is there either way: if the photo fails, the editor opens on its
   * photos tab with the reason, rather than this form offering to create
   * the store a second time.
   */
  private afterCreate(store: StoreAdminDto): void {
    // From «Запуск бренда» the step still needs opening hours: straight to them.
    const next = this.onboarding.active('store') ? { queryParams: { tab: 'hours' } } : {};
    const photo = this.photo();
    if (!photo) {
      this.router.navigate(['/stores', store.id], next);
      return;
    }
    this.api.uploadStoreImage(store.id, 'hero', photo).subscribe({
      next: () => this.router.navigate(['/stores', store.id], next),
      error: (err) => {
        const reason =
          imageUploadRefusal(err, STORE_PHOTO_RULE, this.translate) ?? storeErrorMessage(err, this.translate);
        this.router.navigate(['/stores', store.id], {
          queryParams: { tab: 'photos' },
          state: { photoError: this.translate.instant('admin.stores.createForm.photoFailed', { reason }) },
        });
      },
    });
  }

  private revokePreview(): void {
    const url = this.photoPreview();
    if (url) URL.revokeObjectURL(url);
    this.photoPreview.set(null);
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
      kinds: { COFFEE: true, FOOD: false },
      latitude: null,
      longitude: null,
      slug: '',
    });
    this.deriveZone();
  }
}

/** Six decimals is ~10 cm — more is map-click noise. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
