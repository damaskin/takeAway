import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map, type Observable } from 'rxjs';
import { LocaleFormatService } from '@takeaway/i18n';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import {
  AdminCatalogApi,
  type CategoryAdminDto,
  type ProductAdminDto,
  type ProductStoreOptionDto,
  type StopListEntryDto,
  type StoreAdminDto,
} from '../../core/catalog/admin-catalog.service';
import { describeMenuError } from './menu-errors';
import { MenuCategoriesComponent } from './menu-categories.component';
import { swapped } from './menu-order';
import { formatStoreTime, isStopActive, nextMidnightIn } from './stock';

/** Roles that may take a product off sale in a store (the stop-list API's roles, minus kitchen staff). */
const STOCK_ROLES = ['SUPER_ADMIN', 'BRAND_ADMIN', 'STORE_MANAGER'];

type StockUntil = 'manual' | 'endOfDay';

/**
 * Admin Menu Management — pencil oKo7M.
 *
 * mainArea (cream):
 *   top bar (foam, 64px, border-bottom) — title + brand name + actions
 *   content area — category rail (foam, caramel-light active, collapsible) +
 *     product table (foam card, inline visibility / stock toggles, ordering)
 *
 * The table has to fit next to the 260px sidebar and the rail on a 1280px
 * laptop, where «Опции» / «Изменить» used to be cut off at the right edge.
 * It answers to its own width (a container query), not the window's: below
 * 820px the row actions turn into icon buttons, below 720px price and time
 * move under the name. The actions column stays pinned to the right edge
 * if a row is still too wide, and the rail can be folded away.
 */
