import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CategoryAdminDto, type ProductAdminDto } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';

/**
 * Admin Menu Management — pencil oKo7M.
 *
 * mainArea (cream):
 *   top bar (foam, 64px, border-bottom) — title + brand name + actions
 *   content area — 320px category rail (foam, caramel-light active) +
 *     product table (foam card, sticky header, inline visibility toggle)
 */
@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <!-- Top bar -->
    <div
      class="flex items-center justify-between flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px"
    >
      <div class="flex items-center" style="gap: 16px">
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
      <div class="flex items-center" style="gap: 8px">
        <button
          type="button"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
        >
          {{ 'admin.menu.importCsv' | translate }}
        </button>
        @if (selectedCategoryId()) {
          <a
            routerLink="/menu/products/new"
            [queryParams]="{ categoryId: selectedCategoryId() }"
            class="flex items-center"
            style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none"
          >
            {{ 'admin.menu.newProduct' | translate }}
          </a>
        }
      </div>
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

    <section
      class="menu-shell"
      style="padding: clamp(16px, 3vw, 24px); display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 24px; align-items: start"
    >
      <!-- Categories rail -->
      <aside
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 16px; gap: 4px"
      >
        <div class="flex items-center justify-between" style="padding: 0 8px 12px 8px">
          <h2
            style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
          >
            {{ 'admin.menu.categories' | translate }}
          </h2>
          @if (brand()) {
            <a
              routerLink="/menu/categories/new"
              style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-caramel); text-decoration: none"
            >
              {{ 'admin.menu.add' | translate }}
            </a>
          }
        </div>

        @if (categories().length === 0) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); padding: 8px">
            {{ 'admin.menu.noCategories' | translate }}
          </p>
        }

        @for (cat of categories(); track cat.id) {
          <div
            class="flex items-center"
            [style.background]="selectedCategoryId() === cat.id ? 'var(--color-caramel-light)' : 'transparent'"
            style="border-radius: 10px"
          >
            <button
              type="button"
              (click)="selectCategory(cat.id)"
              class="flex-1 flex items-center justify-between"
              [style.color]="selectedCategoryId() === cat.id ? 'var(--color-caramel)' : 'var(--color-text-primary)'"
              style="height: 40px; padding: 0 12px; font-family: var(--font-sans); font-size: 14px; font-weight: 500; text-align: left; background: transparent"
            >
              <span>{{ cat.name }}</span>
              @if (!cat.visible) {
                <span
                  style="font-family: var(--font-sans); font-size: 10px; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px"
                  >{{ 'admin.menu.hidden' | translate }}</span
                >
              }
            </button>
            <a
              [routerLink]="['/menu/categories', cat.id]"
              [title]="'common.change' | translate"
              class="flex items-center justify-center"
              style="width: 28px; height: 28px; color: var(--color-text-tertiary); margin-right: 2px; text-decoration: none"
            >
              ✎
            </a>
            <button
              type="button"
              (click)="deleteCategory(cat)"
              [title]="'admin.menu.deleteCategory' | translate"
              style="width: 28px; height: 28px; color: var(--color-berry); margin-right: 6px"
            >
              ×
            </button>
          </div>
        }
      </aside>

      <!-- Product table -->
      <section
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px; min-width: 0"
      >
        <header class="flex items-center justify-between">
          <h2
            style="font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            {{ selectedCategory()?.name ?? ('admin.menu.productsFallback' | translate) }}
          </h2>
          <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
            'admin.menu.itemsCount' | translate: { count: products().length }
          }}</span>
        </header>

        @if (!selectedCategoryId()) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.menu.select' | translate }}
          </p>
        } @else if (products().length === 0) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.menu.emptyCategory' | translate }}
          </p>
        }

        @if (products().length > 0) {
          <div style="overflow-x: auto; margin: 0 -4px; padding: 0 4px">
            <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans)">
              <thead>
                <tr>
                  <th
                    style="text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1px solid var(--color-border-light)"
                  >
                    {{ 'admin.menu.headers.name' | translate }}
                  </th>
                  <th
                    style="text-align: right; padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1px solid var(--color-border-light)"
                  >
                    {{ 'admin.menu.headers.price' | translate }}
                  </th>
                  <th
                    style="text-align: right; padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1px solid var(--color-border-light)"
                  >
                    {{ 'admin.menu.headers.prep' | translate }}
                  </th>
                  <th
                    style="text-align: center; padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1px solid var(--color-border-light)"
                  >
                    {{ 'admin.menu.headers.visible' | translate }}
                  </th>
                  <th style="border-bottom: 1px solid var(--color-border-light)"></th>
                </tr>
              </thead>
              <tbody>
                @for (p of products(); track p.id) {
                  <tr style="border-bottom: 1px solid var(--color-border-light)">
                    <td style="padding: 12px; font-size: 14px; color: var(--color-text-primary); font-weight: 500">
                      {{ p.name }}
                    </td>
                    <td style="padding: 12px; font-size: 14px; color: var(--color-text-primary); text-align: right">
                      {{ formatPrice(p.basePriceCents) }}
                    </td>
                    <td style="padding: 12px; font-size: 13px; color: var(--color-text-secondary); text-align: right">
                      {{ (p.prepTimeSeconds / 60).toFixed(0) }} {{ 'common.units.min' | translate }}
                    </td>
                    <td style="padding: 12px; text-align: center">
                      <input type="checkbox" [checked]="p.visible" (change)="toggleVisibility(p, $event)" />
                    </td>
                    <td style="padding: 12px; text-align: right">
                      <a
                        [routerLink]="['/menu/products', p.id, 'options']"
                        style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary); font-weight: 500; margin-right: 12px; text-decoration: none"
                      >
                        {{ 'admin.menu.product.options' | translate }}
                      </a>
                      <a
                        [routerLink]="['/menu/products', p.id]"
                        style="font-family: var(--font-sans); font-size: 12px; color: var(--color-caramel); font-weight: 500; margin-right: 12px; text-decoration: none"
                      >
                        {{ 'common.change' | translate }}
                      </a>
                      <button
                        type="button"
                        (click)="deleteProduct(p)"
                        style="font-family: var(--font-sans); font-size: 12px; color: var(--color-berry); font-weight: 500"
                      >
                        {{ 'admin.menu.product.deleteCta' | translate }}
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

    @if (error()) {
      <p style="padding: 0 24px 24px 24px; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
        {{ error() }}
      </p>
    }
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
  readonly activeBrand = inject(ActiveBrandService);

  /**
   * The menu is edited in the context of the brand picked in the top bar,
   * like every other admin page. It used to fetch its own brand list and
   * silently take the first entry, which meant a SUPER_ADMIN switching
   * brands kept editing the alphabetically-first one.
   */
  readonly brand = this.activeBrand.active;
  readonly categories = signal<CategoryAdminDto[]>([]);
  readonly selectedCategoryId = signal<string | null>(null);
  readonly products = signal<ProductAdminDto[]>([]);
  /** `?category=` — which category to open, set when returning from a form. */
  readonly category = input<string | undefined>();
  readonly error = signal<string | null>(null);

  readonly selectedCategory = computed(() => this.categories().find((c) => c.id === this.selectedCategoryId()) ?? null);

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
      this.categories.set([]);
      this.products.set([]);
      this.selectedCategoryId.set(null);
      this.error.set(null);
      if (!brand) return;
      this.loadCategories(brand.id);
    });
  }

  selectCategory(id: string): void {
    this.selectedCategoryId.set(id);
    this.loadProducts(id);
  }

  deleteCategory(cat: CategoryAdminDto): void {
    const msg = this.translate.instant('admin.menu.deleteCategoryConfirm', { name: cat.name });
    if (!confirm(msg)) return;
    const brand = this.brand();
    this.api.deleteCategory(cat.id).subscribe({
      next: () => {
        if (this.selectedCategoryId() === cat.id) {
          this.selectedCategoryId.set(null);
          this.products.set([]);
        }
        if (brand) this.loadCategories(brand.id);
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  toggleVisibility(product: ProductAdminDto, event: Event): void {
    const visible = (event.target as HTMLInputElement).checked;
    this.api.toggleProductVisibility(product.id, visible).subscribe({
      next: () => {
        const current = this.selectedCategoryId();
        if (current) this.loadProducts(current);
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  deleteProduct(product: ProductAdminDto): void {
    const msg = this.translate.instant('admin.menu.product.deleteConfirm', { name: product.name });
    if (!confirm(msg)) return;
    this.api.deleteProduct(product.id).subscribe({
      next: () => {
        const current = this.selectedCategoryId();
        if (current) this.loadProducts(current);
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  formatPrice(cents: number): string {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: this.brand()?.currency ?? 'USD',
    }).format(cents / 100);
  }

  private loadCategories(brandId: string): void {
    this.api.listCategories(brandId).subscribe({
      next: (list) => {
        this.categories.set(list);
        if (this.selectedCategoryId()) return;
        // Coming back from a product form, `?category=` says which category
        // the user was in — otherwise open the first one.
        const wanted = list.find((c) => c.id === this.category()) ?? list[0];
        if (wanted) this.selectCategory(wanted.id);
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  private loadProducts(categoryId: string): void {
    const brand = this.brand();
    if (!brand) return;
    this.api.listProducts(brand.id, categoryId).subscribe({
      next: (list) => this.products.set(list),
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  private extractMessage(err: unknown): string {
    return extractMessage(err) ?? this.translate.instant('common.requestFailed');
  }
}
