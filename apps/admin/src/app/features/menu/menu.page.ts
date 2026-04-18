import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  AdminCatalogApi,
  type BrandDto,
  type CategoryAdminDto,
  type ProductAdminDto,
} from '../../core/catalog/admin-catalog.service';

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <header class="flex items-center justify-between mb-8">
      <h1 class="text-3xl" style="font-family: var(--font-display)">Menu</h1>
      @if (brand()) {
        <span class="text-sm" style="opacity: 0.6">{{ brand()?.name }}</span>
      }
    </header>

    <div class="grid grid-cols-[320px_1fr] gap-6">
      <aside
        class="p-4"
        style="background: var(--color-cream); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
      >
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg" style="font-family: var(--font-display)">Categories</h2>
          <button type="button" (click)="openCategoryForm()" class="text-sm underline">+ Add</button>
        </div>

        @if (categories().length === 0) {
          <p class="text-sm" style="opacity: 0.6">No categories yet.</p>
        }

        <ul class="flex flex-col gap-1">
          @for (cat of categories(); track cat.id) {
            <li>
              <button
                type="button"
                (click)="selectCategory(cat.id)"
                class="w-full flex items-center justify-between px-3 py-2 text-left rounded-lg hover:bg-[var(--color-latte)]/50"
                [style.background]="selectedCategoryId() === cat.id ? 'var(--color-latte)' : null"
              >
                <span>{{ cat.name }}</span>
                <span class="text-xs" style="opacity: 0.5">{{ cat.visible ? '' : 'hidden' }}</span>
              </button>
            </li>
          }
        </ul>

        @if (categoryFormOpen()) {
          <form [formGroup]="categoryForm" (ngSubmit)="createCategory()" class="mt-4 flex flex-col gap-2">
            <input
              formControlName="name"
              placeholder="Category name"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
            <input
              formControlName="slug"
              placeholder="slug (kebab-case)"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
            <div class="flex gap-2">
              <button
                type="submit"
                [disabled]="categoryForm.invalid"
                class="flex-1 py-2 font-medium disabled:opacity-50"
                style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
              >
                Create
              </button>
              <button type="button" (click)="categoryFormOpen.set(false)" class="py-2 px-4 text-sm">Cancel</button>
            </div>
          </form>
        }
      </aside>

      <section
        class="p-4"
        style="background: var(--color-cream); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
      >
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg" style="font-family: var(--font-display)">
            {{ selectedCategory()?.name ?? 'Products' }}
          </h2>
          @if (selectedCategoryId()) {
            <button type="button" (click)="openProductForm()" class="text-sm underline">+ Add product</button>
          }
        </div>

        @if (!selectedCategoryId()) {
          <p class="text-sm" style="opacity: 0.6">Select a category to see its products.</p>
        } @else if (products().length === 0 && !productFormOpen()) {
          <p class="text-sm" style="opacity: 0.6">No products in this category.</p>
        }

        @if (products().length > 0) {
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left" style="opacity: 0.6">
                <th class="py-2 pr-4">Name</th>
                <th class="py-2 pr-4">Price</th>
                <th class="py-2 pr-4">Prep time</th>
                <th class="py-2 pr-4">Visible</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (p of products(); track p.id) {
                <tr class="border-t" style="border-color: var(--color-latte)">
                  <td class="py-2 pr-4">{{ p.name }}</td>
                  <td class="py-2 pr-4">{{ formatPrice(p.basePriceCents) }}</td>
                  <td class="py-2 pr-4">{{ (p.prepTimeSeconds / 60).toFixed(0) }} min</td>
                  <td class="py-2 pr-4">
                    <input type="checkbox" [checked]="p.visible" (change)="toggleVisibility(p, $event)" />
                  </td>
                  <td class="py-2 text-right">
                    <button type="button" (click)="deleteProduct(p)" class="text-xs" style="color: var(--color-berry)">
                      Delete
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }

        @if (productFormOpen()) {
          <form [formGroup]="productForm" (ngSubmit)="createProduct()" class="mt-4 grid grid-cols-2 gap-3">
            <input
              formControlName="name"
              placeholder="Product name"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
            <input
              formControlName="slug"
              placeholder="slug (kebab-case)"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
            <input
              formControlName="basePriceCents"
              type="number"
              min="0"
              placeholder="Price in cents"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
            <input
              formControlName="prepTimeSeconds"
              type="number"
              min="0"
              placeholder="Prep time (seconds)"
              class="px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
            <textarea
              formControlName="description"
              placeholder="Description"
              rows="2"
              class="col-span-2 px-3 py-2 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            ></textarea>
            <div class="col-span-2 flex gap-2">
              <button
                type="submit"
                [disabled]="productForm.invalid"
                class="flex-1 py-2 font-medium disabled:opacity-50"
                style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
              >
                Create product
              </button>
              <button type="button" (click)="productFormOpen.set(false)" class="py-2 px-4 text-sm">Cancel</button>
            </div>
          </form>
        }
      </section>
    </div>

    @if (error()) {
      <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
    }
  `,
})
export class MenuPage implements OnInit {
  private readonly api = inject(AdminCatalogApi);

  readonly brand = signal<BrandDto | null>(null);
  readonly categories = signal<CategoryAdminDto[]>([]);
  readonly selectedCategoryId = signal<string | null>(null);
  readonly products = signal<ProductAdminDto[]>([]);
  readonly categoryFormOpen = signal(false);
  readonly productFormOpen = signal(false);
  readonly error = signal<string | null>(null);

  readonly selectedCategory = computed(() => this.categories().find((c) => c.id === this.selectedCategoryId()) ?? null);

  readonly categoryForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)],
    }),
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
    this.api.listBrands().subscribe({
      next: (brands) => {
        const first = brands[0];
        if (!first) return;
        this.brand.set(first);
        this.loadCategories(first.id);
      },
      error: (err) => this.error.set(extractMessage(err)),
    });
  }

  selectCategory(id: string): void {
    this.selectedCategoryId.set(id);
    this.productFormOpen.set(false);
    this.loadProducts(id);
  }

  openCategoryForm(): void {
    this.categoryForm.reset();
    this.categoryFormOpen.set(true);
  }

  openProductForm(): void {
    this.productForm.reset({ name: '', slug: '', basePriceCents: 0, prepTimeSeconds: 180, description: '' });
    this.productFormOpen.set(true);
  }

  createCategory(): void {
    if (this.categoryForm.invalid) return;
    const brand = this.brand();
    if (!brand) return;
    const { name, slug } = this.categoryForm.getRawValue();
    this.api.createCategory({ brandId: brand.id, name, slug, sortOrder: this.categories().length }).subscribe({
      next: () => {
        this.categoryFormOpen.set(false);
        this.loadCategories(brand.id);
      },
      error: (err) => this.error.set(extractMessage(err)),
    });
  }

  createProduct(): void {
    if (this.productForm.invalid) return;
    const brand = this.brand();
    const categoryId = this.selectedCategoryId();
    if (!brand || !categoryId) return;
    const v = this.productForm.getRawValue();
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
          this.productFormOpen.set(false);
          this.loadProducts(categoryId);
        },
        error: (err) => this.error.set(extractMessage(err)),
      });
  }

  toggleVisibility(product: ProductAdminDto, event: Event): void {
    const visible = (event.target as HTMLInputElement).checked;
    this.api.toggleProductVisibility(product.id, visible).subscribe({
      next: () => {
        const current = this.selectedCategoryId();
        if (current) this.loadProducts(current);
      },
      error: (err) => this.error.set(extractMessage(err)),
    });
  }

  deleteProduct(product: ProductAdminDto): void {
    if (!confirm(`Delete ${product.name}?`)) return;
    this.api.deleteProduct(product.id).subscribe({
      next: () => {
        const current = this.selectedCategoryId();
        if (current) this.loadProducts(current);
      },
      error: (err) => this.error.set(extractMessage(err)),
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
      error: (err) => this.error.set(extractMessage(err)),
    });
  }

  private loadProducts(categoryId: string): void {
    const brand = this.brand();
    if (!brand) return;
    this.api.listProducts(brand.id, categoryId).subscribe({
      next: (list) => this.products.set(list),
      error: (err) => this.error.set(extractMessage(err)),
    });
  }
}

function extractMessage(err: unknown): string {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return 'Request failed';
}
