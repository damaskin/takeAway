import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';
import { BrandOwner, StaffRole, StaffRoster, StaffService } from '../../core/staff/staff.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';

@Component({
  selector: 'app-admin-staff',
  standalone: true,
  imports: [DatePipe, RouterLink, TranslatePipe],
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
          } @else {
            <div class="flex items-center flex-wrap" style="gap: 12px">
              @if (owner(); as o) {
                <div
                  class="flex-1"
                  style="min-width: 200px; padding: 10px 12px; background: var(--color-cream); border-radius: 10px"
                >
                  <p
                    style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); margin: 0; font-weight: 600"
                  >
                    {{ o.name || o.email }}
                  </p>
                  <p
                    style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-tertiary); margin: 2px 0 0; word-break: break-all"
                  >
                    {{ o.email }}
                  </p>
                </div>
              } @else {
                <p
                  class="flex-1"
                  style="min-width: 200px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0"
                >
                  {{ 'admin.staff.owner.none' | translate }}
                </p>
              }
              <a
                routerLink="/staff/owner"
                class="flex items-center"
                style="height: 38px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap"
              >
                {{ (owner() ? 'admin.staff.owner.change' : 'admin.staff.owner.cta') | translate }}
              </a>
            </div>
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

      @if (selectedStoreId(); as storeId) {
        <div class="flex flex-col" style="gap: 20px">
          <!-- Roster list -->
          <div
            style="background: var(--color-foam); border-radius: var(--radius-card); padding: 20px; box-shadow: var(--shadow-soft)"
          >
            <div class="flex items-center justify-between flex-wrap" style="gap: 12px; margin: 0 0 12px">
              <h2 style="font-family: var(--font-display); font-size: 18px; color: var(--color-espresso); margin: 0">
                {{ 'admin.staff.roster' | translate }}
              </h2>
              <a
                [routerLink]="['/staff', 'add']"
                [queryParams]="{ storeId }"
                class="flex items-center"
                style="height: 34px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap"
              >
                {{ 'admin.staff.addCta' | translate }}
              </a>
            </div>
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
        </div>

        @if (error(); as message) {
          <p
            role="alert"
            style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 16px 0 0"
          >
            {{ message }}
          </p>
        }
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
  readonly error = signal<string | null>(null);

  /** Set when coming back from the invite form, so the same store stays open. */
  readonly store = input<string | undefined>();

  // ── Inline role editing ────────────────────────────────────────────────────
  readonly editingRoleFor = signal<string | null>(null);
  readonly pendingRole = signal<StaffRole>('STAFF');
  readonly savingRole = signal(false);
  readonly roleError = signal<string | null>(null);

  // ── Brand owner (SUPER_ADMIN only) ─────────────────────────────────────────
  readonly owner = signal<BrandOwner | null>(null);
  readonly loadingOwner = signal(false);

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list);
        this.loadingStores.set(false);
        const wanted = list.find((s) => s.id === this.store()) ?? list[0];
        if (wanted) this.selectStore(wanted.id);
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
      error: (err) => this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError')),
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
        this.roleError.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
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
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }
}
