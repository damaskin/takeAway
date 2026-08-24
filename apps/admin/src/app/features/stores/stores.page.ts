import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CreateStoreInput, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { StoreEditorComponent } from './store-editor.component';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'THB', 'IDR', 'MDL', 'RUP'] as const;

@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, StoreEditorComponent, LeafletMapComponent],
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
      <button
        type="button"
        (click)="toggleCreateForm()"
        style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
      >
        {{ (creatingOpen() ? 'common.close' : 'admin.stores.add') | translate }}
      </button>
    </div>

    <section style="padding: 24px; display: flex; flex-direction: column; gap: 16px">
      @if (creatingOpen()) {
        <form
          [formGroup]="createForm"
          (ngSubmit)="submitCreate()"
          class="grid"
          style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; padding: 18px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px"
        >
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.name' | translate
            }}</span>
            <input
              formControlName="name"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.slug' | translate
            }}</span>
            <input
              formControlName="slug"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono)"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.addressLine' | translate
            }}</span>
            <input
              formControlName="addressLine"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.city' | translate
            }}</span>
            <input
              formControlName="city"
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
              placeholder="US"
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
          </label>
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
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.timezone' | translate
            }}</span>
            <input
              formControlName="timezone"
              placeholder="UTC"
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <label style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.phone' | translate
            }}</span>
            <input
              formControlName="phone"
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
              style="height: 36px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 8px"
            />
          </label>
          <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.fields.pickOnMap' | translate
            }}</span>
            <div style="height: 240px; border-radius: 10px; overflow: hidden; border: 1px solid var(--color-border)">
              <lib-leaflet-map [pickable]="true" [markers]="pickerMarkers()" (markerMoved)="onPickerMoved($event)" />
            </div>
          </div>
          <div style="grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px">
            <button
              type="button"
              (click)="toggleCreateForm()"
              style="height: 36px; padding: 0 14px; color: var(--color-text-secondary)"
            >
              {{ 'common.cancel' | translate }}
            </button>
            <button
              type="submit"
              [disabled]="createForm.invalid || creating()"
              style="height: 36px; padding: 0 18px; background: var(--color-caramel); color: white; border-radius: 8px; font-family: var(--font-sans); font-weight: 600"
            >
              {{ (creating() ? 'common.loading' : 'admin.stores.create') | translate }}
            </button>
          </div>
          @if (createError()) {
            <p
              style="grid-column: 1 / -1; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
            >
              {{ createError() }}
            </p>
          }
        </form>
      }

      @if (stores().length === 0 && !error()) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'admin.stores.empty' | translate }}
        </p>
      }

      <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px">
        @for (s of stores(); track s.id) {
          <article
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 12px"
          >
            <header class="flex items-start justify-between" style="gap: 12px">
              <div class="flex flex-col" style="gap: 4px">
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
                style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                >{{ statusLabel(s.status) | translate }}</span
              >
            </header>

            <div class="flex items-center" style="gap: 12px">
              <span
                class="flex items-center"
                style="height: 24px; padding: 0 8px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-secondary)"
                >{{ s.currency }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                >{{ 'admin.stores.slugLabel' | translate }}: {{ s.slug }}</span
              >
            </div>

            <div class="flex" style="gap: 8px; margin-top: 4px">
              <button
                type="button"
                (click)="toggle(s.id, 'details')"
                class="flex-1"
                style="height: 36px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary); cursor: pointer"
              >
                {{ (editingId() === s.id ? 'common.close' : 'admin.stores.edit') | translate }}
              </button>
              <button
                type="button"
                (click)="toggle(s.id, 'hours')"
                class="flex-1"
                style="height: 36px; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; cursor: pointer"
              >
                {{ 'admin.stores.hours' | translate }}
              </button>
              <button
                type="button"
                (click)="remove(s)"
                [disabled]="deletingId() === s.id"
                style="height: 36px; padding: 0 12px; background: transparent; color: var(--color-berry); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500"
              >
                {{ (deletingId() === s.id ? 'common.loading' : 'admin.stores.delete') | translate }}
              </button>
            </div>

            @if (editingId() === s.id) {
              <app-store-editor [storeId]="s.id" (saveCompleted)="onSaved($event)" (closed)="closeEditor()" />
            }
          </article>
        }
      </div>

      @if (error()) {
        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{ error() }}</p>
      }
    </section>
  `,
})
export class StoresPage implements OnInit {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly currencies = CURRENCIES;
  readonly stores = signal<StoreAdminDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);

  readonly creatingOpen = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  readonly createForm = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1)],
    }),
    slug: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    addressLine: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    city: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    country: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(2)],
    }),
    currency: new FormControl<string>('USD', { nonNullable: true, validators: [Validators.required] }),
    latitude: new FormControl<number | null>(null, { validators: [Validators.required] }),
    longitude: new FormControl<number | null>(null, { validators: [Validators.required] }),
    timezone: new FormControl<string>('UTC', { nonNullable: true }),
    phone: new FormControl<string>('', { nonNullable: true }),
    email: new FormControl<string>('', { nonNullable: true }),
  });

  /** Marker for the create-form map picker — mirrors the lat/lng controls. */
  readonly pickerMarkers = signal<MapMarker[]>([]);

  constructor() {
    // Refetch the store list whenever the active brand changes (selector in
    // the top bar). Skip while no brand is resolved yet — loading state is
    // owned by ActiveBrandService.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) {
        this.stores.set([]);
        return;
      }
      this.api.listStores(brandId).subscribe({
        next: (list) => this.stores.set(list),
        error: (err) => this.error.set(extractMessage(err) ?? this.translate.instant('admin.stores.loadFailed')),
      });
    });

    // Keep the picker marker in sync when lat/lng are typed manually.
    this.createForm.valueChanges.subscribe((v) => {
      if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
        this.pickerMarkers.set([{ id: 'new', lat: v.latitude, lng: v.longitude, kind: 'store' }]);
      }
    });
  }

  onPickerMoved(p: LatLng): void {
    this.createForm.patchValue({ latitude: p.lat, longitude: p.lng });
  }

  ngOnInit(): void {
    // Brand list is normally loaded once by AdminLayoutPage; trigger here as
    // a safety net for direct navigation / hot-reload.
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();
  }

  toggleCreateForm(): void {
    this.creatingOpen.update((v) => !v);
    this.createError.set(null);
  }

  submitCreate(): void {
    const brand = this.activeBrand.active();
    if (!brand) {
      this.createError.set(this.translate.instant('admin.stores.noBrand'));
      return;
    }
    const v = this.createForm.getRawValue();
    if (v.latitude == null || v.longitude == null) return;
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
    this.creating.set(true);
    this.createError.set(null);
    this.api.createStore(payload).subscribe({
      next: (store) => {
        this.creating.set(false);
        this.creatingOpen.set(false);
        this.stores.update((list) => [store, ...list]);
        this.createForm.reset({
          name: '',
          slug: '',
          addressLine: '',
          city: '',
          country: '',
          currency: 'USD',
          latitude: null,
          longitude: null,
          timezone: 'UTC',
          phone: '',
          email: '',
        });
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }

  toggle(id: string, _tab: 'details' | 'hours'): void {
    this.editingId.set(this.editingId() === id ? null : id);
  }

  closeEditor(): void {
    this.editingId.set(null);
  }

  onSaved(updated: StoreAdminDto): void {
    this.stores.update((list) => list.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
  }

  remove(store: StoreAdminDto): void {
    const msg = this.translate.instant('admin.stores.deleteConfirm', { name: store.name });
    if (!confirm(msg)) return;
    this.deletingId.set(store.id);
    this.api.deleteStore(store.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.stores.update((list) => list.filter((s) => s.id !== store.id));
      },
      error: (err) => {
        this.deletingId.set(null);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }

  statusLabel(status: StoreAdminDto['status']): string {
    if (status === 'OPEN') return 'admin.stores.status.OPEN';
    if (status === 'OVERLOADED') return 'admin.stores.status.OVERLOADED';
    return 'admin.stores.status.CLOSED';
  }

  statusBg(status: StoreAdminDto['status']): string {
    if (status === 'OPEN') return '#7BC4A433';
    if (status === 'OVERLOADED') return '#E9A84B33';
    return '#D94B5E22';
  }

  statusColor(status: StoreAdminDto['status']): string {
    if (status === 'OPEN') return '#3E8868';
    if (status === 'OVERLOADED') return '#8A6720';
    return '#8F2F3C';
  }
}

function extractMessage(err: unknown): string | null {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return null;
}
