import { Component, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import {
  AdminCatalogApi,
  type CreateStoreInput,
  type ReadinessCheck,
  type StoreAdminDto,
  type StoreStatus,
} from '../../core/catalog/admin-catalog.service';
import { apiErrorCode } from '../../core/http/api-error';
import { type AdminRole, canOnStores } from '../../core/permissions/permissions';
import { type EditorTab, StoreEditorComponent } from './store-editor.component';
import { storeErrorMessage } from './store-errors';
import { STORE_CURRENCIES, STORE_SLUG_PATTERN, defaultCountryFor } from './store-options';
import { StoreReadinessComponent } from './store-readiness.component';
import { TimezoneSelectComponent, defaultStoreTimeZone } from './timezone-select.component';

/** A failed action on one store, shown on that store's card. */
interface CardError {
  text: string;
  /** Deleting was refused because of orders: closing is the way out. */
  offerClose: boolean;
}

@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    StoreEditorComponent,
    LeafletMapComponent,
    TimezoneSelectComponent,
    StoreReadinessComponent,
  ],
  template: `
    <div
      class="flex items-center justify-between flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.stores.title' | translate }}
      </h1>
      @if (canCreate()) {
        <button
          type="button"
          (click)="toggleCreateForm()"
          [disabled]="!hasBrand()"
          class="disabled:opacity-50"
          style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
        >
          {{ (creatingOpen() ? 'common.close' : 'admin.stores.add') | translate }}
        </button>
      }
    </div>

    <section style="padding: 24px; display: flex; flex-direction: column; gap: 16px">
      @if (brandBlocker(); as blocker) {
        <div
          style="padding: 16px 18px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-left: 4px solid var(--color-amber); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
        >
          <p style="margin: 0 0 6px; font-weight: 600">{{ 'admin.brandContext.blockedTitle' | translate }}</p>
          @if (blocker === 'error') {
            <p style="margin: 0 0 10px; color: var(--color-text-secondary)">
              {{ 'admin.brandContext.loadFailed' | translate }} {{ activeBrand.loadError() }}
            </p>
            <button
              type="button"
              (click)="activeBrand.refresh()"
              [disabled]="activeBrand.loading()"
              style="height: 32px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: 8px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
            >
              {{ 'common.retry' | translate }}
            </button>
          } @else {
            <p style="margin: 0; color: var(--color-text-secondary)">
              {{ 'admin.brandContext.noBrandsHint' | translate }}
            </p>
          }
        </div>
      }

      @if (creatingOpen()) {
        <form
          [formGroup]="createForm"
          (ngSubmit)="submitCreate()"
          class="form-row"
          style="padding: 18px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px"
        >
          <p
            class="form-row-full"
            style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            {{ 'admin.stores.createForm.note' | translate }}
          </p>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.name' | translate
            }}</span>
            <input
              formControlName="name"
              [placeholder]="'admin.stores.placeholders.name' | translate"
              [style.border-color]="invalid('name') ? 'var(--color-berry)' : null"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.addressLine' | translate
            }}</span>
            <input
              formControlName="addressLine"
              [placeholder]="'admin.stores.placeholders.address' | translate"
              [style.border-color]="invalid('addressLine') ? 'var(--color-berry)' : null"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.city' | translate
            }}</span>
            <input
              formControlName="city"
              [placeholder]="'admin.stores.placeholders.city' | translate"
              [style.border-color]="invalid('city') ? 'var(--color-berry)' : null"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.country' | translate
            }}</span>
            <input
              formControlName="country"
              maxlength="2"
              [placeholder]="'admin.stores.placeholders.country' | translate"
              [style.border-color]="invalid('country') ? 'var(--color-berry)' : null"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px; text-transform: uppercase"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.currency' | translate
            }}</span>
            <select
              formControlName="currency"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            >
              @for (c of currencies; track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select>
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
              'admin.stores.hints.currency' | translate
            }}</span>
          </label>
          <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.timezone' | translate
            }}</span>
            <app-timezone-select formControlName="timezone" />
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
              'admin.stores.hints.timezone' | translate
            }}</span>
          </div>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.phone' | translate
            }}</span>
            <input
              formControlName="phone"
              type="tel"
              [placeholder]="'admin.stores.placeholders.phone' | translate"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.email' | translate
            }}</span>
            <input
              formControlName="email"
              type="email"
              autocapitalize="none"
              [style.border-color]="invalid('email') ? 'var(--color-berry)' : null"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <div class="form-row-full" style="display: flex; flex-direction: column; gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.location' | translate
            }}</span>
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
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.latitude' | translate
            }}</span>
            <input
              formControlName="latitude"
              type="number"
              step="0.000001"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.longitude' | translate
            }}</span>
            <input
              formControlName="longitude"
              type="number"
              step="0.000001"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <details class="form-row-full">
            <summary
              style="cursor: pointer; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
            >
              {{ 'admin.stores.advanced' | translate }}
            </summary>
            <label style="display: flex; flex-direction: column; gap: 4px; margin-top: 10px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'admin.stores.fields.slug' | translate
              }}</span>
              <input
                formControlName="slug"
                autocapitalize="none"
                [style.border-color]="invalid('slug') ? 'var(--color-berry)' : null"
                style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono)"
              />
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                (invalid('slug') ? 'admin.stores.errors.slugFormat' : 'admin.stores.hints.slugAuto') | translate
              }}</span>
            </label>
          </details>
          <div class="form-row-full flex items-center flex-wrap" style="justify-content: flex-end; gap: 8px">
            @if (createError()) {
              <p
                role="alert"
                style="flex: 1 1 240px; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
              >
                {{ createError() }}
              </p>
            }
            <button
              type="button"
              (click)="toggleCreateForm()"
              style="height: 36px; padding: 0 14px; color: var(--color-text-secondary)"
            >
              {{ 'common.cancel' | translate }}
            </button>
            <button
              type="submit"
              [disabled]="creating()"
              class="disabled:opacity-50"
              style="height: 36px; padding: 0 18px; background: var(--color-caramel); color: white; border-radius: 8px; font-family: var(--font-sans); font-weight: 600"
            >
              {{ (creating() ? 'common.loading' : 'admin.stores.create') | translate }}
            </button>
          </div>
        </form>
      }

      @if (listError()) {
        <div class="flex items-center flex-wrap" style="gap: 10px" role="alert">
          <p style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
            {{ 'admin.stores.loadFailed' | translate }}: {{ listError() }}
          </p>
          <button
            type="button"
            (click)="reload()"
            style="height: 30px; padding: 0 12px; background: var(--color-latte); color: var(--color-espresso); border-radius: 8px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
          >
            {{ 'common.retry' | translate }}
          </button>
        </div>
      } @else if (loaded() && stores().length === 0 && hasBrand()) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ (canCreate() ? 'admin.stores.empty' : 'admin.stores.emptyAssigned') | translate }}
        </p>
      }

      <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px">
        @for (s of stores(); track s.id) {
          <article
            class="flex flex-col"
            [style.grid-column]="editingId() === s.id ? '1 / -1' : null"
            style="min-width: 0; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 12px"
          >
            <header class="flex items-start justify-between" style="gap: 12px">
              <div class="flex flex-col" style="gap: 4px; min-width: 0">
                <span
                  style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso)"
                  >{{ s.name }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
                  >{{ s.city }} · {{ s.country }}</span
                >
              </div>
              <span
                [style.background]="statusBg(s.status)"
                [style.color]="statusColor(s.status)"
                style="flex: none; padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                >{{ 'admin.stores.status.' + s.status | translate }}</span
              >
            </header>

            <div class="flex items-center flex-wrap" style="gap: 8px 12px">
              <span
                class="flex items-center"
                style="height: 24px; padding: 0 8px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-secondary)"
                >{{ s.currency }}</span
              >
              @if (s.timezone) {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                  s.timezone
                }}</span>
              }
              <span style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-tertiary)"
                >/stores/{{ s.slug }}</span
              >
            </div>

            @if (s.readiness && showReadiness(s)) {
              <app-store-readiness
                [readiness]="s.readiness"
                [status]="s.status"
                [canFix]="canEdit()"
                (fix)="fixReadiness(s.id, $event)"
              />
            }

            <div class="flex flex-wrap" style="gap: 8px; margin-top: 4px">
              <button
                type="button"
                (click)="openEditor(s.id, 'details')"
                style="flex: 1 1 120px; height: 36px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary); cursor: pointer"
              >
                {{
                  (editingId() === s.id ? 'common.close' : canEdit() ? 'admin.stores.edit' : 'admin.stores.view')
                    | translate
                }}
              </button>
              <button
                type="button"
                (click)="openEditor(s.id, 'hours')"
                style="flex: 1 1 120px; height: 36px; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; cursor: pointer"
              >
                {{ 'admin.stores.hours' | translate }}
              </button>
              @if (canEdit()) {
                @if (s.status === 'CLOSED') {
                  <button
                    type="button"
                    (click)="setStatus(s, 'OPEN')"
                    [disabled]="busyId() === s.id || !s.readiness?.ready"
                    [title]="(s.readiness?.ready ? '' : 'admin.stores.openBlocked') | translate"
                    class="disabled:opacity-50"
                    style="flex: 1 1 120px; height: 36px; background: #3e8868; color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; cursor: pointer"
                  >
                    {{ (busyId() === s.id ? 'common.loading' : 'admin.stores.open') | translate }}
                  </button>
                } @else {
                  <button
                    type="button"
                    (click)="setStatus(s, 'CLOSED')"
                    [disabled]="busyId() === s.id"
                    style="flex: 1 1 120px; height: 36px; background: transparent; border: 1px solid var(--color-border); color: var(--color-text-primary); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500; cursor: pointer"
                  >
                    {{ (busyId() === s.id ? 'common.loading' : 'admin.stores.close') | translate }}
                  </button>
                }
              }
              @if (canDelete()) {
                <button
                  type="button"
                  (click)="remove(s)"
                  [disabled]="busyId() === s.id"
                  style="height: 36px; padding: 0 12px; background: transparent; color: var(--color-berry); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500"
                >
                  {{ 'admin.stores.delete' | translate }}
                </button>
              }
            </div>

            @if (cardErrors()[s.id]; as failure) {
              <div class="flex items-center flex-wrap" style="gap: 10px" role="alert">
                <p
                  style="flex: 1 1 200px; margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)"
                >
                  {{ failure.text }}
                </p>
                @if (failure.offerClose && s.status !== 'CLOSED') {
                  <button
                    type="button"
                    (click)="setStatus(s, 'CLOSED', true)"
                    [disabled]="busyId() === s.id"
                    style="height: 32px; padding: 0 12px; background: var(--color-latte); color: var(--color-espresso); border-radius: 8px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
                  >
                    {{ 'admin.stores.close' | translate }}
                  </button>
                }
              </div>
            }

            @if (editingId() === s.id) {
              <app-store-editor
                [storeId]="s.id"
                [initialTab]="editorTab()"
                (saveCompleted)="onSaved($event)"
                (closed)="closeEditor()"
              />
            }
          </article>
        }
      </div>
    </section>
  `,
})
export class StoresPage implements OnInit {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthStore);
  readonly activeBrand = inject(ActiveBrandService);

  private readonly editor = viewChild(StoreEditorComponent);

  /**
   * Why the page can't create anything: `error` = the brand list failed to
   * load, `empty` = it loaded and the account has no brand yet. `null` =
   * either we're still loading or there's a brand and we're good.
   */
  readonly brandBlocker = computed<'error' | 'empty' | null>(() => {
    if (this.activeBrand.loadError()) return 'error';
    if (this.activeBrand.isEmpty()) return 'empty';
    return null;
  });
  readonly hasBrand = computed(() => this.activeBrand.active() !== null);

  private readonly role = computed(() => this.auth.user()?.role as AdminRole | undefined);
  readonly canCreate = computed(() => canOnStores(this.role(), 'create'));
  readonly canDelete = computed(() => canOnStores(this.role(), 'delete'));
  readonly canEdit = computed(() => canOnStores(this.role(), 'edit'));

  readonly currencies = STORE_CURRENCIES;
  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loaded = signal(false);
  readonly listError = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly editorTab = signal<EditorTab>('details');
  readonly busyId = signal<string | null>(null);
  readonly cardErrors = signal<Record<string, CardError>>({});

  readonly creatingOpen = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  private readonly createSubmitted = signal(false);
  private listRequest = 0;

  readonly createForm = new FormGroup({
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

  /** Marker for the create-form map picker — mirrors the lat/lng controls. */
  readonly pickerMarkers = signal<MapMarker[]>([]);

  constructor() {
    // Refetch the store list whenever the active brand changes (selector in
    // the top bar). Skip while no brand is resolved yet — loading state is
    // owned by ActiveBrandService.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      // Untracked: the request reads the session's token signal, and a
      // silent token refresh must not reload the page and close the editor.
      untracked(() => this.showBrand(brandId));
    });

    // Keep the picker marker in sync when lat/lng are typed manually.
    this.createForm.valueChanges.subscribe(({ latitude, longitude }) => {
      this.pickerMarkers.set(
        typeof latitude === 'number' && typeof longitude === 'number'
          ? [{ id: 'new', lat: latitude, lng: longitude, kind: 'store' }]
          : [],
      );
    });
  }

  ngOnInit(): void {
    // Brand list is normally loaded once by AdminLayoutPage; trigger here as
    // a safety net for direct navigation / hot-reload.
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();
  }

  reload(): void {
    const brandId = this.activeBrand.activeId();
    if (brandId) this.fetch(brandId);
  }

  onPickerMoved(p: LatLng): void {
    this.createForm.patchValue({ latitude: round6(p.lat), longitude: round6(p.lng) });
  }

  /** An invalid create-form field is marked once touched or after a submit attempt. */
  invalid(name: keyof StoresPage['createForm']['controls']): boolean {
    const control = this.createForm.controls[name];
    return control.invalid && (control.touched || this.createSubmitted());
  }

  toggleCreateForm(): void {
    const opening = !this.creatingOpen();
    this.creatingOpen.set(opening);
    this.createError.set(null);
    this.createSubmitted.set(false);
    if (opening) this.resetCreateForm();
  }

  submitCreate(): void {
    const brand = this.activeBrand.active();
    if (!brand) {
      this.createError.set(
        this.activeBrand.loadError()
          ? `${this.translate.instant('admin.brandContext.loadFailed')} ${this.activeBrand.loadError()}`
          : this.translate.instant('admin.brandContext.noBrandsHint'),
      );
      return;
    }
    this.createSubmitted.set(true);
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      const onlyMap = Object.entries(this.createForm.controls)
        .filter(([, control]) => control.invalid)
        .every(([name]) => name === 'latitude' || name === 'longitude');
      this.createError.set(
        this.translate.instant(onlyMap ? 'admin.stores.hints.clickMap' : 'admin.stores.createForm.invalid'),
      );
      return;
    }
    const v = this.createForm.getRawValue();
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
      next: (store) => {
        this.creating.set(false);
        this.creatingOpen.set(false);
        this.stores.update((list) => [store, ...list]);
        this.resetCreateForm();
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(storeErrorMessage(err, this.translate));
      },
    });
  }

  /**
   * "Edit" toggles the editor; "Working hours" opens it on the hours tab,
   * or switches an open editor to it — it used to open the details tab.
   */
  openEditor(id: string, tab: EditorTab): void {
    if (this.editingId() === id) {
      const editor = this.editor();
      if (tab === 'details' || this.editorTab() === tab) {
        if (editor) editor.requestClose();
        else this.closeEditor();
        return;
      }
      this.editorTab.set(tab);
      editor?.showTab(tab);
      return;
    }
    const open = this.editor();
    if (open?.hasUnsavedChanges() && !confirm(this.translate.instant('admin.stores.editor.unsavedConfirm'))) return;
    this.editorTab.set(tab);
    this.editingId.set(id);
  }

  fixReadiness(id: string, check: ReadinessCheck): void {
    const tab: EditorTab = check === 'hours' ? 'hours' : 'details';
    if (this.editingId() === id) {
      this.editorTab.set(tab);
      this.editor()?.showTab(tab);
      return;
    }
    this.openEditor(id, tab);
  }

  closeEditor(): void {
    this.editingId.set(null);
  }

  onSaved(updated: StoreAdminDto): void {
    this.replace(updated);
    this.clearCardError(updated.id);
  }

  showReadiness(s: StoreAdminDto): boolean {
    return s.status === 'CLOSED' || !!s.readiness?.items.some((i) => !i.ok);
  }

  /**
   * Opening is refused by the API until the readiness checks pass; closing
   * is always allowed and is the way out for a store that has orders and
   * therefore cannot be deleted.
   */
  setStatus(store: StoreAdminDto, status: StoreStatus, afterDelete = false): void {
    if (status === 'CLOSED' && !afterDelete) {
      const msg = this.translate.instant('admin.stores.closeConfirm', { name: store.name });
      if (!confirm(msg)) return;
    }
    this.busyId.set(store.id);
    this.clearCardError(store.id);
    this.api.updateStore(store.id, { status }).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.replace(updated);
        if (this.editingId() === store.id) this.editor()?.statusChanged(updated);
      },
      error: (err) => {
        this.busyId.set(null);
        this.setCardError(store.id, { text: storeErrorMessage(err, this.translate), offerClose: false });
      },
    });
  }

  remove(store: StoreAdminDto): void {
    const msg = this.translate.instant('admin.stores.deleteConfirm', { name: store.name });
    if (!confirm(msg)) return;
    this.busyId.set(store.id);
    this.clearCardError(store.id);
    this.api.deleteStore(store.id).subscribe({
      next: () => {
        this.busyId.set(null);
        if (this.editingId() === store.id) this.closeEditor();
        this.stores.update((list) => list.filter((s) => s.id !== store.id));
      },
      error: (err) => {
        this.busyId.set(null);
        const hasOrders = apiErrorCode(err) === 'STORE_HAS_ORDERS';
        this.setCardError(store.id, {
          text:
            hasOrders && store.status === 'CLOSED'
              ? this.translate.instant('admin.stores.errors.hasOrdersClosed')
              : storeErrorMessage(err, this.translate),
          offerClose: hasOrders && store.status !== 'CLOSED',
        });
      },
    });
  }

  statusBg(status: StoreStatus): string {
    if (status === 'OPEN') return '#7BC4A433';
    if (status === 'OVERLOADED') return '#E9A84B33';
    return '#D94B5E22';
  }

  statusColor(status: StoreStatus): string {
    if (status === 'OPEN') return '#3E8868';
    if (status === 'OVERLOADED') return '#8A6720';
    return '#8F2F3C';
  }

  private showBrand(brandId: string | null): void {
    this.editingId.set(null);
    this.cardErrors.set({});
    this.listError.set(null);
    this.loaded.set(false);
    if (!brandId) {
      this.stores.set([]);
      return;
    }
    this.fetch(brandId);
  }

  private fetch(brandId: string): void {
    // A slower answer for the previously selected brand must not overwrite this one.
    const request = ++this.listRequest;
    this.api.listStores(brandId).subscribe({
      next: (list) => {
        if (request !== this.listRequest) return;
        this.stores.set(list);
        this.listError.set(null);
        this.loaded.set(true);
      },
      error: (err) => {
        if (request !== this.listRequest) return;
        this.listError.set(storeErrorMessage(err, this.translate));
        this.loaded.set(true);
      },
    });
  }

  private resetCreateForm(): void {
    const currency = this.activeBrand.active()?.currency ?? 'MDL';
    this.createForm.reset({
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

  private replace(updated: StoreAdminDto): void {
    this.stores.update((list) => list.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
  }

  private setCardError(id: string, error: CardError): void {
    this.cardErrors.update((all) => ({ ...all, [id]: error }));
  }

  private clearCardError(id: string): void {
    if (!this.cardErrors()[id]) return;
    this.cardErrors.update((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }
}

/** Six decimals is ~10 cm — more is map-click noise. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
