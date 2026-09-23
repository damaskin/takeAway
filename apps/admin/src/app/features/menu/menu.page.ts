import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map, type Observable } from 'rxjs';
import { LocaleFormatService } from '@takeaway/i18n';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import {
  AdminCatalogApi,
  type CategoryAdminDto,
  type ProductAdminDto,
  type StopListEntryDto,
  type StoreAdminDto,
} from '../../core/catalog/admin-catalog.service';
import { describeMenuError } from './menu-errors';
import { MenuCategoriesComponent } from './menu-categories.component';
import { swapped } from './menu-order';
import { ProductFormComponent, type ProductSavedEvent } from './product-form.component';
import { ProductOptionsPanelComponent } from './product-options-panel.component';
import { formatStoreTime, isStopActive, nextMidnightIn } from './stock';

/** Roles that may take a product off sale in a store (the stop-list API's roles, minus kitchen staff). */
const STOCK_ROLES = ['SUPER_ADMIN', 'BRAND_ADMIN', 'STORE_MANAGER'];

type StockUntil = 'manual' | 'endOfDay';

/**
 * Admin Menu Management — pencil oKo7M.
 *
 * mainArea (cream):
 *   top bar (foam, 64px, border-bottom) — title + brand name + actions
 *   content area — 320px category rail (foam, caramel-light active) +
 *     product table (foam card, inline visibility / stock toggles, ordering)
 */