@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [RouterLink, TranslatePipe, MenuCategoriesComponent],
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
      @if (selectedCategoryId(); as categoryId) {
        <a
          routerLink="/menu/products/new"
          [queryParams]="{ category: categoryId }"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none"
        >
          {{ 'admin.menu.newProduct' | translate }}
        </a>
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

    <section class="menu-shell" [class.rail-folded]="railFolded()">
      @if (!railFolded()) {
        <app-menu-categories
          [categories]="categories()"
          [selectedId]="selectedCategoryId()"
          [brandId]="brand()?.id ?? null"
          (selected)="selectCategory($event)"
          (changed)="reloadCategories()"
          (deleted)="onCategoryDeleted($event)"
        />
      }

      <!-- Products -->
      <section
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px; min-width: 0"
      >
        <header class="flex items-center justify-between flex-wrap" style="gap: 8px 12px">
          <div class="flex items-center flex-wrap" style="gap: 4px 12px; min-width: 0">
            <button
              type="button"
              class="rail-toggle"
              (click)="toggleRail()"
              [attr.aria-expanded]="!railFolded()"
              [title]="(railFolded() ? 'admin.menu.showCategories' : 'admin.menu.hideCategories') | translate"
              data-testid="menu-rail-toggle"
            >
              {{ railFolded() ? '☰' : '‹' }}
              <span class="rail-toggle-label">{{
                (railFolded() ? 'admin.menu.showCategories' : 'admin.menu.hideCategories') | translate
              }}</span>
            </button>
            @if (railFolded() && categories().length > 0) {
              <select
                [style]="selectStyle"
                [value]="selectedCategoryId() ?? ''"
                (change)="pickCategory($event)"
                [attr.aria-label]="'admin.menu.categories' | translate"
              >
                @for (c of categories(); track c.id) {
                  <option [value]="c.id" [selected]="c.id === selectedCategoryId()">{{ c.name }}</option>
                }
              </select>
            }
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

        @if (selectedCategory()?.addOnsOnly) {
          <p class="addons-note" data-testid="menu-add-ons-only-note">
            {{ 'admin.menu.category.addOnsOnlyNote' | translate }}
            <a routerLink="/ingredients">{{ 'admin.menu.category.addOnsOnlyLink' | translate }}</a>
          </p>
        }

        @if (!selectedCategoryId()) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.menu.select' | translate }}
          </p>
        } @else if (products().length === 0) {
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
          <div class="table-wrap">
            <table class="pt">
              <thead>
                <tr>
                  <th class="col-photo">
                    <span class="sr-only">{{ 'admin.menu.headers.photo' | translate }}</span>
                  </th>
                  <th style="text-align: left">{{ 'admin.menu.headers.name' | translate }}</th>
                  <th class="col-price" style="text-align: right">{{ 'admin.menu.headers.price' | translate }}</th>
                  <th class="col-prep" style="text-align: right">{{ 'admin.menu.headers.prep' | translate }}</th>
                  <th class="narrow">{{ 'admin.menu.headers.visible' | translate }}</th>
                  @if (stockStore()) {
                    <th class="narrow">{{ 'admin.menu.headers.stock' | translate }}</th>
                  }
                  <th class="narrow">{{ 'admin.menu.headers.order' | translate }}</th>
                  <th class="col-actions">
                    <span class="sr-only">{{ 'admin.menu.headers.actions' | translate }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (p of products(); track p.id; let first = $first, last = $last, i = $index) {
                  <tr>
                    <td class="col-photo">
                      <div class="thumb">
                        @if (p.imageUrls[0]; as photo) {
                          <img [src]="photo" alt="" loading="lazy" />
                        }
                      </div>
                    </td>
                    <td class="col-name">
                      {{ p.name }}
                      <div class="inline-meta">
                        {{ price(p.basePriceCents) }} · {{ minutes(p.prepTimeSeconds) }}
                        {{ 'common.units.min' | translate }}
                      </div>
                      @if (listing(p); as l) {
                        <div class="flex flex-wrap" style="gap: 4px; margin-top: 4px" data-testid="product-listing">
                          @for (label of l.labels; track label) {
                            <span [style]="l.none ? listingNoneStyle : listingChipStyle" class="chip">{{ label }}</span>
                          }
                        </div>
                      }
                    </td>
                    <td class="col-price num">{{ price(p.basePriceCents) }}</td>
                    <td class="col-prep num muted">
                      {{ minutes(p.prepTimeSeconds) }} {{ 'common.units.min' | translate }}
                    </td>
                    <td class="narrow">
                      <input
                        type="checkbox"
                        [checked]="p.visible"
                        (change)="toggleVisibility(p, $event)"
                        [attr.aria-label]="'admin.menu.product.visible' | translate"
                      />
                    </td>
                    @if (stockStore(); as store) {
                      <td class="narrow">
                        @if (!p.storeIds.includes(store.id)) {
                          <span
                            style="font-size: 12px; color: var(--color-text-tertiary)"
                            [title]="'admin.menu.listing.notHere' | translate"
                            [attr.aria-label]="'admin.menu.listing.notHere' | translate"
                            >—</span
                          >
                        } @else {
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
                        }
                      </td>
                    }
                    <td class="narrow">
                      <button
                        type="button"
                        (click)="moveProduct(i, -1)"
                        [disabled]="first || reordering()"
                        [title]="'admin.menu.moveUp' | translate"
                        [attr.aria-label]="'admin.menu.moveUp' | translate"
                        class="arrow disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        (click)="moveProduct(i, 1)"
                        [disabled]="last || reordering()"
                        [title]="'admin.menu.moveDown' | translate"
                        [attr.aria-label]="'admin.menu.moveDown' | translate"
                        class="arrow disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </td>
                    <td class="col-actions">
                      <a
                        class="act"
                        [routerLink]="['/menu/products', p.id, 'options']"
                        [title]="'admin.menu.product.options' | translate"
                        [attr.aria-label]="'admin.menu.product.options' | translate"
                        data-testid="product-options-link"
                      >
                        <span class="act-text">{{ 'admin.menu.product.options' | translate }}</span>
                        <span class="act-icon" aria-hidden="true">⚙&#xFE0E;</span>
                      </a>
                      <a
                        class="act edit"
                        [routerLink]="['/menu/products', p.id]"
                        [title]="'common.change' | translate"
                        [attr.aria-label]="'common.change' | translate"
                      >
                        <span class="act-text">{{ 'common.change' | translate }}</span>
                        <span class="act-icon" aria-hidden="true">✎</span>
                      </a>
                      <button
                        type="button"
                        class="act danger"
                        (click)="deleteProduct(p)"
                        [title]="'admin.menu.product.deleteCta' | translate"
                        [attr.aria-label]="'admin.menu.product.deleteCta' | translate"
                      >
                        <span class="act-text">{{ 'admin.menu.product.deleteCta' | translate }}</span>
                        <span class="act-icon" aria-hidden="true">×</span>
                      </button>
                    </td>
                  </tr>
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
      .menu-shell {
        display: grid;
        grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
        gap: 24px;
        align-items: start;
        padding: clamp(16px, 3vw, 24px);
      }
      .menu-shell.rail-folded {
        grid-template-columns: minmax(0, 1fr);
      }
      @media (max-width: 1200px) {
        .menu-shell {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .rail-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid var(--color-border-light);
        border-radius: 8px;
        font: 600 12px var(--font-sans);
        color: var(--color-text-secondary);
      }
      @media (max-width: 1200px) {
        .rail-toggle-label {
          display: none;
        }
      }
      .addons-note {
        margin: 0;
        padding: 10px 12px;
        border-left: 3px solid var(--color-amber);
        border-radius: 8px;
        background: var(--color-cream);
        font: 13px var(--font-sans);
        color: var(--color-text-primary);
      }
      .addons-note a {
        color: var(--color-caramel);
        font-weight: 600;
      }
      .table-wrap {
        container-type: inline-size;
        overflow-x: auto;
      }
      .pt {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-sans);
      }
      .pt th {
        padding: 8px 10px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-text-tertiary);
        letter-spacing: 0.5px;
        text-transform: uppercase;
        white-space: nowrap;
        border-bottom: 1px solid var(--color-border-light);
      }
      .pt td {
        padding: 10px;
        border-bottom: 1px solid var(--color-border-light);
      }
      .pt .col-photo {
        width: 40px;
        padding-right: 4px;
      }
      .thumb {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        overflow: hidden;
        background: linear-gradient(135deg, var(--color-latte) 0%, var(--color-cream) 100%);
      }
      .thumb img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .col-name {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .num {
        font-size: 14px;
        text-align: right;
        white-space: nowrap;
        color: var(--color-text-primary);
      }
      .num.muted {
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .pt .narrow {
        width: 1%;
        text-align: center;
        white-space: nowrap;
      }
      .pt .col-actions {
        position: sticky;
        right: 0;
        width: 1%;
        text-align: right;
        white-space: nowrap;
        background: var(--color-foam);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 8px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 500;
      }
      .arrow {
        width: 26px;
        height: 28px;
        font-size: 14px;
        color: var(--color-text-secondary);
      }
      .act {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: 12px;
        font: 500 12px var(--font-sans);
        color: var(--color-text-secondary);
        text-decoration: none;
      }
      .act.edit {
        color: var(--color-caramel);
      }
      .act.danger {
        color: var(--color-berry);
      }
      .inline-meta,
      .act-icon {
        display: none;
      }
      @container (max-width: 820px) {
        .pt th,
        .pt td {
          padding-left: 6px;
          padding-right: 6px;
        }
        .pt th {
          letter-spacing: 0;
        }
        .act {
          width: 30px;
          height: 30px;
          margin-left: 2px;
          border-radius: 8px;
          font-size: 16px;
        }
        .act:hover {
          background: var(--color-cream);
        }
        .act-text {
          display: none;
        }
        .act-icon {
          display: inline;
        }
      }
      @container (max-width: 720px) {
        .col-price,
        .col-prep {
          display: none;
        }
        .inline-meta {
          display: block;
          margin-top: 2px;
          font-size: 12px;
          font-weight: 400;
          color: var(--color-text-secondary);
          white-space: nowrap;
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
  /** `/menu?category=…` — coming back from a form reopens the same category. */
  readonly category = input<string | undefined>();
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
  /** Every store of the brand, for the "sold in" chips under each product. */
  readonly productStores = signal<ProductStoreOptionDto[]>([]);
  readonly listingChipStyle = 'background: var(--color-cream); color: var(--color-text-secondary)';
  readonly listingNoneStyle = 'background: #d94b5e1a; color: var(--color-berry)';

  readonly selectedCategory = computed(() => this.categories().find((c) => c.id === this.selectedCategoryId()) ?? null);

  /** The category rail folded away, to give the table the whole width; remembered per browser. */
  readonly railFolded = signal(readRailFolded());
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
        this.loadError.set(null);
        this.tableError.set(null);
        this.stores.set([]);
        this.stockStoreId.set(null);
        this.productStores.set([]);
        if (!brand) return;
        this.loadCategories(brand.id);
        this.loadStores(brand.id);
        this.loadProductStores(brand.id);
      });
    });

    effect(() => {
      const storeId = this.stockStoreId();
      untracked(() => this.loadStopList(storeId));
    });
  }

  toggleRail(): void {
    const folded = !this.railFolded();
    this.railFolded.set(folded);
    writeRailFolded(folded);
  }

  /** The category picker that stands in for the folded rail. */
  pickCategory(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (id && id !== this.selectedCategoryId()) this.selectCategory(id);
  }

  selectCategory(id: string): void {
    this.selectedCategoryId.set(id);
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
      }
    } else if (selected && selected === event.movedTo) {
      this.loadProducts(selected);
    }
    this.reloadCategories();
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

  /**
   * Where a product is sold, as chips — only for a brand with more than one
   * store, where it can differ: "In every store", the store names, or a
   * warning that it is sold nowhere.
   */
  listing(product: ProductAdminDto): { labels: string[]; none: boolean } | null {
    const stores = this.productStores();
    if (stores.length < 2) return null;
    const ids = product.storeIds;
    if (ids.length === 0) return { labels: [this.translate.instant('admin.menu.listing.none')], none: true };
    if (stores.every((s) => ids.includes(s.id))) {
      return { labels: [this.translate.instant('admin.menu.listing.all')], none: false };
    }
    return { labels: stores.filter((s) => ids.includes(s.id)).map((s) => s.name), none: false };
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }

  minutes(seconds: number): string {
    const value = Math.round((seconds / 60) * 10) / 10;
    return String(value).replace('.', this.translate.getCurrentLang() === 'en' ? '.' : ',');
  }

  private loadCategories(brandId: string): void {
    this.api.listCategories(brandId).subscribe({
      next: (list) => {
        if (this.brand()?.id !== brandId) return;
        this.categories.set(list);
        const selected = this.selectedCategoryId();
        if (!selected || !list.some((c) => c.id === selected)) {
          // `?category=` is the one the user was on before a form took over.
          const wanted = list.find((c) => c.id === this.category()) ?? list[0];
          if (wanted) this.selectCategory(wanted.id);
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

  private loadProductStores(brandId: string): void {
    this.api.listProductStores(brandId).subscribe({
      next: (list) => {
        if (this.brand()?.id === brandId) this.productStores.set(list);
      },
      // Without it the chips are simply not shown.
      error: () => this.productStores.set([]),
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

const RAIL_FOLDED_KEY = 'takeaway.admin.menu.railFolded';

/** Storage can be missing or refuse access (private mode); the rail is then simply open. */
function readRailFolded(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(RAIL_FOLDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRailFolded(folded: boolean): void {
  try {
    if (folded) localStorage.setItem(RAIL_FOLDED_KEY, '1');
    else localStorage.removeItem(RAIL_FOLDED_KEY);
  } catch {
    // Not remembered; the toggle still works for this visit.
  }
}

/** Array fields default to empty so an older API answer cannot break the table. */
function withListDefaults(p: ProductAdminDto): ProductAdminDto {
  return {
    ...p,
    imageUrls: p.imageUrls ?? [],
    allergens: p.allergens ?? [],
    dietTags: p.dietTags ?? [],
    storeIds: p.storeIds ?? [],
  };
}
