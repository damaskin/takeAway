import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { firstValueFrom, merge } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import {
  AdminCatalogApi,
  type PickupPointType,
  type StoreAdminDto,
  type StoreFulfillment,
  type StoreImagesDto,
  type StoreStatus,
  type StoreWorkingHourDto,
  type UpdateStoreInput,
} from '../../core/catalog/admin-catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { type AdminRole, canOnStores } from '../../core/permissions/permissions';
import { STORE_CURRENCIES, STORE_SLUG_PATTERN } from './store-options';
import { storeErrorMessage } from './store-errors';
import { StoreKitchenAccessComponent } from './store-kitchen-access.component';
import { StorePhotosComponent } from './store-photos.component';
import { TimezoneSelectComponent } from './timezone-select.component';
import {
  ALWAYS_OPEN_ROWS,
  type DayHours,
  type HoursMode,
  WEEK_ORDER,
  crossesMidnight,
  dayProblem,
  daysFromRows,
  hoursModeOf,
  rowsFromDays,
} from './working-hours';

export type EditorTab = 'details' | 'hours' | 'photos' | 'kitchen';

const FULFILLMENTS: readonly StoreFulfillment[] = ['TAKEAWAY', 'DINE_IN', 'DRIVE_THRU', 'DELIVERY'];
const PICKUP_POINTS: readonly PickupPointType[] = ['COUNTER', 'SHELF', 'LOCKER'];

type DayGroup = FormGroup<{ isClosed: FormControl<boolean>; opens: FormControl<string>; closes: FormControl<string> }>;
type DetailsField = keyof StoreEditorComponent['detailsForm']['controls'];

function atLeastOneChecked(group: AbstractControl): ValidationErrors | null {
  const values = Object.values((group as FormGroup).getRawValue() as Record<string, boolean>);
  return values.some(Boolean) ? null : { noneChecked: true };
}

function validDay(group: AbstractControl): ValidationErrors | null {
  const problem = dayProblem((group as DayGroup).getRawValue());
  return problem ? { [problem]: true } : null;
}

/** Cents as the currency's units for an input, and back; empty stays empty. */
function toUnits(cents: number | null | undefined): number | null {
  return cents == null ? null : cents / 100;
}
function toCents(units: number | null): number | null {
  return units == null ? null : Math.round(units * 100);
}

/**
 * Inline editor for an existing store: details (incl. till and kitchen
 * settings), working hours, photos and kitchen PINs. Details and hours are
 * saved together by one Save — a change on the tab you are not looking at
 * used to be dropped without a word.
 */