@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [TranslatePipe, MenuCategoriesComponent, ProductFormComponent, ProductOptionsPanelComponent],
  template: `
    <!-- Top bar -->
    <div
      class="flex items-center justify-between flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px"
    >
      <div class="flex items-center" style="gap: 16px; min-width: 0">
        <h1
          style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'admin.menu.title' | translate }}
        </h1>
        @if (brand()) {
          <span
            class="flex items-center"
            style="height: 26px; padding: 0 10px; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
            >{{ brand()?.name }}</span
          >
        }
      </div>
      @if (selectedCategoryId()) {
        <button
          type="button"
          (click)="openProductForm()"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
        >
          {{ 'admin.menu.newProduct' | translate }}
        </button>
      }
    </div>

    @if (brandBlocker(); as blocker) {
      <div
        style="margin: clamp(16px, 3vw, 24px); padding: 16px 18px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-left: 4px solid var(--color-amber); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
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

    @if (loadError()) {
      <p
        role="alert"
        style="margin: clamp(16px, 3vw, 24px) clamp(16px, 3vw, 24px) 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)"
      >
        {{ loadError() }}
      </p>
    }

    <section
      class="menu-shell"
      style="padding: clamp(16px, 3vw, 24px); display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 24px; align-items: start"
    >
      <app-menu-categories
        [categories]="categories()"
        [selectedId]="selectedCategoryId()"
        [brandId]="brand()?.id ?? null"
        (selected)="selectCategory($event)"
        (changed)="reloadCategories()"
        (deleted)="onCategoryDeleted($event)"
      />

      <!-- Products -->
      <section
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px; min-width: 0"
      >
        <header class="flex items-center justify-between flex-wrap" style="gap: 8px 12px">
          <div class="flex items-baseline flex-wrap" style="gap: 4px 12px; min-width: 0">
            <h2
              style="font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-espresso); margin: 0; overflow-wrap: anywhere"
            >
              {{ selectedCategory()?.name ?? ('admin.menu.productsFallback' | translate) }}
            </h2>
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
              'admin.menu.itemsCount' | translate: { count: products().length }
            }}</span>
          </div>
          @if (canManageStock() && stores().length > 0) {
            <div class="flex items-center flex-wrap" style="gap: 8px 16px">
              <label class="flex items-center" style="gap: 8px; min-width: 0">
                <span [style]="smallLabelStyle">{{ 'admin.menu.stock.store' | translate }}</span>
                <select (change)="selectStockStore($event)" [style]="selectStyle">
                  @for (s of stores(); track s.id) {
                    <option [value]="s.id" [selected]="s.id === stockStoreId()">{{ s.name }}</option>
                  }
                </select>
              </label>
              <label class="flex items-center" style="gap: 8px; min-width: 0">
                <span [style]="smallLabelStyle">{{ 'admin.menu.stock.until' | translate }}</span>
                <select [value]="stockUntil()" (change)="selectStockUntil($event)" [style]="selectStyle">
                  <option value="manual">{{ 'admin.menu.stock.untilManual' | translate }}</option>
                  <option value="endOfDay">{{ 'admin.menu.stock.untilEndOfDay' | translate }}</option>
                </select>
              </label>
            </div>
          }
        </header>

        @if (productFormOpen() && selectedCategoryId() && brand(); as b) {
          <div id="menu-product-form">
            <app-product-form
              [product]="editingProduct()"
              [categoryId]="selectedCategoryId() ?? ''"
              [categories]="categories()"
              [brandId]="b.id"
              [currency]="currency()"
              [justCreated]="justCreated()"
              (saved)="onProductSaved($event)"
              (closed)="closeProductForm()"
              (imagesChanged)="onImagesChanged($event)"
            />
          </div>
        }

        @if (!selectedCategoryId()) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.menu.select' | translate }}
          </p>
        } @else if (products().length === 0 && !productFormOpen()) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.menu.emptyCategory' | translate }}
          </p>
        }

        @if (tableError()) {
          <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
            {{ tableError() }}
          </p>
        }

        @if (products().length > 0) {
          <div style="overflow-x: auto; margin: 0 -4px; padding: 0 4px">
            <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans)">
              <thead>
                <tr>
                  <th [style]="thStyle" style="width: 52px">
                    <span class="sr-only">{{ 'admin.menu.headers.photo' | translate }}</span>
                  </th>
                  <th [style]="thStyle" style="text-align: left">{{ 'admin.menu.headers.name' | translate }}</th>
                  <th [style]="thStyle" style="text-align: right">{{ 'admin.menu.headers.price' | translate }}</th>
                  <th [style]="thStyle" style="text-align: right">{{ 'admin.menu.headers.prep' | translate }}</th>
                  <th [style]="thStyle" style="text-align: center">{{ 'admin.menu.headers.visible' | translate }}</th>
                  @if (stockStore()) {
                    <th [style]="thStyle" style="text-align: center">{{ 'admin.menu.headers.stock' | translate }}</th>
                  }
                  <th [style]="thStyle" style="text-align: center">{{ 'admin.menu.headers.order' | translate }}</th>
                  <th [style]="thStyle"></th>
                </tr>
              </thead>
              <tbody>
                @for (p of products(); track p.id; let first = $first, last = $last, i = $index) {
                  <tr style="border-bottom: 1px solid var(--color-border-light)">
                    <td style="padding: 8px 12px">
                      <div
                        style="width: 40px; height: 40px; border-radius: 10px; overflow: hidden; background: linear-gradient(135deg, var(--color-latte) 0%, var(--color-cream) 100%)"
                      >
                        @if (p.imageUrls[0]; as photo) {
                          <img
                            [src]="photo"
                            alt=""
                            loading="lazy"
                            style="display: block; width: 100%; height: 100%; object-fit: cover"
                          />
                        }
                      </div>
                    </td>
                    <td style="padding: 12px; font-size: 14px; color: var(--color-text-primary); font-weight: 500">
                      {{ p.name }}
                    </td>
                    <td
                      style="padding: 12px; font-size: 14px; color: var(--color-text-primary); text-align: right; white-space: nowrap"
                    >
                      {{ price(p.basePriceCents) }}
                    </td>
                    <td
                      style="padding: 12px; font-size: 13px; color: var(--color-text-secondary); text-align: right; white-space: nowrap"
                    >
                      {{ minutes(p.prepTimeSeconds) }} {{ 'common.units.min' | translate }}
                    </td>
                    <td style="padding: 12px; text-align: center">
                      <input
                        type="checkbox"
                        [checked]="p.visible"
                        (change)="toggleVisibility(p, $event)"
                        [attr.aria-label]="'admin.menu.product.visible' | translate"
                      />
                    </td>
                    @if (stockStore(); as store) {
                      <td style="padding: 12px; text-align: center">
                        <div class="flex flex-col items-center" style="gap: 2px">
                          <input
                            type="checkbox"
                            [checked]="inStock(p.id)"
                            [disabled]="stockPending() === p.id"
                            (change)="setInStock(p, $event)"
                            [attr.aria-label]="'admin.menu.stock.toggle' | translate: { store: store.name }"
                          />
                          @if (soldOutUntil(p.id); as until) {
                            <span style="font-size: 11px; color: var(--color-berry); white-space: nowrap">{{
                              until
                            }}</span>
                          }
                        </div>
                      </td>
                    }
                    <td style="padding: 12px; text-align: center; white-space: nowrap">
                      <button
                        type="button"
                        (click)="moveProduct(i, -1)"
                        [disabled]="first || reordering()"
                        [title]="'admin.menu.moveUp' | translate"
                        [attr.aria-label]="'admin.menu.moveUp' | translate"
                        class="disabled:opacity-30"
                        [style]="arrowStyle"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        (click)="moveProduct(i, 1)"
                        [disabled]="last || reordering()"
                        [title]="'admin.menu.moveDown' | translate"
                        [attr.aria-label]="'admin.menu.moveDown' | translate"
                        class="disabled:opacity-30"
                        [style]="arrowStyle"
                      >
                        ↓
                      </button>
                    </td>
                    <td style="padding: 12px; text-align: right; white-space: nowrap">
                      <button
                        type="button"
                        (click)="toggleOptions(p.id)"
                        style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary); font-weight: 500; margin-right: 12px"
                      >
                        {{
                          (expandedProductId() === p.id
                            ? 'admin.menu.product.hideOptions'
                            : 'admin.menu.product.options'
                          ) | translate
                        }}
                      </button>
                      <button
                        type="button"
                        (click)="openProductEdit(p)"
                        style="font-family: var(--font-sans); font-size: 12px; color: var(--color-caramel); font-weight: 500; margin-right: 12px"
                      >
                        {{ 'common.change' | translate }}
                      </button>
                      <button
                        type="button"
                        (click)="deleteProduct(p)"
                        style="font-family: var(--font-sans); font-size: 12px; color: var(--color-berry); font-weight: 500"
                      >
                        {{ 'admin.menu.product.deleteCta' | translate }}
                      </button>
                    </td>
                  </tr>
                  @if (expandedProductId() === p.id) {
                    <tr>
                      <td [attr.colspan]="columnCount()" style="padding: 0 12px 16px 12px">
                        <app-product-options-panel [productId]="p.id" [currency]="currency()" />
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </section>
  `,
  styles: [
    `
      @media (max-width: 1200px) {
        .menu-shell {
          grid-template-columns: 1fr !important;
        }
      }
    `,
  ],
})
export class MenuPage {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthStore);
  readonly activeBrand = inject(ActiveBrandService);
  private readonly fmt = inject(LocaleFormatService);

  /**
   * The menu is edited in the context of the brand picked in the top bar,
   * like every other admin page. It used to fetch its own brand list and
   * silently take the first entry, which meant a SUPER_ADMIN switching
   * brands kept editing the alphabetically-first one.
   */
  readonly brand = this.activeBrand.active;
  /** Prices are entered and shown in the brand's currency. */
  readonly currency = computed(() => this.brand()?.currency ?? null);
  readonly categories = signal<CategoryAdminDto[]>([]);
  readonly selectedCategoryId = signal<string | null>(null);
  readonly products = signal<ProductAdminDto[]>([]);
  readonly productFormOpen = signal(false);
  readonly editingProduct = signal<ProductAdminDto | null>(null);
  readonly justCreated = signal(false);
  readonly expandedProductId = signal<string | null>(null);
  readonly reordering = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly tableError = signal<string | null>(null);

  /** Sold-out marks live per store; kitchen staff and menu editors do not set them here. */
  readonly canManageStock = computed(() => STOCK_ROLES.includes(this.auth.user()?.role ?? ''));
  readonly stores = signal<StoreAdminDto[]>([]);
  readonly stockStoreId = signal<string | null>(null);
  readonly stockStore = computed(() => this.stores().find((s) => s.id === this.stockStoreId()) ?? null);
  readonly stopList = signal<ReadonlyMap<string, StopListEntryDto>>(new Map());
  readonly stockUntil = signal<StockUntil>('manual');
  readonly stockPending = signal<string | null>(null);

  readonly selectedCategory = computed(() => this.categories().find((c) => c.id === this.selectedCategoryId()) ?? null);
  readonly columnCount = computed(() => (this.stockStore() ? 8 : 7));

  // No text-align here: a [style] binding outranks the static style that sets it per column.
  readonly thStyle =
    'padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1px solid var(--color-border-light)';
  readonly arrowStyle = 'width: 26px; height: 28px; font-size: 14px; color: var(--color-text-secondary)';
  readonly smallLabelStyle = 'font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)';
  readonly selectStyle =
    'height: 32px; max-width: 220px; padding: 0 8px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 13px';

  /**
   * Why the page can't edit anything: `error` = the brand list failed to
   * load, `empty` = it loaded and the account has no brand yet.
   */
  readonly brandBlocker = computed<'error' | 'empty' | null>(() => {
    if (this.activeBrand.loadError()) return 'error';
    if (this.activeBrand.isEmpty()) return 'empty';
    return null;
  });

  constructor() {
    // Brand list is normally loaded once by AdminLayoutPage; trigger here as
    // a safety net for direct navigation / hot-reload.
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();

    // Reload the menu whenever the active brand changes, and drop the
    // previous brand's categories/products so nothing stale is editable.
    effect(() => {
      const brand = this.activeBrand.active();
      untracked(() => {
        this.categories.set([]);
        this.products.set([]);
        this.selectedCategoryId.set(null);
        this.closeProductForm();
        this.expandedProductId.set(null);
        this.loadError.set(null);
        this.tableError.set(null);
        this.stores.set([]);
        this.stockStoreId.set(null);
        if (!brand) return;
        this.loadCategories(brand.id);
        this.loadStores(brand.id);
      });
    });

    effect(() => {
      const storeId = this.stockStoreId();
      untracked(() => this.loadStopList(storeId));
    });
  }

  selectCategory(id: string): void {
    this.selectedCategoryId.set(id);
    this.closeProductForm();
    this.expandedProductId.set(null);
    this.tableError.set(null);
    this.loadProducts(id);
  }

  reloadCategories(): void {
    const brand = this.brand();
    if (brand) this.loadCategories(brand.id);
  }

  onCategoryDeleted(event: { id: string; movedTo: string | null }): void {
    const selected = this.selectedCategoryId();
    if (selected === event.id) {
      if (event.movedTo) {
        this.selectCategory(event.movedTo);
      } else {
        this.selectedCategoryId.set(null);
        this.products.set([]);
        this.closeProductForm();
      }
    } else if (selected && selected === event.movedTo) {
      this.loadProducts(selected);
    }
    this.reloadCategories();
  }

  openProductForm(): void {
    this.editingProduct.set(null);
    this.justCreated.set(false);
    this.productFormOpen.set(true);
    this.scrollToForm();
  }

  openProductEdit(p: ProductAdminDto): void {
    this.editingProduct.set(p);
    this.justCreated.set(false);
    this.productFormOpen.set(true);
    this.scrollToForm();
  }

  closeProductForm(): void {
    this.productFormOpen.set(false);
    this.editingProduct.set(null);
    this.justCreated.set(false);
  }

  onProductSaved(event: ProductSavedEvent): void {
    if (event.created) {
      // Stay in the editor so the photos can go on right away.
      this.editingProduct.set(event.product);
      this.justCreated.set(true);
    } else {
      this.closeProductForm();
    }
    const categoryId = this.selectedCategoryId();
    if (categoryId) this.loadProducts(categoryId);
    // Counts in the rail changed (a new product, or one moved elsewhere).
    this.reloadCategories();
  }

  onImagesChanged(event: { productId: string; imageUrls: string[] }): void {
    const patch = (p: ProductAdminDto) => (p.id === event.productId ? { ...p, imageUrls: event.imageUrls } : p);
    this.products.update((list) => list.map(patch));
    this.editingProduct.update((p) => (p ? patch(p) : p));
  }

  toggleOptions(productId: string): void {
    this.expandedProductId.update((cur) => (cur === productId ? null : productId));
  }

  toggleVisibility(product: ProductAdminDto, event: Event): void {
    const box = event.target as HTMLInputElement;
    const visible = box.checked;
    this.tableError.set(null);
    this.api.toggleProductVisibility(product.id, visible).subscribe({
      next: () => this.products.update((list) => list.map((p) => (p.id === product.id ? { ...p, visible } : p))),
      error: (err: unknown) => {
        box.checked = !visible;
        this.tableError.set(describeMenuError(err, this.translate));
      },
    });
  }

  moveProduct(index: number, delta: -1 | 1): void {
    const before = this.products();
    const after = swapped(before, index, index + delta);
    if (!after) return;
    this.products.set(after);
    this.reordering.set(true);
    this.tableError.set(null);
    this.api.reorderProducts(after.map((p) => p.id)).subscribe({
      next: () => this.reordering.set(false),
      error: (err: unknown) => {
        this.reordering.set(false);
        this.products.set(before);
        this.tableError.set(describeMenuError(err, this.translate));
      },
    });
  }

  deleteProduct(product: ProductAdminDto): void {
    const msg = this.translate.instant('admin.menu.product.deleteConfirm', { name: product.name });
    if (!confirm(msg)) return;
    this.tableError.set(null);
    this.api.deleteProduct(product.id).subscribe({
      next: () => {
        this.products.update((list) => list.filter((p) => p.id !== product.id));
        if (this.editingProduct()?.id === product.id) this.closeProductForm();
        if (this.expandedProductId() === product.id) this.expandedProductId.set(null);
        this.reloadCategories();
      },
      error: (err: unknown) => this.tableError.set(describeMenuError(err, this.translate)),
    });
  }

  selectStockStore(event: Event): void {
    this.stockStoreId.set((event.target as HTMLSelectElement).value || null);
  }

  selectStockUntil(event: Event): void {
    this.stockUntil.set((event.target as HTMLSelectElement).value === 'endOfDay' ? 'endOfDay' : 'manual');
  }

  inStock(productId: string): boolean {
    const entry = this.stopList().get(productId);
    return !entry || !isStopActive(entry);
  }

  /** "до 00:00" under a product that comes back by itself; nothing for a manual mark. */
  soldOutUntil(productId: string): string | null {
    const entry = this.stopList().get(productId);
    if (!entry?.expiresAt || !isStopActive(entry)) return null;
    const time = formatStoreTime(entry.expiresAt, this.stockStore()?.timezone, this.translate.getCurrentLang() || 'ru');
    return this.translate.instant('admin.menu.stock.soldOutUntil', { time });
  }

  setInStock(product: ProductAdminDto, event: Event): void {
    const store = this.stockStore();
    if (!store) return;
    const box = event.target as HTMLInputElement;
    const available = box.checked;
    const request: Observable<StopListEntryDto | null> = available
      ? this.api.removeStopListEntry(store.id, product.id).pipe(map(() => null))
      : this.api.addStopListEntry(store.id, {
          productId: product.id,
          ...(this.stockUntil() === 'endOfDay' ? { expiresAt: nextMidnightIn(store.timezone).toISOString() } : {}),
        });
    this.stockPending.set(product.id);
    this.tableError.set(null);
    request.subscribe({
      next: (entry) => {
        this.stockPending.set(null);
        this.stopList.update((current) => {
          const next = new Map(current);
          if (entry) next.set(product.id, entry);
          else next.delete(product.id);
          return next;
        });
      },
      error: (err: unknown) => {
        this.stockPending.set(null);
        // Nothing to lift: someone already put it back on sale.
        if (available && (err as { status?: number }).status === 404) {
          this.stopList.update((current) => {
            const next = new Map(current);
            next.delete(product.id);
            return next;
          });
          return;
        }
        box.checked = !available;
        this.tableError.set(describeMenuError(err, this.translate));
      },
    });
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }

  minutes(seconds: number): string {
    const value = Math.round((seconds / 60) * 10) / 10;
    return String(value).replace('.', this.translate.getCurrentLang() === 'en' ? '.' : ',');
  }

  private scrollToForm(): void {
    // After the form renders: on a long menu it opens above the table,
    // out of sight of the row whose "Change" was clicked.
    setTimeout(() =>
      document.getElementById('menu-product-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  private loadCategories(brandId: string): void {
    this.api.listCategories(brandId).subscribe({
      next: (list) => {
        if (this.brand()?.id !== brandId) return;
        this.categories.set(list);
        const selected = this.selectedCategoryId();
        if (!selected || !list.some((c) => c.id === selected)) {
          if (list[0]) this.selectCategory(list[0].id);
          else {
            this.selectedCategoryId.set(null);
            this.products.set([]);
          }
        }
      },
      error: (err: unknown) => this.loadError.set(describeMenuError(err, this.translate)),
    });
  }

  private loadProducts(categoryId: string): void {
    const brand = this.brand();
    if (!brand) return;
    this.api.listProducts(brand.id, categoryId).subscribe({
      next: (list) => {
        if (this.selectedCategoryId() !== categoryId) return;
        this.products.set(list.map(withListDefaults));
      },
      error: (err: unknown) => this.loadError.set(describeMenuError(err, this.translate)),
    });
  }

  private loadStores(brandId: string): void {
    if (!this.canManageStock()) return;
    this.api.listStores(brandId).subscribe({
      next: (list) => {
        if (this.brand()?.id !== brandId) return;
        this.stores.set(list);
        this.stockStoreId.set(list[0]?.id ?? null);
      },
      // The menu stays fully editable without the stock column.
      error: () => this.stores.set([]),
    });
  }

  private loadStopList(storeId: string | null): void {
    this.stopList.set(new Map());
    if (!storeId) return;
    this.api.listStopList(storeId).subscribe({
      next: (entries) => {
        if (this.stockStoreId() !== storeId) return;
        this.stopList.set(new Map(entries.map((e) => [e.productId, e])));
      },
      error: (err: unknown) => this.tableError.set(describeMenuError(err, this.translate)),
    });
  }
}

/** Array fields default to empty so an older API answer cannot break the table. */
function withListDefaults(p: ProductAdminDto): ProductAdminDto {
  return {
    ...p,
    imageUrls: p.imageUrls ?? [],
    allergens: p.allergens ?? [],
    dietTags: p.dietTags ?? [],
  };
}
