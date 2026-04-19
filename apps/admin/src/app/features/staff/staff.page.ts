import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { AddStaffRequest, StaffRoster, StaffService } from '../../core/staff/staff.service';

/**
 * Staff roster per store. BRAND_ADMIN picks a store, sees the
 * STORE_MANAGER / STAFF currently assigned (via the UserStore pivot),
 * and can invite new staff by email + temp password.
 *
 * The invited staff signs in at /admin/login with that temp password
 * and is expected to change it via /forgot-password — there's no
 * in-app forced rotation yet.
 */
@Component({
  selector: 'app-admin-staff',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, TranslatePipe],
  template: `
    <section style="padding: 32px; max-width: 980px">
      <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0 0 8px">
        {{ 'admin.staff.title' | translate }}
      </h1>
      <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 20px">
        {{ 'admin.staff.subtitle' | translate }}
      </p>

      @if (stores().length > 0) {
        <div class="flex flex-wrap" style="gap: 8px; margin-bottom: 20px">
          @for (s of stores(); track s.id) {
            <button
              type="button"
              class="tab"
              [class.tab-active]="selectedStoreId() === s.id"
              (click)="selectStore(s.id)"
              style="padding: 6px 14px; border-radius: 999px; border: 1px solid var(--color-border); font-family: var(--font-sans); font-size: 13px; cursor: pointer"
            >
              {{ s.name }}
            </button>
          }
        </div>
      } @else if (loadingStores()) {
        <p style="color: var(--color-text-secondary)">{{ 'common.loading' | translate }}</p>
      } @else {
        <p style="color: var(--color-text-secondary)">{{ 'admin.staff.noStores' | translate }}</p>
      }

      @if (selectedStoreId()) {
        <div class="flex flex-col" style="gap: 20px">
          <!-- Roster list -->
          <div
            style="background: var(--color-foam); border-radius: var(--radius-card); padding: 20px; box-shadow: var(--shadow-soft)"
          >
            <h2
              style="font-family: var(--font-display); font-size: 18px; color: var(--color-espresso); margin: 0 0 12px"
            >
              {{ 'admin.staff.roster' | translate }}
            </h2>
            @if (loadingRoster()) {
              <p style="color: var(--color-text-secondary)">{{ 'common.loading' | translate }}</p>
            } @else if (roster().length === 0) {
              <p style="color: var(--color-text-secondary); font-family: var(--font-sans); font-size: 14px">
                {{ 'admin.staff.empty' | translate }}
              </p>
            } @else {
              <ul class="flex flex-col" style="gap: 8px; list-style: none; padding: 0; margin: 0">
                @for (m of roster(); track m.userId) {
                  <li
                    class="flex items-center"
                    style="gap: 12px; padding: 10px 12px; background: var(--color-cream); border-radius: 10px"
                  >
                    <div class="flex-1">
                      <p
                        style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); margin: 0; font-weight: 600"
                      >
                        {{ m.name || m.email }}
                      </p>
                      <p
                        style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-tertiary); margin: 2px 0 0"
                      >
                        {{ m.email }} · {{ 'admin.staff.role.' + m.role | translate }} ·
                        {{ m.addedAt | date: 'MMM d, y' }}
                      </p>
                    </div>
                    <button
                      type="button"
                      (click)="remove(m)"
                      style="padding: 6px 12px; background: transparent; color: var(--color-berry); border: 1px solid var(--color-berry); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 12px; font-weight: 600; cursor: pointer"
                    >
                      {{ 'admin.staff.remove' | translate }}
                    </button>
                  </li>
                }
              </ul>
            }
          </div>

          <!-- Add form -->
          <form
            [formGroup]="form"
            (ngSubmit)="submit()"
            class="flex flex-col"
            style="gap: 12px; background: var(--color-foam); border-radius: var(--radius-card); padding: 20px; box-shadow: var(--shadow-soft)"
          >
            <h2 style="font-family: var(--font-display); font-size: 18px; color: var(--color-espresso); margin: 0">
              {{ 'admin.staff.addTitle' | translate }}
            </h2>

            <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px">
              <label class="flex flex-col" style="gap: 4px">
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                  'admin.staff.email' | translate
                }}</span>
                <input
                  formControlName="email"
                  type="email"
                  autocapitalize="none"
                  spellcheck="false"
                  style="height: 38px; padding: 0 12px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; outline: none"
                />
              </label>
              <label class="flex flex-col" style="gap: 4px">
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                  'admin.staff.name' | translate
                }}</span>
                <input
                  formControlName="name"
                  type="text"
                  autocomplete="name"
                  style="height: 38px; padding: 0 12px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; outline: none"
                />
              </label>
            </div>

            <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px">
              <label class="flex flex-col" style="gap: 4px">
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                  'admin.staff.roleLabel' | translate
                }}</span>
                <select
                  formControlName="role"
                  style="height: 38px; padding: 0 12px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; outline: none"
                >
                  <option value="STORE_MANAGER">{{ 'admin.staff.role.STORE_MANAGER' | translate }}</option>
                  <option value="STAFF">{{ 'admin.staff.role.STAFF' | translate }}</option>
                </select>
              </label>
              <label class="flex flex-col" style="gap: 4px">
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                  'admin.staff.tempPassword' | translate
                }}</span>
                <input
                  formControlName="tempPassword"
                  type="text"
                  autocomplete="off"
                  style="height: 38px; padding: 0 12px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono); font-size: 13px; outline: none"
                />
              </label>
            </div>

            <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
              {{ 'admin.staff.tempPasswordHint' | translate }}
            </p>

            <div class="flex items-center" style="gap: 12px">
              <button
                type="submit"
                [disabled]="form.invalid || saving()"
                class="disabled:opacity-50"
                style="padding: 8px 16px; background: var(--color-caramel); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
              >
                {{ (saving() ? 'admin.staff.saving' : 'admin.staff.addCta') | translate }}
              </button>
              @if (saved()) {
                <span style="color: var(--color-mint); font-family: var(--font-sans); font-size: 13px">{{
                  'admin.staff.saved' | translate
                }}</span>
              }
              @if (error()) {
                <span style="color: var(--color-berry); font-family: var(--font-sans); font-size: 13px">{{
                  error()
                }}</span>
              }
            </div>
          </form>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .tab {
        background: var(--color-foam);
        color: var(--color-text-secondary);
      }
      .tab-active {
        background: var(--color-caramel);
        color: white;
        border-color: var(--color-caramel);
      }
    `,
  ],
})
export class AdminStaffPage implements OnInit {
  private readonly catalog = inject(AdminCatalogApi);
  private readonly staffApi = inject(StaffService);
  private readonly translate = inject(TranslateService);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loadingStores = signal(true);
  readonly selectedStoreId = signal<string | null>(null);
  readonly roster = signal<StaffRoster[]>([]);
  readonly loadingRoster = signal(false);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    name: new FormControl('', { nonNullable: true }),
    role: new FormControl<'STORE_MANAGER' | 'STAFF'>('STAFF', { nonNullable: true }),
    tempPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
    }),
  });

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list);
        this.loadingStores.set(false);
        if (list.length > 0) this.selectStore(list[0].id);
      },
      error: () => this.loadingStores.set(false),
    });
  }

  selectStore(id: string): void {
    this.selectedStoreId.set(id);
    this.loadRoster(id);
  }

  submit(): void {
    const storeId = this.selectedStoreId();
    if (!storeId || this.form.invalid) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    const v = this.form.getRawValue();
    const body: AddStaffRequest = {
      email: v.email.trim().toLowerCase(),
      role: v.role,
      tempPassword: v.tempPassword,
    };
    if (v.name.trim()) body.name = v.name.trim();
    this.staffApi.add(storeId, body).subscribe({
      next: (row) => {
        this.roster.update((list) => [row, ...list.filter((r) => r.userId !== row.userId)]);
        this.saving.set(false);
        this.saved.set(true);
        this.form.reset({ role: 'STAFF' } as never);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  remove(m: StaffRoster): void {
    const storeId = this.selectedStoreId();
    if (!storeId) return;
    if (!window.confirm(this.translate.instant('admin.staff.confirmRemove', { name: m.name || m.email }))) return;
    this.staffApi.remove(storeId, m.userId).subscribe({
      next: () => {
        this.roster.update((list) => list.filter((r) => r.userId !== m.userId));
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  private loadRoster(storeId: string): void {
    this.loadingRoster.set(true);
    this.staffApi.list(storeId).subscribe({
      next: (list) => {
        this.roster.set(list);
        this.loadingRoster.set(false);
      },
      error: (err) => {
        this.loadingRoster.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  private extractMessage(err: unknown): string {
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (Array.isArray(maybe.error?.message) && maybe.error.message.length) return maybe.error.message[0] as string;
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.genericError');
  }
}
