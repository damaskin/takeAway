import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import {
  AdminCatalogApi,
  type ReadinessCheck,
  type StoreAdminDto,
  type StoreStatus,
} from '../../core/catalog/admin-catalog.service';
import { apiErrorCode } from '../../core/http/api-error';
import { type AdminRole, canOnStores } from '../../core/permissions/permissions';
import { type EditorTab } from './store-editor.component';
import { storeErrorMessage } from './store-errors';
import { StoreReadinessComponent } from './store-readiness.component';

/** A failed action on one store, shown on that store's card. */
interface CardError {
  text: string;
  /** Deleting was refused because of orders: closing is the way out. */
  offerClose: boolean;
}

@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [RouterLink, TranslatePipe, StoreReadinessComponent],
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
      @if (canCreate() && hasBrand()) {
        <a
          routerLink="/stores/new"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap"
        >
          {{ 'admin.stores.add' | translate }}
        </a>
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
              <a
                class="flex items-center justify-center"
                [routerLink]="['/stores', s.id]"
                style="flex: 1 1 120px; height: 36px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary); text-decoration: none"
              >
                {{ (canEdit() ? 'admin.stores.edit' : 'admin.stores.view') | translate }}
              </a>
              <a
                class="flex items-center justify-center"
                [routerLink]="['/stores', s.id]"
                [queryParams]="{ tab: 'hours' }"
                style="flex: 1 1 120px; height: 36px; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none"
              >
                {{ 'admin.stores.hours' | translate }}
              </a>
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
  private readonly router = inject(Router);

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

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loaded = signal(false);
  readonly listError = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly cardErrors = signal<Record<string, CardError>>({});

  private listRequest = 0;

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

  /** A readiness check that can be fixed opens the editor on its tab. */
  fixReadiness(id: string, check: ReadinessCheck): void {
    const tab: EditorTab = check === 'hours' ? 'hours' : 'details';
    this.router.navigate(['/stores', id], { queryParams: { tab } });
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
