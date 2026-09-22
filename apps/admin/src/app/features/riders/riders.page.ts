import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { AdminRidersApi, type RiderRosterEntryDto } from '../../core/riders/admin-riders.service';

/**
 * Admin — rider roster management.
 *
 * Lets a BRAND_ADMIN / SUPER_ADMIN pick a store from the dropdown and
 * manage the `UserStore` pivot for users with `role = RIDER`:
 *   - Add by phone (E.164). Creates a RIDER user if none exists; promotes
 *     an existing CUSTOMER. Refuses to downgrade other staff roles.
 *   - Remove from the store's roster (doesn't revoke the RIDER role).
 */
@Component({
  selector: 'app-admin-riders',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <div
      class="flex items-center flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.riders.title' | translate }}
      </h1>

      <select
        [value]="selectedStoreId() ?? ''"
        (change)="selectStore($any($event.target).value)"
        style="height: 36px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-foam); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)"
      >
        <option value="" disabled>{{ 'admin.riders.pickStore' | translate }}</option>
        @for (s of stores(); track s.id) {
          <option [value]="s.id">{{ s.name }} · {{ s.city }}</option>
        }
      </select>

      @if (selectedStoreId(); as storeId) {
        <a
          [routerLink]="['/riders', 'add']"
          [queryParams]="{ storeId }"
          class="flex items-center"
          style="height: 36px; padding: 0 16px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap"
        >
          {{ 'admin.riders.addCta' | translate }}
        </a>
      }
    </div>

    <section
      style="padding: clamp(16px, 3vw, 24px); display: flex; flex-direction: column; gap: 20px; max-width: 860px"
    >
      @if (!selectedStoreId()) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
          {{ 'admin.riders.selectStoreHint' | translate }}
        </p>
      } @else {
        <!-- Roster -->
        <div
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; overflow: hidden"
        >
          <div
            class="flex items-center"
            style="padding: 12px 16px; border-bottom: 1px solid var(--color-border-light); gap: 10px; font-family: var(--font-sans); font-size: 12px; font-weight: 700; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px"
          >
            <span style="flex: 1 1 200px">{{ 'admin.riders.columnPhone' | translate }}</span>
            <span style="flex: 1 1 160px">{{ 'admin.riders.columnName' | translate }}</span>
            <span style="flex: 0 0 140px">{{ 'admin.riders.columnAdded' | translate }}</span>
            <span style="flex: 0 0 100px; text-align: right"></span>
          </div>

          @if (loading()) {
            <p
              style="padding: 24px 16px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
            >
              {{ 'common.loading' | translate }}
            </p>
          } @else if (riders().length === 0) {
            <p
              style="padding: 24px 16px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
            >
              {{ 'admin.riders.empty' | translate }}
            </p>
          } @else {
            @for (r of riders(); track r.userId) {
              <div
                class="flex items-center flex-wrap"
                style="padding: 12px 16px; gap: 10px; border-top: 1px solid var(--color-border-light); font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
              >
                <span class="flex items-center" style="flex: 1 1 200px; gap: 8px">
                  <span>{{ r.phone ?? '—' }}</span>
                  @if (r.blocked) {
                    <span
                      style="padding: 2px 8px; background: #D94B5E22; color: #8F2F3C; border-radius: 9999px; font-size: 11px; font-weight: 700"
                      >{{ 'admin.riders.blocked' | translate }}</span
                    >
                  }
                </span>
                <span style="flex: 1 1 160px; color: var(--color-text-secondary)">{{ r.name ?? '—' }}</span>
                <span style="flex: 0 0 140px; font-size: 13px; color: var(--color-text-tertiary)">{{
                  formatDate(r.addedAt)
                }}</span>
                <span style="flex: 0 0 100px; text-align: right">
                  <button
                    type="button"
                    (click)="remove(r)"
                    [disabled]="removingId() === r.userId"
                    class="disabled:opacity-50"
                    style="height: 32px; padding: 0 12px; background: transparent; border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--color-berry)"
                  >
                    {{ 'admin.riders.remove' | translate }}
                  </button>
                </span>
              </div>
            }
          }
        </div>

        @if (listError()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{ listError() }}</p>
        }
      }
    </section>
  `,
})
export class AdminRidersPage implements OnInit {
  private readonly catalog = inject(AdminCatalogApi);
  private readonly api = inject(AdminRidersApi);
  private readonly translate = inject(TranslateService);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly selectedStoreId = signal<string | null>(null);
  readonly riders = signal<RiderRosterEntryDto[]>([]);
  readonly loading = signal(false);
  readonly listError = signal<string | null>(null);

  readonly removingId = signal<string | null>(null);

  /** Set when coming back from the add form, so the same store stays open. */
  readonly store = input<string | undefined>();

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list);
        const wanted = list.find((s) => s.id === this.store()) ?? list[0];
        if (wanted && !this.selectedStoreId()) {
          this.selectStore(wanted.id);
        }
      },
      error: () => this.listError.set(this.translate.instant('admin.riders.loadFailed')),
    });
  }

  selectStore(id: string): void {
    if (!id || id === this.selectedStoreId()) return;
    this.selectedStoreId.set(id);
    this.reload();
  }

  remove(rider: RiderRosterEntryDto): void {
    const storeId = this.selectedStoreId();
    if (!storeId) return;
    const label = rider.name ?? rider.phone ?? rider.userId;
    const confirmMsg = this.translate.instant('admin.riders.confirmRemove', { name: label });
    if (!confirm(confirmMsg)) return;
    this.removingId.set(rider.userId);
    this.api.remove(storeId, rider.userId).subscribe({
      next: () => {
        this.removingId.set(null);
        this.reload();
      },
      error: (err) => {
        this.removingId.set(null);
        this.listError.set(this.extractError(err) ?? this.translate.instant('admin.riders.removeFailed'));
      },
    });
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  private reload(): void {
    const storeId = this.selectedStoreId();
    if (!storeId) return;
    this.loading.set(true);
    this.listError.set(null);
    this.api.list(storeId).subscribe({
      next: (list) => {
        this.loading.set(false);
        this.riders.set(list);
      },
      error: (err) => {
        this.loading.set(false);
        this.listError.set(this.extractError(err) ?? this.translate.instant('admin.riders.loadFailed'));
      },
    });
  }

  private extractError(err: unknown): string | null {
    const maybe = err as { error?: { message?: string }; message?: string };
    return maybe.error?.message ?? maybe.message ?? null;
  }
}
