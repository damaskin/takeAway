import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  AdminCatalogApi,
  type StoreAdminDto,
  type StoreWorkingHourDto,
  type UpdateStoreInput,
} from '../../core/catalog/admin-catalog.service';

type Tab = 'details' | 'hours';

/**
 * Inline editor for an existing Store. Fetches the full record (with
 * working hours) on init — the list endpoint only returns summary
 * fields, so editing needs a round-trip.
 */
@Component({
  selector: 'app-store-editor',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <div
      style="background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 16px"
    >
      <div class="flex" style="gap: 8px">
        <button
          type="button"
          (click)="tab.set('details')"
          [class.tab-active]="tab() === 'details'"
          class="tab"
          style="padding: 6px 14px; border-radius: 999px; font-family: var(--font-sans); font-size: 13px; cursor: pointer"
        >
          {{ 'admin.stores.editor.details' | translate }}
        </button>
        <button
          type="button"
          (click)="tab.set('hours')"
          [class.tab-active]="tab() === 'hours'"
          class="tab"
          style="padding: 6px 14px; border-radius: 999px; font-family: var(--font-sans); font-size: 13px; cursor: pointer"
        >
          {{ 'admin.stores.editor.hours' | translate }}
        </button>
      </div>

      @if (loading()) {
        <p style="color: var(--color-text-secondary)">{{ 'common.loading' | translate }}</p>
      } @else if (tab() === 'details') {
        <form [formGroup]="detailsForm" class="flex flex-col" style="gap: 12px">
          <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px">
            <label class="flex flex-col" style="gap: 4px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'admin.stores.editor.name' | translate
              }}</span>
              <input
                formControlName="name"
                type="text"
                style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; outline: none"
              />
            </label>
            <label class="flex flex-col" style="gap: 4px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'admin.stores.editor.status' | translate
              }}</span>
              <select
                formControlName="status"
                style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; outline: none"
              >
                <option value="OPEN">{{ 'admin.stores.status.OPEN' | translate }}</option>
                <option value="OVERLOADED">{{ 'admin.stores.status.OVERLOADED' | translate }}</option>
                <option value="CLOSED">{{ 'admin.stores.status.CLOSED' | translate }}</option>
              </select>
            </label>
          </div>

          <label class="flex flex-col" style="gap: 4px">
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
              'admin.stores.editor.address' | translate
            }}</span>
            <input
              formControlName="addressLine"
              type="text"
              style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; outline: none"
            />
          </label>

          <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px">
            <label class="flex flex-col" style="gap: 4px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'admin.stores.editor.city' | translate
              }}</span>
              <input
                formControlName="city"
                type="text"
                style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; outline: none"
              />
            </label>
            <label class="flex flex-col" style="gap: 4px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'admin.stores.editor.country' | translate
              }}</span>
              <input
                formControlName="country"
                type="text"
                maxlength="2"
                style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono); font-size: 14px; outline: none"
              />
            </label>
          </div>

          <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 12px">
            <label class="flex flex-col" style="gap: 4px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'admin.stores.editor.phone' | translate
              }}</span>
              <input
                formControlName="phone"
                type="tel"
                placeholder="+971501234567"
                style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono); font-size: 13px; outline: none"
              />
            </label>
            <label class="flex flex-col" style="gap: 4px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'admin.stores.editor.email' | translate
              }}</span>
              <input
                formControlName="email"
                type="email"
                autocapitalize="none"
                style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono); font-size: 13px; outline: none"
              />
            </label>
            <label class="flex flex-col" style="gap: 4px">
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                'admin.stores.editor.minOrder' | translate
              }}</span>
              <input
                formControlName="minOrderCents"
                type="number"
                min="0"
                style="height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono); font-size: 13px; outline: none"
              />
            </label>
          </div>
        </form>
      } @else if (tab() === 'hours') {
        <form [formGroup]="hoursForm" class="flex flex-col" style="gap: 8px">
          <div [formArrayName]="'days'" class="flex flex-col" style="gap: 6px">
            @for (day of hoursDays.controls; track $index; let i = $index) {
              <div [formGroupName]="i" class="flex items-center" style="gap: 12px">
                <span
                  style="width: 42px; font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-text-primary)"
                  >{{ weekdayLabel(i) | translate }}</span
                >
                <label class="flex items-center" style="gap: 6px">
                  <input formControlName="isClosed" type="checkbox" />
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                    'admin.stores.editor.closed' | translate
                  }}</span>
                </label>
                <input
                  formControlName="opens"
                  type="time"
                  [disabled]="day.get('isClosed')?.value"
                  style="height: 30px; padding: 0 8px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 6px; font-family: var(--font-mono); font-size: 13px"
                />
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">—</span>
                <input
                  formControlName="closes"
                  type="time"
                  [disabled]="day.get('isClosed')?.value"
                  style="height: 30px; padding: 0 8px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 6px; font-family: var(--font-mono); font-size: 13px"
                />
              </div>
            }
          </div>
        </form>
      }

      <div class="flex items-center" style="gap: 12px">
        <button
          type="button"
          (click)="save()"
          [disabled]="saving() || loading()"
          class="disabled:opacity-50"
          style="padding: 8px 16px; background: var(--color-caramel); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
        >
          {{ (saving() ? 'admin.stores.editor.saving' : 'common.save') | translate }}
        </button>
        <button
          type="button"
          (click)="closed.emit()"
          style="padding: 8px 16px; background: var(--color-latte); color: var(--color-espresso); border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
        >
          {{ 'common.cancel' | translate }}
        </button>
        @if (saved()) {
          <span style="color: var(--color-mint); font-family: var(--font-sans); font-size: 13px">{{
            'admin.stores.editor.saved' | translate
          }}</span>
        }
        @if (error()) {
          <span style="color: var(--color-berry); font-family: var(--font-sans); font-size: 13px">{{ error() }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .tab {
        background: var(--color-foam);
        color: var(--color-text-secondary);
        border: 1px solid var(--color-border);
      }
      .tab-active {
        background: var(--color-caramel);
        color: white;
        border-color: var(--color-caramel);
      }
    `,
  ],
})
export class StoreEditorComponent implements OnInit {
  @Input({ required: true }) storeId!: string;
  @Output() readonly saveCompleted = new EventEmitter<StoreAdminDto>();
  @Output() readonly closed = new EventEmitter<void>();

  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly tab = signal<Tab>('details');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  readonly detailsForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    addressLine: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    country: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(2)] }),
    phone: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    status: new FormControl<'OPEN' | 'CLOSED' | 'OVERLOADED'>('OPEN', { nonNullable: true }),
    minOrderCents: new FormControl(0, { nonNullable: true }),
  });

  readonly hoursForm = new FormGroup({
    days: new FormArray<
      FormGroup<{ isClosed: FormControl<boolean>; opens: FormControl<string>; closes: FormControl<string> }>
    >([]),
  });

  get hoursDays(): FormArray<
    FormGroup<{ isClosed: FormControl<boolean>; opens: FormControl<string>; closes: FormControl<string> }>
  > {
    return this.hoursForm.controls.days;
  }

  ngOnInit(): void {
    // 7 rows (Sun..Sat, matching JS getDay()).
    for (let i = 0; i < 7; i++) {
      this.hoursDays.push(
        new FormGroup({
          isClosed: new FormControl(false, { nonNullable: true }),
          opens: new FormControl('09:00', { nonNullable: true }),
          closes: new FormControl('21:00', { nonNullable: true }),
        }),
      );
    }

    this.api.getStore(this.storeId).subscribe({
      next: (s) => this.hydrate(s),
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  save(): void {
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    if (this.tab() === 'details') {
      const v = this.detailsForm.getRawValue();
      const payload: UpdateStoreInput = {
        name: v.name.trim(),
        addressLine: v.addressLine.trim(),
        city: v.city.trim(),
        country: v.country.trim().toUpperCase(),
        phone: v.phone.trim() || null,
        email: v.email.trim() || null,
        status: v.status,
        minOrderCents: Number(v.minOrderCents) || 0,
      };
      this.api.updateStore(this.storeId, payload).subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.saved.set(true);
          this.saveCompleted.emit(updated);
          setTimeout(() => this.saved.set(false), 2500);
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(this.extractMessage(err));
        },
      });
    } else {
      const hours: StoreWorkingHourDto[] = this.hoursDays.controls.map((day, weekday) => {
        const v = day.getRawValue();
        return {
          weekday,
          isClosed: v.isClosed,
          opensAt: timeToMinutes(v.opens),
          closesAt: timeToMinutes(v.closes),
        };
      });
      this.api.replaceWorkingHours(this.storeId, hours).subscribe({
        next: () => {
          this.saving.set(false);
          this.saved.set(true);
          setTimeout(() => this.saved.set(false), 2500);
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(this.extractMessage(err));
        },
      });
    }
  }

  weekdayLabel(i: number): string {
    return `admin.stores.editor.day.${i}`;
  }

  private hydrate(s: StoreAdminDto): void {
    this.detailsForm.patchValue({
      name: s.name,
      addressLine: s.addressLine ?? '',
      city: s.city,
      country: s.country,
      phone: s.phone ?? '',
      email: s.email ?? '',
      status: s.status,
      minOrderCents: s.minOrderCents ?? 0,
    });
    if (s.workingHours?.length) {
      for (const h of s.workingHours) {
        const day = this.hoursDays.at(h.weekday);
        if (day) {
          day.patchValue({
            isClosed: h.isClosed,
            opens: minutesToTime(h.opensAt),
            closes: minutesToTime(h.closesAt),
          });
        }
      }
    }
    this.loading.set(false);
  }

  private extractMessage(err: unknown): string {
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (Array.isArray(maybe.error?.message) && maybe.error.message.length) return maybe.error.message[0] as string;
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.genericError');
  }
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}
