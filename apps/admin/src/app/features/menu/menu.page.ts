import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  AdminCatalogApi,
  type BrandDto,
  type CategoryAdminDto,
  type ProductAdminDto,
} from '../../core/catalog/admin-catalog.service';
import { ProductOptionsPanelComponent } from './product-options-panel.component';

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
  imports: [ReactiveFormsModule, TranslatePipe, ProductOptionsPanelComponent],
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
    </div>

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
          <button
            type="button"
            (click)="openCategoryForm()"
            style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-caramel)"
          >
            {{ 'admin.menu.add' | translate }}
          </button>
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
            <button
              type="button"
              (click)="openCategoryEdit(cat)"
              [title]="'common.change' | translate"
              style="width: 28px; height: 28px; color: var(--color-text-tertiary); margin-right: 2px"
            >
              ✎
            </button>
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

        @if (categoryFormOpen()) {
          <form
            [formGroup]="categoryForm"
            (ngSubmit)="submitCategory()"
            class="flex flex-col"
            style="gap: 8px; margin-top: 12px"
          >
            <input
              formControlName="name"
              [placeholder]="'admin.menu.product.name' | translate"
              style="height: 38px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 13px"
            />
            <input
              formControlName="slug"
              [placeholder]="'admin.menu.product.slug' | translate"
              [readonly]="!!editingCategoryId()"
              style="height: 38px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-mono); font-size: 13px"
            />
            <label class="flex items-center" style="gap: 8px; font-family: var(--font-sans); font-size: 13px">
              <input type="checkbox" formControlName="visible" />
              <span>{{ 'admin.menu.fields.visible' | translate }}</span>
            </label>
            <div class="flex" style="gap: 8px">
              <button
                type="submit"
                [disabled]="categoryForm.invalid"
                class="flex-1 disabled:opacity-50"
                style="height: 36px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
              >
                {{ (editingCategoryId() ? 'common.save' : 'admin.menu.create') | translate }}
              </button>
              <button
                type="button"
                (click)="closeCategoryForm()"
                style="padding: 0 12px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
              >
                {{ 'common.cancel' | translate }}
              </button>
            </div>
          </form>
        }
      </aside>

      <!-- Product table -->
      <section
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 16px; min-width: 0; overflow-x: auto"
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
        } @else if (products().length === 0 && !productFormOpen()) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.menu.emptyCategory' | translate }}
          </p>
        }

        @if (products().length > 0) {
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
                  <td style="padding: 12px; text-align: right; white-space: nowrap">
                    <button
                      type="button"
                      (click)="toggleOptions(p.id)"
                      style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary); font-weight: 500; margin-right: 12px"
                    >
                      {{
                        (expandedProductId() === p.id ? 'admin.menu.product.hideOptions' : 'admin.menu.product.options')
                          | translate
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
                    <td colspan="5" style="padding: 0 12px 16px 12px">
                      <app-product-options-panel [productId]="p.id" />
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        }

        @if (productFormOpen()) {
          <form
            [formGroup]="productForm"
            (ngSubmit)="submitProduct()"
            class="grid"
            style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 12px; padding: 16px; background: var(--color-cream); border-radius: 16px"
          >
            <input
              formControlName="name"
              [placeholder]="'admin.menu.product.name' | translate"
              style="height: 40px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px"
            />
            <input
              formControlName="slug"
              [placeholder]="'admin.menu.product.slug' | translate"
              [readonly]="!!editingProductId()"
              style="height: 40px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-mono); font-size: 13px"
            />
            <input
              formControlName="basePriceCents"
              type="number"
              min="0"
              [placeholder]="'admin.menu.product.price' | translate"
              style="height: 40px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px"
            />
            <input
              formControlName="prepTimeSeconds"
              type="number"
              min="0"
              [placeholder]="'admin.menu.product.prep' | translate"
              style="height: 40px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px"
            />
            <textarea
              formControlName="description"
              [placeholder]="'admin.menu.product.description' | translate"
              rows="2"
              class="col-span-2"
              style="grid-column: span 2; padding: 10px 14px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px; resize: vertical"
            ></textarea>
            <div class="flex" style="grid-column: span 2; gap: 8px">
              <button
                type="submit"
                [disabled]="productForm.invalid"
                class="disabled:opacity-50"
                style="height: 40px; padding: 0 20px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >
                {{ (editingProductId() ? 'common.save' : 'admin.menu.product.createCta') | translate }}
              </button>
              <button
                type="button"
                (click)="closeProductForm()"
                style="padding: 0 16px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
              >
                {{ 'common.cancel' | translate }}
              </button>
            </div>
          </form>
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
      @media (max-width: 900px) {
        .menu-shell {
          grid-template-columns: 1fr !important;
        }
      }
    `,
  ],
})
export class MenuPage implements OnInit {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly brand = signal<BrandDto | null>(null);
  readonly categories = signal<CategoryAdminDto[]>([]);
  readonly selectedCategoryId = signal<string | null>(null);
  readonly products = signal<ProductAdminDto[]>([]);
  readonly categoryFormOpen = signal(false);
  readonly editingCategoryId = signal<string | null>(null);
  readonly productFormOpen = signal(false);
  readonly editingProductId = signal<string | null>(null);
  readonly expandedProductId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly selectedCategory = computed(() => this.categories().find((c) => c.id === this.selectedCategoryId()) ?? null);

  readonly categoryForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)],
    }),
    visible: new FormControl(true, { nonNullable: true }),
  });

  readonly productForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)],
    }),
    basePriceCents: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    prepTimeSeconds: new FormControl(180, { nonNullable: true, validators: [Validators.min(0)] }),
    description: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    this.api.listMyBrands().subscribe({
      next: (brands) => {
        const first = brands[0];
        if (!first) return;
        this.brand.set(first);
        this.loadCategories(first.id);
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  selectCategory(id: string): void {
    this.selectedCategoryId.set(id);
    this.productFormOpen.set(false);
    this.loadProducts(id);
  }

  openCategoryForm(): void {
    this.editingCategoryId.set(null);
    this.categoryForm.reset({ name: '', slug: '', visible: true });
    this.categoryFormOpen.set(true);
  }

  openCategoryEdit(cat: CategoryAdminDto): void {
    this.editingCategoryId.set(cat.id);
    this.categoryForm.reset({ name: cat.name, slug: cat.slug, visible: cat.visible });
    this.categoryFormOpen.set(true);
  }

  closeCategoryForm(): void {
    this.categoryFormOpen.set(false);
    this.editingCategoryId.set(null);
  }

  openProductForm(): void {
    this.editingProductId.set(null);
    this.productForm.reset({ name: '', slug: '', basePriceCents: 0, prepTimeSeconds: 180, description: '' });
    this.productFormOpen.set(true);
  }

  openProductEdit(p: ProductAdminDto): void {
    this.editingProductId.set(p.id);
    this.productForm.reset({
      name: p.name,
      slug: p.slug,
      basePriceCents: p.basePriceCents,
      prepTimeSeconds: p.prepTimeSeconds,
      description: p.description ?? '',
    });
    this.productFormOpen.set(true);
  }

  closeProductForm(): void {
    this.productFormOpen.set(false);
    this.editingProductId.set(null);
  }

  toggleOptions(productId: string): void {
    this.expandedProductId.update((cur) => (cur === productId ? null : productId));
  }

  submitCategory(): void {
    if (this.categoryForm.invalid) return;
    const brand = this.brand();
    if (!brand) return;
    const { name, slug, visible } = this.categoryForm.getRawValue();
    const editingId = this.editingCategoryId();
    if (editingId) {
      this.api.updateCategory(editingId, { name, visible }).subscribe({
        next: () => {
          this.closeCategoryForm();
          this.loadCategories(brand.id);
        },
        error: (err) => this.error.set(this.extractMessage(err)),
      });
      return;
    }
    this.api.createCategory({ brandId: brand.id, name, slug, sortOrder: this.categories().length }).subscribe({
      next: () => {
        this.closeCategoryForm();
        this.loadCategories(brand.id);
      },
      error: (err) => this.error.set(this.extractMessage(err)),
    });
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

  submitProduct(): void {
    if (this.productForm.invalid) return;
    const brand = this.brand();
    const categoryId = this.selectedCategoryId();
    if (!brand || !categoryId) return;
    const v = this.productForm.getRawValue();
    const editingId = this.editingProductId();
    if (editingId) {
      this.api
        .updateProduct(editingId, {
          name: v.name,
          basePriceCents: Number(v.basePriceCents),
          prepTimeSeconds: Number(v.prepTimeSeconds),
          description: v.description || null,
        })
        .subscribe({
          next: () => {
            this.closeProductForm();
            this.loadProducts(categoryId);
          },
          error: (err) => this.error.set(this.extractMessage(err)),
        });
      return;
    }
    this.api
      .createProduct({
        brandId: brand.id,
        categoryId,
        name: v.name,
        slug: v.slug,
        basePriceCents: Number(v.basePriceCents),
        prepTimeSeconds: Number(v.prepTimeSeconds),
        description: v.description || undefined,
      })
      .subscribe({
        next: () => {
          this.closeProductForm();
          this.loadProducts(categoryId);
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
        if (!this.selectedCategoryId() && list[0]) {
          this.selectCategory(list[0].id);
        }
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
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.requestFailed');
  }
}
