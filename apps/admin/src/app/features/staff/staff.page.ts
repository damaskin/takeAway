import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import {
  AddStaffRequest,
  BrandOwner,
  SetOwnerRequest,
  StaffRoster,
  StaffRole,
  StaffService,
} from '../../core/staff/staff.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';

@Component({
  selector: 'app-admin-staff',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, TranslatePipe],
  template: `
    <section style="padding: 32px; max-width: 980px">
      <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0 0 8px">
        {{ 'admin.staff.title' | translate }}
      </h1>
      <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 28px">
        {{ 'admin.staff.subtitle' | translate }}
      </p>

      <!-- ── Brand Owner (SUPER_ADMIN only) ─────────────────────────────── -->
      @if (isSuperAdmin()) {
        <div
          style="background: var(--color-foam); border-radius: var(--radius-card); padding: 20px; box-shadow: var(--shadow-soft); margin-bottom: 28px"
        >
          <h2 style="font-family: var(--font-display); font-size: 18px; color: var(--color-espresso); margin: 0 0 4px">
            {{ 'admin.staff.owner.title' | translate }}
          </h2>
          <p
            style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0 0 16px"
          >
            {{ 'admin.staff.owner.subtitle' | translate }}
          </p>

          @if (loadingOwner()) {
            <p style="color: var(--color-text-secondary); font-family: var(--font-sans); font-size: 14px">
              {{ 'common.loading' | translate }}
            </p>
          } @else if (owner()) {
            <div
              class="flex items-center"
              style="gap: 12px; padding: 10px 12px; background: var(--color-cream); border-radius: 10px; margin-bottom: 12px"
            >
              <div class="flex-1">
                <p
                  style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); margin: 0; font-weight: 600"
                >
                  {{ owner()!.name || owner()!.email }}
                </p>
                <p
                  style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-tertiary); margin: 2px 0 0"
                >
                  {{ owner()!.email }} · Brand Admin
                </p>
              </div>
              <button
                type="button"
                (click)="showOwnerForm.set(!showOwnerForm())"
                style="padding: 6px 12px; background: transparent; color: var(--color-caramel); border: 1px solid var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 12px; font-weight: 600; cursor: pointer"
              >
                {{ 'admin.staff.owner.change' | translate }}
              </button>
            </div>
          } @else {
            <p
              style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 12px"
            >
              {{ 'admin.staff.owner.none' | translate }}
            </p>
          }

          @if (!owner() || showOwnerForm()) {
            <form
              [formGroup]="ownerForm"
              (ngSubmit)="submitOwner()"
              class="flex flex-col"
              style="gap: 12px; padding-top: 4px"
            >
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
              <label class="flex flex-col" style="gap: 4px">
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">
                  {{ 'admin.staff.owner.tempPasswordHint' | translate }}
                </span>
                <input
                  formControlName="tempPassword"
                  type="text"
                  autocomplete="off"
                  [placeholder]="'admin.staff.owner.tempPasswordPlaceholder' | translate"
                  style="height: 38px; padding: 0 12px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono); font-size: 13px; outline: none"
                />
              </label>
              <div class="flex items-center" style="gap: 12px">
                <button
                  type="submit"
                  [disabled]="ownerForm.invalid || savingOwner()"
                  class="disabled:opacity-50"
                  style="padding: 8px 16px; background: var(--color-caramel); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
                >
                  {{ (savingOwner() ? 'admin.staff.saving' : 'admin.staff.owner.cta') | translate }}
                </button>
                @if (savedOwner()) {
                  <span style="color: var(--color-mint); font-family: var(--font-sans); font-size: 13px">{{
                    'admin.staff.saved' | translate
                  }}</span>
                }
                @if (ownerError()) {
                  <span style="color: var(--color-berry); font-family: var(--font-sans); font-size: 13px">{{
                    ownerError()
                  }}</span>
                }
              </div>
            </form>
          }
        </div>
      }

      <!-- ── Store tabs ────────────────────────────────────────────────────── -->
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
                    class="flex flex-col"
                    style="padding: 10px 12px; background: var(--color-cream); border-radius: 10px; gap: 8px"
                  >
                    <div class="flex items-center" style="gap: 12px">
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
                        (click)="toggleRoleEdit(m)"
                        style="padding: 6px 12px; background: transparent; color: var(--color-text-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 12px; font-weight: 600; cursor: pointer"
                      >
                        {{ 'admin.staff.changeRole' | translate }}
                      </button>
                      <button
                        type="button"
                        (click)="remove(m)"
                        style="padding: 6px 12px; background: transparent; color: var(--color-berry); border: 1px solid var(--color-berry); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 12px; font-weight: 600; cursor: pointer"
                      >
                        {{ 'admin.staff.remove' | translate }}
                      </button>
                    </div>

                    @if (editingRoleFor() === m.userId) {
                      <div class="flex items-center" style="gap: 8px; padding-top: 4px">
                        <select
                          [value]="pendingRole()"
                          (change)="pendingRole.set($any($event.target).value)"
                          style="height: 34px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 13px; outline: none"
                        >
                          <option value="STORE_MANAGER">{{ 'admin.staff.role.STORE_MANAGER' | translate }}</option>
                          <option value="STAFF">{{ 'admin.staff.role.STAFF' | translate }}</option>
                          <option value="MENU_EDITOR">{{ 'admin.staff.role.MENU_EDITOR' | translate }}</option>
                        </select>
                        <button
                          type="button"
                          (click)="confirmRoleChange(m)"
                          [disabled]="savingRole()"
                          class="disabled:opacity-50"
                          style="padding: 6px 14px; background: var(--color-caramel); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 12px; font-weight: 600; cursor: pointer"
                        >
                          {{ (savingRole() ? 'admin.staff.saving' : 'admin.staff.saveRole') | translate }}
                        </button>
                        <button
                          type="button"
                          (click)="editingRoleFor.set(null)"
                          style="padding: 6px 12px; background: transparent; color: var(--color-text-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 12px; cursor: pointer"
                        >
                          {{ 'common.cancel' | translate }}
                        </button>
                        @if (roleError()) {
                          <span style="color: var(--color-berry); font-family: var(--font-sans); font-size: 12px">{{
                            roleError()
                          }}</span>
                        }
                      </div>
                    }
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
                  <option value="MENU_EDITOR">{{ 'admin.staff.role.MENU_EDITOR' | translate }}</option>
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
  private readonly authStore = inject(AuthStore);
  private readonly brandCtx = inject(ActiveBrandService);

  readonly isSuperAdmin = computed(() => this.authStore.user()?.role === 'SUPER_ADMIN');

  // ── Stores & roster ────────────────────────────────────────────────────────
  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loadingStores = signal(true);
  readonly selectedStoreId = signal<string | null>(null);
  readonly roster = signal<StaffRoster[]>([]);
  readonly loadingRoster = signal(false);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  // ── Inline role editing ────────────────────────────────────────────────────
  readonly editingRoleFor = signal<string | null>(null);
  readonly pendingRole = signal<StaffRole>('STAFF');
  readonly savingRole = signal(false);
  readonly roleError = signal<string | null>(null);

  // ── Brand owner (SUPER_ADMIN only) ─────────────────────────────────────────
  readonly owner = signal<BrandOwner | null>(null);
  readonly loadingOwner = signal(false);
  readonly showOwnerForm = signal(false);
  readonly savingOwner = signal(false);
  readonly savedOwner = signal(false);
  readonly ownerError = signal<string | null>(null);

  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    name: new FormControl('', { nonNullable: true }),
    role: new FormControl<StaffRole>('STAFF', { nonNullable: true }),
    tempPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
    }),
  });

  readonly ownerForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    name: new FormControl('', { nonNullable: true }),
    tempPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.minLength(8), Validators.maxLength(128)],
    }),
  });

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list);
        this.loadingStores.set(false);
        const first = list[0];
        if (first) this.selectStore(first.id);
      },
      error: () => this.loadingStores.set(false),
    });

    if (this.isSuperAdmin()) {
      this.loadOwner();
    }
  }

  selectStore(id: string): void {
    this.selectedStoreId.set(id);
    this.editingRoleFor.set(null);
    this.loadRoster(id);
  }

  // ── Roster add ─────────────────────────────────────────────────────────────
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

  // ── Roster remove ──────────────────────────────────────────────────────────
  remove(m: StaffRoster): void {
    const storeId = this.selectedStoreId();
    if (!storeId) return;
    if (!window.confirm(this.translate.instant('admin.staff.confirmRemove', { name: m.name || m.email }))) return;
    this.staffApi.remove(storeId, m.userId).subscribe({
      next: () => {
        this.roster.update((list) => list.filter((r) => r.userId !== m.userId));
        if (this.editingRoleFor() === m.userId) this.editingRoleFor.set(null);
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  // ── Inline role change ─────────────────────────────────────────────────────
  toggleRoleEdit(m: StaffRoster): void {
    if (this.editingRoleFor() === m.userId) {
      this.editingRoleFor.set(null);
      return;
    }
    this.pendingRole.set(m.role);
    this.roleError.set(null);
    this.editingRoleFor.set(m.userId);
  }

  confirmRoleChange(m: StaffRoster): void {
    const storeId = this.selectedStoreId();
    if (!storeId) return;
    const role = this.pendingRole();
    if (role === m.role) {
      this.editingRoleFor.set(null);
      return;
    }
    this.savingRole.set(true);
    this.roleError.set(null);
    this.staffApi.changeRole(storeId, m.userId, role).subscribe({
      next: (updated) => {
        this.roster.update((list) => list.map((r) => (r.userId === updated.userId ? updated : r)));
        this.savingRole.set(false);
        this.editingRoleFor.set(null);
      },
      error: (err) => {
        this.savingRole.set(false);
        this.roleError.set(this.extractMessage(err));
      },
    });
  }

  // ── Brand owner (SUPER_ADMIN) ──────────────────────────────────────────────
  submitOwner(): void {
    const brandId = this.brandCtx.activeId();
    if (!brandId || this.ownerForm.invalid) return;
    this.savingOwner.set(true);
    this.savedOwner.set(false);
    this.ownerError.set(null);
    const v = this.ownerForm.getRawValue();
    const body: SetOwnerRequest = { email: v.email.trim().toLowerCase() };
    if (v.name.trim()) body.name = v.name.trim();
    if (v.tempPassword.trim()) body.tempPassword = v.tempPassword.trim();
    this.staffApi.setOwner(brandId, body).subscribe({
      next: (o) => {
        this.owner.set(o);
        this.savingOwner.set(false);
        this.savedOwner.set(true);
        this.showOwnerForm.set(false);
        this.ownerForm.reset();
        setTimeout(() => this.savedOwner.set(false), 3000);
      },
      error: (err) => {
        this.savingOwner.set(false);
        this.ownerError.set(this.extractMessage(err));
      },
    });
  }

  private loadOwner(): void {
    const brandId = this.brandCtx.activeId();
    if (!brandId) return;
    this.loadingOwner.set(true);
    this.staffApi.getOwner(brandId).subscribe({
      next: (o) => {
        this.owner.set(o);
        this.loadingOwner.set(false);
        if (!o) this.showOwnerForm.set(true);
      },
      error: () => this.loadingOwner.set(false),
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
