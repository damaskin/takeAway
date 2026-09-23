import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type BrandDto } from '../catalog/admin-catalog.service';
import { apiErrorMessage } from '../http/api-error';

const STORAGE_KEY = 'takeaway.admin.activeBrandId';

/**
 * Holds the brand the operator is currently acting on in the admin panel.
 *
 * - SUPER_ADMIN can switch between any brand (selector in the top bar).
 * - BRAND_ADMIN sees their owned brands (usually one, selector hidden).
 * - STORE_MANAGER / STAFF / RIDER see brands of stores they're assigned to.
 *
 * The active id is persisted in localStorage so refresh keeps the same
 * context. If the persisted id falls outside the user's current scope
 * (e.g. SUPER_ADMIN revoked a brand) it's reset to the first available.
 *
 * "No active brand" has two very different causes and the pages that
 * depend on it have to tell them apart: the account genuinely owns no
 * brand yet ({@link loadError} is null), or the brand list failed to load
 * and we have no idea ({@link loadError} holds the reason). Reporting the
 * second as the first is what made an expired session or a 500 read as
 * "this user has no brand".
 */
@Injectable({ providedIn: 'root' })
export class ActiveBrandService {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  private readonly _brands = signal<BrandDto[]>([]);
  private readonly _activeId = signal<string | null>(this.readStored());
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _loadError = signal<string | null>(null);

  readonly brands = this._brands.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly loadError = this._loadError.asReadonly();
  readonly activeId = this._activeId.asReadonly();
  readonly active = computed<BrandDto | null>(() => {
    const id = this._activeId();
    return this._brands().find((b) => b.id === id) ?? null;
  });

  /** True once the list has loaded successfully and came back empty. */
  readonly isEmpty = computed(() => this._loaded() && !this._loadError() && this._brands().length === 0);

  constructor() {
    effect(() => {
      const id = this._activeId();
      if (typeof localStorage === 'undefined') return;
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    });
  }

  /**
   * Fetches the brand list for the signed-in user and reconciles the
   * active id with the new set. Idempotent: subsequent calls re-fetch
   * and pick up brands added/removed since the last load.
   */
  refresh(): void {
    if (this._loading()) return;
    this._loading.set(true);
    this._loadError.set(null);
    this.api.listMyBrands().subscribe({
      next: (list) => {
        this._brands.set(list);
        const current = this._activeId();
        const stillValid = current && list.some((b) => b.id === current);
        if (!stillValid) {
          this._activeId.set(list[0]?.id ?? null);
        }
        this._loading.set(false);
        this._loaded.set(true);
      },
      error: (err) => {
        this._brands.set([]);
        this._activeId.set(null);
        this._loadError.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 401: 'common.forbidden', 403: 'common.forbidden' },
          }),
        );
        this._loading.set(false);
        this._loaded.set(true);
      },
    });
  }

  select(brandId: string): void {
    if (!this._brands().some((b) => b.id === brandId)) return;
    this._activeId.set(brandId);
  }

  /** Adds a freshly created brand and switches to it without a round-trip. */
  adopt(brand: BrandDto): void {
    this._brands.update((list) =>
      [...list.filter((b) => b.id !== brand.id), brand].sort((a, b) => a.name.localeCompare(b.name)),
    );
    this._activeId.set(brand.id);
    this._loadError.set(null);
    this._loaded.set(true);
  }

  reset(): void {
    this._brands.set([]);
    this._activeId.set(null);
    this._loaded.set(false);
    this._loadError.set(null);
  }

  private readStored(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  }
}
