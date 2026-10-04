import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { BrandOwner, StaffMember, StaffRole, StaffService } from '../../core/staff/staff.service';
import { staffErrorMessage } from './staff-errors';

const ROLES: StaffRole[] = ['STORE_MANAGER', 'STAFF', 'MENU_EDITOR'];

/**
 * The team, one row per person: role, contact, the stores they work at and
 * whether they have a kitchen PIN. People used to be listed per store, so
 * someone working two cafés appeared twice and was added store by store;
 * now a person is opened once and their stores are ticked there.
 */
@Component({
  selector: 'app-admin-staff',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section style="padding: clamp(16px, 3vw, 32px); max-width: 980px">
      <div class="flex items-start justify-between flex-wrap" style="gap: 12px; margin: 0 0 20px">
        <div style="min-width: 0; flex: 1 1 320px">
          <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0 0 8px">
            {{ 'admin.staff.title' | translate }}
          </h1>
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.staff.subtitle' | translate }}
          </p>
        </div>
        @if (stores().length > 0) {
          <a
            [routerLink]="['/staff', 'add']"
            [queryParams]="storeFilter() ? { storeId: storeFilter() } : {}"
            class="flex items-center"
            style="height: 40px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap"
          >
            {{ 'admin.staff.addCta' | translate }}
          </a>
        }
      </div>

      <!-- ── Brand Owner (SUPER_ADMIN only) ─────────────────────────────── -->
      @if (isSuperAdmin()) {
        <div
          style="background: var(--color-foam); border-radius: var(--radius-card); padding: 20px; box-shadow: var(--shadow-soft); margin-bottom: 24px"
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

      @if (loadingStores()) {
        <p class="muted">{{ 'common.loading' | translate }}</p>
      } @else if (stores().length === 0) {
        <p class="muted">{{ 'admin.staff.noStores' | translate }}</p>
      } @else {
        <!-- ── Filters ───────────────────────────────────────────────────── -->
        <div class="filters" role="search">
          <label class="field filter-search">
            <span class="field-label">{{ 'admin.staff.filters.search' | translate }}</span>
            <input
              type="search"
              class="field-input"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
              [placeholder]="'admin.staff.filters.searchPlaceholder' | translate"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.staff.filters.store' | translate }}</span>
            <select class="field-input" [value]="storeFilter()" (change)="storeFilter.set($any($event.target).value)">
              <option value="">{{ 'admin.staff.filters.allStores' | translate }}</option>
              @for (s of stores(); track s.id) {
                <option [value]="s.id" [selected]="s.id === storeFilter()">{{ s.name }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.staff.roleLabel' | translate }}</span>
            <select class="field-input" [value]="roleFilter()" (change)="roleFilter.set($any($event.target).value)">
              <option value="">{{ 'admin.staff.filters.allRoles' | translate }}</option>
              @for (r of roles; track r) {
                <option [value]="r">{{ 'admin.staff.role.' + r | translate }}</option>
              }
            </select>
          </label>
        </div>

        <!-- ── People ────────────────────────────────────────────────────── -->
        @if (loadingTeam()) {
          <p class="muted">{{ 'common.loading' | translate }}</p>
        } @else if (error(); as message) {
          <div class="flex items-center flex-wrap" style="gap: 10px">
            <p role="alert" class="error">{{ message }}</p>
            <button type="button" class="retry" (click)="reload()">{{ 'common.retry' | translate }}</button>
          </div>
        } @else if (team().length === 0) {
          <p class="muted">{{ 'admin.staff.empty' | translate }}</p>
        } @else if (visible().length === 0) {
          <p class="muted">{{ 'admin.staff.filters.nothing' | translate }}</p>
        } @else {
          <p class="count">{{ 'admin.staff.count' | translate: { count: visible().length } }}</p>
          <ul class="people">
            @for (m of visible(); track m.userId) {
              <li>
                <a [routerLink]="['/staff', m.userId]" class="person">
                  <div class="person-head">
                    <span class="person-name">{{ m.name || m.email || m.phone }}</span>
                    <span class="badge badge-role">{{ 'admin.staff.role.' + m.role | translate }}</span>
                    @if (m.blocked) {
                      <span class="badge badge-blocked">{{ 'admin.staff.blocked' | translate }}</span>
                    }
                  </div>
                  <p class="person-contact">
                    @if (m.email) {
                      <span>{{ m.email }}</span>
                    }
                    @if (m.phone) {
                      <span>{{ m.phone }}</span>
                    }
                  </p>
                  <div class="chips">
                    @for (s of m.stores; track s.id) {
                      <span class="chip">{{ s.name }}</span>
                    }
                    @if (m.role !== 'MENU_EDITOR') {
                      <span class="chip" [class.chip-pin]="m.hasKdsPin" [class.chip-nopin]="!m.hasKdsPin">
                        {{
                          m.hasKdsPin
                            ? ('admin.staff.pinAt' | translate: { store: pinStoreName(m) })
                            : ('admin.staff.noPin' | translate)
                        }}
                      </span>
                    }
                  </div>
                </a>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styles: [
    `
      .muted {
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-text-secondary);
        margin: 0;
      }
      .error {
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-berry);
        margin: 0;
      }
      .retry {
        height: 32px;
        padding: 0 12px;
        background: var(--color-latte);
        color: var(--color-espresso);
        border: 0;
        border-radius: 8px;
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .filters {
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);
        margin-bottom: 16px;
      }
      @media (max-width: 720px) {
        .filters {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
        .filter-search {
          grid-column: 1 / -1;
        }
      }
      .count {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
        margin: 0 0 8px;
      }
      .people {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .person {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 14px 16px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
        text-decoration: none;
        color: inherit;
      }
      .person:hover,
      .person:focus-visible {
        border-color: var(--color-caramel);
      }
      .person-head {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }
      .person-name {
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .person-contact {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        margin: 0;
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--color-text-tertiary);
        overflow-wrap: anywhere;
      }
      .badge {
        padding: 2px 8px;
        border-radius: 999px;
        font-family: var(--font-sans);
        font-size: 11px;
        font-weight: 700;
      }
      .badge-role {
        background: var(--color-latte);
        color: var(--color-espresso);
      }
      .badge-blocked {
        background: transparent;
        color: var(--color-berry);
        border: 1px solid var(--color-berry);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .chip {
        padding: 3px 10px;
        border-radius: 999px;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .chip-pin {
        background: #7bc4a433;
        border-color: transparent;
        color: #3e8868;
        font-weight: 600;
      }
      .chip-nopin {
        border-style: dashed;
        color: var(--color-text-tertiary);
      }
    `,
  ],
})
export class AdminStaffPage {
  private readonly catalog = inject(AdminCatalogApi);
  private readonly staffApi = inject(StaffService);
  private readonly translate = inject(TranslateService);
  private readonly authStore = inject(AuthStore);
  private readonly brandCtx = inject(ActiveBrandService);

  readonly isSuperAdmin = computed(() => this.authStore.user()?.role === 'SUPER_ADMIN');
  readonly roles = ROLES;

  /** Set when coming back from the invite form, so the same store stays picked. */
  readonly store = input<string | undefined>();

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loadingStores = signal(true);
  readonly team = signal<StaffMember[]>([]);
  readonly loadingTeam = signal(false);
  readonly error = signal<string | null>(null);

  readonly query = signal('');
  readonly storeFilter = signal('');
  readonly roleFilter = signal<StaffRole | ''>('');

  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const store = this.storeFilter();
    const role = this.roleFilter();
    return this.team().filter((m) => {
      if (store && !m.stores.some((s) => s.id === store)) return false;
      if (role && m.role !== role) return false;
      if (!q) return true;
      return [m.name, m.email, m.phone].some((v) => v?.toLowerCase().includes(q));
    });
  });

  readonly owner = signal<BrandOwner | null>(null);
  readonly loadingOwner = signal(false);

  constructor() {
    effect(() => {
      const preset = this.store();
      if (preset) untracked(() => this.storeFilter.set(preset));
    });
    // The team belongs to the brand picked in the header and follows it.
    effect(() => {
      const brandId = this.brandCtx.activeId();
      untracked(() => {
        this.loadStores(brandId);
        this.loadTeam(brandId);
        if (this.isSuperAdmin()) this.loadOwner(brandId);
      });
    });
  }

  reload(): void {
    this.loadTeam(this.brandCtx.activeId());
  }

  pinStoreName(m: StaffMember): string {
    return m.stores.find((s) => s.id === m.kdsPinStoreId)?.name ?? '';
  }

  private loadStores(brandId: string | null): void {
    this.loadingStores.set(true);
    this.catalog.listStores(brandId ?? undefined).subscribe({
      next: (list) => {
        this.stores.set(list);
        this.loadingStores.set(false);
        if (this.storeFilter() && !list.some((s) => s.id === this.storeFilter())) this.storeFilter.set('');
      },
      error: (err) => {
        this.loadingStores.set(false);
        this.error.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  private loadTeam(brandId: string | null): void {
    this.loadingTeam.set(true);
    this.error.set(null);
    this.staffApi.listMembers(brandId).subscribe({
      next: (list) => {
        this.team.set(list);
        this.loadingTeam.set(false);
      },
      error: (err) => {
        this.loadingTeam.set(false);
        this.error.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  private loadOwner(brandId: string | null): void {
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
}