@Component({
  selector: 'app-store-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    LeafletMapComponent,
    TimezoneSelectComponent,
    StorePhotosComponent,
    StoreKitchenAccessComponent,
  ],
  template: `
    <div
      style="background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 16px"
    >
      <div class="flex flex-wrap" style="gap: 8px" role="tablist">
        @for (t of tabs(); track t) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="tab() === t"
            (click)="tab.set(t)"
            class="tab"
            [class.tab-active]="tab() === t"
          >
            {{ 'admin.stores.editor.tabs.' + t | translate }}
            @if (tabDirty(t)) {
              <span class="dot" [title]="'admin.stores.editor.unsaved' | translate"></span>
            }
          </button>
        }
      </div>

      @if (loading()) {
        <p class="hint">{{ 'common.loading' | translate }}</p>
      } @else if (loadError()) {
        <div class="flex items-center flex-wrap" style="gap: 10px" role="alert">
          <span class="error">{{ 'admin.stores.editor.loadFailed' | translate }} {{ loadError() }}</span>
          <button type="button" (click)="load()" class="btn-secondary">{{ 'common.retry' | translate }}</button>
        </div>
      } @else {
        @if (!canEdit()) {
          <p class="hint">{{ 'admin.stores.editor.readOnly' | translate }}</p>
        }
        @switch (tab()) {
          @case ('details') {
            <form [formGroup]="detailsForm" (ngSubmit)="save()" class="flex flex-col" style="gap: 18px">
              <fieldset class="section">
                <legend class="section-title">{{ 'admin.stores.editor.sections.basics' | translate }}</legend>
                <div class="form-row">
                  <label class="field">
                    <span class="label">{{ 'admin.stores.fields.name' | translate }}</span>
                    <input formControlName="name" class="input" [class.invalid]="shows('name')" />
                  </label>
                  <label class="field">
                    <span class="label">{{ 'admin.stores.editor.status' | translate }}</span>
                    <select formControlName="status" class="input">
                      @for (s of statuses; track s) {
                        <option [value]="s">{{ 'admin.stores.status.' + s | translate }}</option>
                      }
                    </select>
                    @if (openingBlocked()) {
                      <span class="hint">{{ 'admin.stores.editor.statusNotReady' | translate }}</span>
                    }
                  </label>
                </div>
                <label class="field">
                  <span class="label">{{ 'admin.stores.fields.addressLine' | translate }}</span>
                  <input formControlName="addressLine" class="input" [class.invalid]="shows('addressLine')" />
                </label>
                <div class="form-row">
                  <label class="field">
                    <span class="label">{{ 'admin.stores.fields.city' | translate }}</span>
                    <input formControlName="city" class="input" [class.invalid]="shows('city')" />
                  </label>
                  <label class="field">
                    <span class="label">{{ 'admin.stores.fields.country' | translate }}</span>
                    <input
                      formControlName="country"
                      maxlength="2"
                      [placeholder]="'admin.stores.placeholders.country' | translate"
                      class="input mono"
                      style="text-transform: uppercase"
                      [class.invalid]="shows('country')"
                    />
                  </label>
                </div>
                <div class="form-row">
                  <label class="field">
                    <span class="label">{{ 'admin.stores.fields.phone' | translate }}</span>
                    <input
                      formControlName="phone"
                      type="tel"
                      [placeholder]="'admin.stores.placeholders.phone' | translate"
                      class="input mono"
                    />
                  </label>
                  <label class="field">
                    <span class="label">{{ 'admin.stores.fields.email' | translate }}</span>
                    <input
                      formControlName="email"
                      type="email"
                      autocapitalize="none"
                      class="input mono"
                      [class.invalid]="shows('email')"
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset class="section">
                <legend class="section-title">{{ 'admin.stores.editor.sections.location' | translate }}</legend>
                <div
                  style="height: 240px; border-radius: 10px; overflow: hidden; border: 1px solid var(--color-border)"
                >
                  <lib-leaflet-map
                    [pickable]="canEdit()"
                    [markers]="pickerMarkers()"
                    [zoom]="14"
                    (markerMoved)="onPickerMoved($event)"
                  />
                </div>
                <span class="hint" [class.warn]="!hasCoordinates()">{{
                  (hasCoordinates() ? 'admin.stores.fields.pickOnMap' : 'admin.stores.hints.noCoordinates') | translate
                }}</span>
                <div class="form-row">
                  <label class="field">
                    <span class="label">{{ 'admin.stores.fields.latitude' | translate }}</span>
                    <input formControlName="latitude" type="number" step="0.000001" class="input mono" />
                  </label>
                  <label class="field">
                    <span class="label">{{ 'admin.stores.fields.longitude' | translate }}</span>
                    <input formControlName="longitude" type="number" step="0.000001" class="input mono" />
                  </label>
                </div>
                <div class="field">
                  <span class="label">{{ 'admin.stores.fields.timezone' | translate }}</span>
                  <app-timezone-select formControlName="timezone" />
                  <span class="hint" [class.warn]="timezoneUnset()">{{
                    (timezoneUnset() ? 'admin.stores.hints.timezoneUnset' : 'admin.stores.hints.timezone') | translate
                  }}</span>
                </div>
              </fieldset>

              <fieldset class="section">
                <legend class="section-title">{{ 'admin.stores.editor.sections.ops' | translate }}</legend>
                <div class="form-row">
                  <label class="field">
                    <span class="label">{{ 'admin.stores.fields.currency' | translate }}</span>
                    <select formControlName="currency" class="input">
                      @for (c of currencies; track c) {
                        <option [value]="c">{{ c }}</option>
                      }
                    </select>
                    <span class="hint">{{
                      (store()?.hasOrders ? 'admin.stores.editor.currencyLocked' : 'admin.stores.hints.currency')
                        | translate
                    }}</span>
                  </label>
                  <label class="field">
                    <span class="label">{{ 'admin.stores.ops.minOrder' | translate: { currency: currency() } }}</span>
                    <input formControlName="minOrder" type="number" min="0" step="0.01" class="input mono" />
                    <span class="hint">{{ 'admin.stores.ops.minOrderHint' | translate }}</span>
                  </label>
                </div>
                <div class="form-row">
                  <label class="field">
                    <span class="label">{{ 'admin.stores.ops.taxRate' | translate }}</span>
                    <input
                      formControlName="taxPercent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      class="input mono"
                      [class.invalid]="shows('taxPercent')"
                    />
                    <span class="hint">{{ 'admin.stores.ops.taxRateHint' | translate }}</span>
                  </label>
                  <label class="check" style="align-self: center">
                    <input type="checkbox" formControlName="taxIncluded" />
                    <span>{{ 'admin.stores.ops.taxIncluded' | translate }}</span>
                  </label>
                </div>
                <div
                  class="field"
                  formGroupName="fulfillment"
                  role="group"
                  [attr.aria-label]="'admin.stores.ops.fulfillment' | translate"
                >
                  <span class="label">{{ 'admin.stores.ops.fulfillment' | translate }}</span>
                  <div class="flex flex-wrap" style="gap: 14px">
                    @for (f of fulfillmentOptions(); track f) {
                      <label class="check">
                        <input type="checkbox" [formControlName]="f" />
                        <span>{{ 'admin.stores.ops.fulfillmentTypes.' + f | translate }}</span>
                      </label>
                    }
                  </div>
                  @if (detailsForm.controls.fulfillment.invalid) {
                    <span class="error">{{ 'admin.stores.ops.fulfillmentRequired' | translate }}</span>
                  }
                </div>
                <div class="form-row">
                  <label class="field">
                    <span class="label">{{ 'admin.stores.ops.pickupPoint' | translate }}</span>
                    <select formControlName="pickupPointType" class="input">
                      @for (p of pickupPoints; track p) {
                        <option [value]="p">{{ 'admin.stores.ops.pickupPoints.' + p | translate }}</option>
                      }
                    </select>
                  </label>
                  <label class="field">
                    <span class="label">{{ 'admin.stores.ops.baseEta' | translate }}</span>
                    <input
                      formControlName="baseEtaMinutes"
                      type="number"
                      min="0"
                      max="60"
                      step="0.5"
                      class="input mono"
                      [class.invalid]="shows('baseEtaMinutes')"
                    />
                    <span class="hint">{{ 'admin.stores.ops.baseEtaHint' | translate }}</span>
                  </label>
                </div>
                <div class="form-row">
                  <label class="field">
                    <span class="label">{{ 'admin.stores.ops.parallelism' | translate }}</span>
                    <input
                      formControlName="kitchenParallelism"
                      type="number"
                      min="1"
                      max="20"
                      step="1"
                      class="input mono"
                      [class.invalid]="shows('kitchenParallelism')"
                    />
                    <span class="hint">{{ 'admin.stores.ops.parallelismHint' | translate }}</span>
                  </label>
                  <label class="field">
                    <span class="label">{{ 'admin.stores.ops.slotCapacity' | translate }}</span>
                    <input
                      formControlName="slotCapacity"
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      class="input mono"
                      [class.invalid]="shows('slotCapacity')"
                    />
                    <span class="hint">{{ 'admin.stores.ops.slotCapacityHint' | translate }}</span>
                  </label>
                </div>
              </fieldset>

              @if (deliveryEnabled()) {
                <fieldset class="section" formGroupName="delivery">
                  <legend class="section-title">{{ 'admin.stores.delivery.title' | translate }}</legend>
                  <span class="hint">{{ 'admin.stores.delivery.hint' | translate }}</span>
                  <div class="form-row">
                    <label class="field">
                      <span class="label">{{
                        'admin.stores.delivery.baseFee' | translate: { currency: currency() }
                      }}</span>
                      <input formControlName="baseFee" type="number" min="0" step="0.01" class="input mono" />
                    </label>
                    <label class="field">
                      <span class="label">{{
                        'admin.stores.delivery.perKm' | translate: { currency: currency() }
                      }}</span>
                      <input formControlName="perKm" type="number" min="0" step="0.01" class="input mono" />
                    </label>
                  </div>
                  <div class="form-row">
                    <label class="field">
                      <span class="label">{{ 'admin.stores.delivery.freeRadius' | translate }}</span>
                      <input formControlName="freeRadiusM" type="number" min="0" step="50" class="input mono" />
                    </label>
                    <label class="field">
                      <span class="label">{{ 'admin.stores.delivery.maxRadius' | translate }}</span>
                      <input formControlName="maxRadiusM" type="number" min="0" step="100" class="input mono" />
                    </label>
                  </div>
                </fieldset>
              }

              <details class="section">
                <summary class="section-title" style="cursor: pointer">
                  {{ 'admin.stores.advanced' | translate }}
                </summary>
                <label class="field" style="margin-top: 10px">
                  <span class="label">{{ 'admin.stores.fields.slug' | translate }}</span>
                  <input formControlName="slug" class="input mono" [class.invalid]="shows('slug')" />
                  <span class="hint">{{
                    'admin.stores.hints.slugPage' | translate: { slug: detailsForm.controls.slug.value }
                  }}</span>
                  @if (shows('slug')) {
                    <span class="error">{{ 'admin.stores.errors.slugFormat' | translate }}</span>
                  }
                </label>
              </details>
            </form>
          }
          @case ('hours') {
            <form [formGroup]="hoursForm" (ngSubmit)="save()" class="flex flex-col" style="gap: 12px">
              <span class="hint">{{ 'admin.stores.hoursEditor.timezoneNote' | translate: { zone: zoneName() } }}</span>
              @if (hoursMode() === 'unset') {
                <p class="notice">{{ 'admin.stores.hoursEditor.unset' | translate }}</p>
              }
              <div
                class="flex flex-wrap"
                style="gap: 18px"
                role="radiogroup"
                [attr.aria-label]="'admin.stores.hoursEditor.mode' | translate"
              >
                <label class="check">
                  <input
                    type="radio"
                    [name]="'hours-mode-' + storeId()"
                    [checked]="hoursMode() === 'schedule'"
                    [disabled]="!canEdit()"
                    (change)="setHoursMode('schedule')"
                  />
                  <span>{{ 'admin.stores.hoursEditor.schedule' | translate }}</span>
                </label>
                <label class="check">
                  <input
                    type="radio"
                    [name]="'hours-mode-' + storeId()"
                    [checked]="hoursMode() === 'always'"
                    [disabled]="!canEdit()"
                    (change)="setHoursMode('always')"
                  />
                  <span>{{ 'admin.stores.hoursEditor.always' | translate }}</span>
                </label>
              </div>

              @if (hoursMode() === 'schedule') {
                <div formArrayName="days" class="flex flex-col" style="gap: 8px">
                  @for (weekday of weekOrder; track weekday) {
                    <div
                      [formGroupName]="weekday"
                      class="flex items-center flex-wrap"
                      style="gap: 10px; min-height: 32px"
                    >
                      <span style="width: 34px; font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
                        'admin.stores.hoursEditor.days.' + weekday | translate
                      }}</span>
                      <label class="check">
                        <input type="checkbox" formControlName="isClosed" />
                        <span>{{ 'admin.stores.hoursEditor.closed' | translate }}</span>
                      </label>
                      @if (!day(weekday).controls.isClosed.value) {
                        <input
                          type="time"
                          formControlName="opens"
                          [attr.aria-label]="'admin.stores.hoursEditor.opens' | translate"
                          class="input mono time"
                          [class.invalid]="dayError(weekday)"
                        />
                        <span class="hint">—</span>
                        <input
                          type="time"
                          formControlName="closes"
                          [attr.aria-label]="'admin.stores.hoursEditor.closes' | translate"
                          class="input mono time"
                          [class.invalid]="dayError(weekday)"
                        />
                        @if (dayError(weekday); as problem) {
                          <span class="error">{{ 'admin.stores.hoursEditor.' + problem | translate }}</span>
                        } @else if (dayNote(weekday); as note) {
                          <span class="hint">{{ note.key | translate: note.params }}</span>
                        }
                      }
                    </div>
                  }
                </div>
                @if (canEdit()) {
                  <button type="button" (click)="copyMonday()" class="link">
                    {{ 'admin.stores.hoursEditor.copyMonday' | translate }}
                  </button>
                }
              }
            </form>
          }
          @case ('photos') {
            @if (store(); as s) {
              <app-store-photos
                [storeId]="s.id"
                [heroImageUrl]="s.heroImageUrl ?? null"
                [galleryUrls]="s.galleryUrls ?? []"
                [canEdit]="canEdit()"
                (changed)="onPhotosChanged($event)"
              />
            }
          }
          @case ('kitchen') {
            <app-store-kitchen-access [storeId]="storeId()" />
          }
        }
      }

      <div class="flex items-center flex-wrap" style="gap: 12px">
        @if (canEdit() && (tab() === 'details' || tab() === 'hours' || hasUnsavedChanges())) {
          <button
            type="button"
            (click)="save()"
            [disabled]="saving() || loading() || !!loadError()"
            class="btn-primary disabled:opacity-50"
          >
            {{ (saving() ? 'admin.stores.editor.saving' : 'common.save') | translate }}
          </button>
        }
        <button type="button" (click)="requestClose()" class="btn-secondary">{{ 'common.close' | translate }}</button>
        @if (hasUnsavedChanges() && !saving()) {
          <span class="hint">{{ 'admin.stores.editor.unsaved' | translate }}</span>
        }
        @if (saved()) {
          <span style="color: var(--color-mint); font-family: var(--font-sans); font-size: 13px">{{
            'admin.stores.editor.saved' | translate
          }}</span>
        }
        @if (error()) {
          <span role="alert" class="error">{{ error() }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border-radius: 999px;
        font-family: var(--font-sans);
        font-size: 13px;
        cursor: pointer;
        background: var(--color-foam);
        color: var(--color-text-secondary);
        border: 1px solid var(--color-border);
      }
      .tab-active {
        background: var(--color-caramel);
        color: white;
        border-color: var(--color-caramel);
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: var(--color-amber);
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
        margin: 0;
        padding: 14px;
        border: 1px solid var(--color-border-light);
        border-radius: 12px;
        background: var(--color-foam);
      }
      .section-title {
        padding: 0 4px;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .label {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .input {
        height: 36px;
        padding: 0 10px;
        background: var(--color-foam);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-family: var(--font-sans);
        font-size: 14px;
        outline: none;
      }
      .mono {
        font-family: var(--font-mono);
        font-size: 13px;
      }
      .time {
        width: 110px;
        height: 32px;
      }
      .invalid {
        border-color: var(--color-berry);
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .hint,
      .error {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .warn {
        color: #8a6720;
      }
      .error {
        color: var(--color-berry);
      }
      .notice {
        margin: 0;
        padding: 10px 12px;
        border-left: 4px solid var(--color-amber);
        border-radius: 8px;
        background: var(--color-foam);
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .link {
        align-self: flex-start;
        padding: 0;
        background: none;
        border: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-caramel);
        cursor: pointer;
      }
      .btn-primary,
      .btn-secondary {
        padding: 8px 16px;
        border: 0;
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-weight: 600;
        cursor: pointer;
      }
      .btn-primary {
        background: var(--color-caramel);
        color: white;
      }
      .btn-secondary {
        background: var(--color-latte);
        color: var(--color-espresso);
      }
    `,
  ],
})
export class StoreEditorComponent implements OnInit {
  readonly storeId = input.required<string>();
  readonly initialTab = input<EditorTab>('details');
  readonly saveCompleted = output<StoreAdminDto>();
  readonly closed = output<void>();

  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthStore);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly role = computed(() => this.auth.user()?.role as AdminRole | undefined);
  readonly canEdit = computed(() => canOnStores(this.role(), 'edit'));
  readonly canManageStaff = computed(() => canOnStores(this.role(), 'manageStaff'));
  readonly deliveryEnabled = this.flags.deliveryEnabled;

  readonly tabs = computed<EditorTab[]>(() =>
    this.canManageStaff() ? ['details', 'hours', 'photos', 'kitchen'] : ['details', 'hours', 'photos'],
  );
  readonly tab = signal<EditorTab>('details');
  readonly store = signal<StoreAdminDto | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);
  /** Set by a save attempt: from then on every invalid field shows why. */
  private readonly submitted = signal(false);

  readonly hoursMode = signal<HoursMode>('unset');
  private readonly savedHoursMode = signal<HoursMode>('unset');

  readonly statuses: readonly StoreStatus[] = ['CLOSED', 'OPEN', 'OVERLOADED'];
  readonly currencies = STORE_CURRENCIES;
  readonly pickupPoints = PICKUP_POINTS;
  readonly weekOrder = WEEK_ORDER;
  /** DELIVERY is only offered while the delivery module is switched on. */
  readonly fulfillmentOptions = computed(() =>
    this.deliveryEnabled() ? FULFILLMENTS : FULFILLMENTS.filter((f) => f !== 'DELIVERY'),
  );

  readonly detailsForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    status: new FormControl<StoreStatus>('CLOSED', { nonNullable: true }),
    addressLine: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    country: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)],
    }),
    phone: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.email] }),
    latitude: new FormControl<number | null>(null, { validators: [Validators.min(-90), Validators.max(90)] }),
    longitude: new FormControl<number | null>(null, { validators: [Validators.min(-180), Validators.max(180)] }),
    timezone: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    currency: new FormControl('MDL', { nonNullable: true }),
    minOrder: new FormControl<number | null>(0, { validators: [Validators.min(0)] }),
    taxPercent: new FormControl<number | null>(0, {
      validators: [Validators.required, Validators.min(0), Validators.max(100)],
    }),
    taxIncluded: new FormControl(true, { nonNullable: true }),
    fulfillment: new FormGroup(
      {
        TAKEAWAY: new FormControl(true, { nonNullable: true }),
        DINE_IN: new FormControl(false, { nonNullable: true }),
        DRIVE_THRU: new FormControl(false, { nonNullable: true }),
        DELIVERY: new FormControl(false, { nonNullable: true }),
      },
      { validators: [atLeastOneChecked] },
    ),
    pickupPointType: new FormControl<PickupPointType>('COUNTER', { nonNullable: true }),
    baseEtaMinutes: new FormControl<number | null>(10, {
      validators: [Validators.required, Validators.min(0), Validators.max(60)],
    }),
    kitchenParallelism: new FormControl<number | null>(2, {
      validators: [Validators.required, Validators.min(1), Validators.max(20)],
    }),
    slotCapacity: new FormControl<number | null>(8, {
      validators: [Validators.required, Validators.min(1), Validators.max(100)],
    }),
    delivery: new FormGroup({
      baseFee: new FormControl<number | null>(null, { validators: [Validators.min(0)] }),
      perKm: new FormControl<number | null>(null, { validators: [Validators.min(0)] }),
      freeRadiusM: new FormControl<number | null>(null, { validators: [Validators.min(0)] }),
      maxRadiusM: new FormControl<number | null>(null, { validators: [Validators.min(0)] }),
    }),
    slug: new FormControl('', { nonNullable: true, validators: [(control) => this.slugError(control)] }),
  });

  readonly hoursForm = new FormGroup({
    days: new FormArray<DayGroup>(
      Array.from(
        { length: 7 },
        () =>
          new FormGroup(
            {
              isClosed: new FormControl(false, { nonNullable: true }),
              opens: new FormControl('', { nonNullable: true }),
              closes: new FormControl('', { nonNullable: true }),
            },
            { validators: [validDay] },
          ),
      ),
    ),
  });

  /** Marker for the map picker — mirrors the lat/lng controls; none while the store sits at 0,0. */
  readonly pickerMarkers = signal<MapMarker[]>([]);
  readonly hasCoordinates = computed(() => this.pickerMarkers().length > 0);
  /** Form-control values the template reads outside of form bindings. */
  readonly currency = signal('MDL');
  readonly zoneName = signal('');

  readonly timezoneUnset = computed(() => {
    const zone = this.zoneName();
    return !zone || zone === 'UTC' || zone === 'Etc/UTC';
  });

  readonly openingBlocked = computed(() => {
    const s = this.store();
    return !!s && s.status === 'CLOSED' && s.readiness?.ready === false;
  });

  ngOnInit(): void {
    this.tab.set(this.initialTab() === 'kitchen' && !this.canManageStaff() ? 'details' : this.initialTab());
    const c = this.detailsForm.controls;
    merge(c.latitude.valueChanges, c.longitude.valueChanges)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncMarker());
    c.currency.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.currency.set(v));
    c.timezone.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.zoneName.set(v));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api
      .getStore(this.storeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.hydrate(s);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.loadError.set(storeErrorMessage(err, this.translate));
        },
      });
  }

  /** Called by the stores page when "Working hours" is pressed with the editor already open. */
  showTab(tab: EditorTab): void {
    this.tab.set(tab);
  }

  /** The store was opened or closed from its card while the editor is open. */
  statusChanged(updated: StoreAdminDto): void {
    const current = this.store();
    if (current) this.store.set({ ...current, status: updated.status, readiness: updated.readiness });
    const status = this.detailsForm.controls.status;
    if (!status.dirty) status.reset(updated.status, { emitEvent: false });
  }

  hasUnsavedChanges(): boolean {
    return this.canEdit() && (this.detailsForm.dirty || this.hoursDirty());
  }

  tabDirty(tab: EditorTab): boolean {
    if (!this.canEdit()) return false;
    if (tab === 'details') return this.detailsForm.dirty;
    if (tab === 'hours') return this.hoursDirty();
    return false;
  }

  requestClose(): void {
    if (this.hasUnsavedChanges() && !confirm(this.translate.instant('admin.stores.editor.unsavedConfirm'))) return;
    this.closed.emit();
  }

  /** An invalid field shows as such once touched or after a save attempt. */
  shows(name: DetailsField): boolean {
    const control = this.detailsForm.controls[name];
    return control.invalid && (control.touched || this.submitted());
  }

  day(weekday: number): DayGroup {
    const group = this.hoursForm.controls.days.at(weekday);
    if (!group) throw new Error(`No working-hours row for weekday ${weekday}`);
    return group;
  }

  dayError(weekday: number): 'missingTime' | 'sameTime' | null {
    const group = this.day(weekday);
    if (!group.dirty && !this.submitted()) return null;
    return dayProblem(group.getRawValue());
  }

  dayNote(weekday: number): { key: string; params?: Record<string, string> } | null {
    const value: DayHours = this.day(weekday).getRawValue();
    if (value.isClosed) return null;
    if (crossesMidnight(value)) return { key: 'admin.stores.hoursEditor.overnight', params: { time: value.closes } };
    if (value.closes === '00:00' && value.opens) return { key: 'admin.stores.hoursEditor.untilMidnight' };
    return null;
  }

  setHoursMode(mode: HoursMode): void {
    this.hoursMode.set(mode);
  }

  copyMonday(): void {
    const monday = this.day(1).getRawValue();
    for (const weekday of WEEK_ORDER) {
      if (weekday !== 1) this.day(weekday).setValue({ ...monday });
    }
    this.hoursForm.markAsDirty();
  }

  onPickerMoved(p: LatLng): void {
    this.detailsForm.patchValue({ latitude: round6(p.lat), longitude: round6(p.lng) });
    this.detailsForm.controls.latitude.markAsDirty();
  }

  onPhotosChanged(images: StoreImagesDto): void {
    const current = this.store();
    if (!current) return;
    const next = { ...current, ...images };
    this.store.set(next);
    this.saveCompleted.emit(next);
  }

  /**
   * Hours go first: opening the store in the same save is judged on the
   * hours it will have, not the ones it had. Each part that succeeds is
   * marked saved, so a refused status change doesn't make the hours look
   * unsaved.
   */
  async save(): Promise<void> {
    if (!this.canEdit() || this.saving() || this.loading() || this.loadError()) return;
    this.submitted.set(true);
    this.saved.set(false);
    this.error.set(null);

    const detailsDirty = this.detailsForm.dirty;
    const hoursDirty = this.hoursDirty();
    if (detailsDirty && this.detailsForm.invalid) {
      this.detailsForm.markAllAsTouched();
      this.tab.set('details');
      this.error.set(this.translate.instant('admin.stores.editor.invalid'));
      return;
    }
    if (hoursDirty && this.hoursMode() === 'schedule' && this.hoursForm.invalid) {
      this.hoursForm.markAllAsTouched();
      this.tab.set('hours');
      this.error.set(this.translate.instant('admin.stores.hoursEditor.invalid'));
      return;
    }
    if (!detailsDirty && !hoursDirty) {
      this.flashSaved();
      return;
    }

    const id = this.storeId();
    let changed = false;
    this.saving.set(true);
    try {
      if (hoursDirty) {
        await firstValueFrom(this.api.replaceWorkingHours(id, this.hoursRows()));
        this.savedHoursMode.set(this.hoursMode());
        this.hoursForm.markAsPristine();
        changed = true;
      }
      if (detailsDirty) {
        await firstValueFrom(this.api.updateStore(id, this.detailsPayload()));
        changed = true;
      }
      const fresh = await firstValueFrom(this.api.getStore(id));
      this.hydrate(fresh);
      this.saveCompleted.emit(fresh);
      this.flashSaved();
    } catch (err) {
      this.error.set(storeErrorMessage(err, this.translate));
      // Keep the card's checklist in step with the part that did save.
      if (changed) this.refreshStoreOnly();
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * A new slug must be URL-safe; the saved one is left alone even if it
   * predates the rule, so an old store doesn't have to be renamed to save
   * its phone number.
   */
  private slugError(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value ?? '').trim();
    if (value === this.store()?.slug) return null;
    const ok = value.length >= 2 && value.length <= 80 && STORE_SLUG_PATTERN.test(value);
    return ok ? null : { slug: true };
  }

  private hoursDirty(): boolean {
    if (this.hoursMode() !== this.savedHoursMode()) return true;
    return this.hoursMode() === 'schedule' && this.hoursForm.dirty;
  }

  private hoursRows(): StoreWorkingHourDto[] {
    if (this.hoursMode() === 'always') return [...ALWAYS_OPEN_ROWS];
    if (this.hoursMode() === 'schedule') return rowsFromDays(this.hoursForm.controls.days.getRawValue());
    return [];
  }

  private detailsPayload(): UpdateStoreInput {
    const v = this.detailsForm.getRawValue();
    const types = FULFILLMENTS.filter((f) => v.fulfillment[f]);
    // With the delivery module off the checkbox is hidden; keep a stored
    // DELIVERY rather than dropping it behind the owner's back.
    const hadDelivery = this.store()?.fulfillmentTypes?.includes('DELIVERY') ?? false;
    const fulfillmentTypes =
      !this.deliveryEnabled() && hadDelivery ? [...types.filter((f) => f !== 'DELIVERY'), 'DELIVERY' as const] : types;

    const payload: UpdateStoreInput = {
      name: v.name.trim(),
      addressLine: v.addressLine.trim(),
      city: v.city.trim(),
      country: v.country.trim().toUpperCase(),
      phone: v.phone.trim() || null,
      email: v.email.trim() || null,
      timezone: v.timezone,
      currency: v.currency,
      minOrderCents: toCents(v.minOrder) ?? 0,
      taxRateBps: Math.round((v.taxPercent ?? 0) * 100),
      taxIncludedInPrice: v.taxIncluded,
      fulfillmentTypes,
      pickupPointType: v.pickupPointType,
      baseEtaSeconds: Math.round((v.baseEtaMinutes ?? 0) * 60),
      kitchenParallelism: v.kitchenParallelism ?? 1,
      slotCapacity: v.slotCapacity ?? 1,
    };
    // Sent only when changed here, so an open/close from the card isn't undone by a later save.
    if (this.detailsForm.controls.status.dirty) payload.status = v.status;
    const slug = v.slug.trim();
    if (slug !== this.store()?.slug) payload.slug = slug;
    // The API refuses null coordinates; an unset map simply isn't sent.
    if (v.latitude != null && v.longitude != null) {
      payload.latitude = v.latitude;
      payload.longitude = v.longitude;
    }
    if (this.deliveryEnabled()) {
      payload.deliveryFeeBaseCents = toCents(v.delivery.baseFee);
      payload.deliveryFeePerKmCents = toCents(v.delivery.perKm);
      payload.deliveryFreeRadiusM = v.delivery.freeRadiusM == null ? null : Math.round(v.delivery.freeRadiusM);
      payload.deliveryMaxRadiusM = v.delivery.maxRadiusM == null ? null : Math.round(v.delivery.maxRadiusM);
    }
    return payload;
  }

  private hydrate(s: StoreAdminDto): void {
    this.store.set(s);
    const atOrigin = s.latitude === 0 && s.longitude === 0;
    const types = s.fulfillmentTypes ?? ['TAKEAWAY'];
    this.detailsForm.reset({
      name: s.name,
      status: s.status,
      addressLine: s.addressLine ?? '',
      city: s.city,
      country: s.country,
      phone: s.phone ?? '',
      email: s.email ?? '',
      latitude: atOrigin ? null : s.latitude,
      longitude: atOrigin ? null : s.longitude,
      timezone: s.timezone ?? '',
      currency: s.currency,
      minOrder: toUnits(s.minOrderCents ?? 0),
      taxPercent: (s.taxRateBps ?? 0) / 100,
      taxIncluded: s.taxIncludedInPrice ?? true,
      fulfillment: {
        TAKEAWAY: types.includes('TAKEAWAY'),
        DINE_IN: types.includes('DINE_IN'),
        DRIVE_THRU: types.includes('DRIVE_THRU'),
        DELIVERY: types.includes('DELIVERY'),
      },
      pickupPointType: s.pickupPointType ?? 'COUNTER',
      baseEtaMinutes: (s.baseEtaSeconds ?? 600) / 60,
      kitchenParallelism: s.kitchenParallelism ?? 2,
      slotCapacity: s.slotCapacity ?? 8,
      delivery: {
        baseFee: toUnits(s.deliveryFeeBaseCents),
        perKm: toUnits(s.deliveryFeePerKmCents),
        freeRadiusM: s.deliveryFreeRadiusM ?? null,
        maxRadiusM: s.deliveryMaxRadiusM ?? null,
      },
      slug: s.slug,
    });
    // A menu with no DELIVERY checkbox can't make the group "none checked".
    if (!this.deliveryEnabled() && types.length === 1 && types[0] === 'DELIVERY') {
      this.detailsForm.controls.fulfillment.controls.TAKEAWAY.setValue(true);
    }
    this.currency.set(s.currency);
    this.zoneName.set(s.timezone ?? '');

    const rows = s.workingHours ?? [];
    const mode = hoursModeOf(rows);
    this.hoursMode.set(mode);
    this.savedHoursMode.set(mode);
    daysFromRows(rows).forEach((d, weekday) => this.day(weekday).reset(d));
    this.hoursForm.markAsPristine();

    this.submitted.set(false);
    this.syncMarker();
    if (!this.canEdit()) {
      this.detailsForm.disable({ emitEvent: false });
      this.hoursForm.disable({ emitEvent: false });
    } else if (s.hasOrders) {
      // The API refuses a new currency once orders carry the old one.
      this.detailsForm.controls.currency.disable({ emitEvent: false });
    } else {
      this.detailsForm.controls.currency.enable({ emitEvent: false });
    }
  }

  private refreshStoreOnly(): void {
    this.api.getStore(this.storeId()).subscribe({
      next: (fresh) => {
        this.store.set(fresh);
        this.saveCompleted.emit(fresh);
      },
      error: () => undefined,
    });
  }

  private syncMarker(): void {
    const { latitude, longitude } = this.detailsForm.getRawValue();
    const placed =
      typeof latitude === 'number' && typeof longitude === 'number' && !(latitude === 0 && longitude === 0);
    this.pickerMarkers.set(placed ? [{ id: this.storeId(), lat: latitude, lng: longitude, kind: 'store' }] : []);
  }

  private flashSaved(): void {
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2500);
  }
}

/** Six decimals is ~10 cm — more is map-click noise. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
