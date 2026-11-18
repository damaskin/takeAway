import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { CategoryKind } from '@takeaway/shared-types';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import {
  AdminCatalogApi,
  type CategoryAdminDto,
  type ProductDetailDto,
} from '../../core/catalog/admin-catalog.service';
import { OnboardingFlowService } from '../../core/onboarding/onboarding-flow.service';
import { describeMenuError } from './menu-errors';
import { ProductFormComponent, type ProductSavedEvent } from './product-form.component';
import { ProductOptionGroupsComponent } from './product-option-groups.component';

/**
 * Create or edit a product, on its own route. An existing product also
 * gets «Варианты и добавки» — its groups from the options catalog, the only
 * options there are; without a variant and an add-on it is not shown to
 * customers, and the block says so.
 *
 * The form used to open above the product table, inside the right-hand
 * column of the menu page. It owns the page now, and `?categoryId=` carries
 * the category the user was looking at so a new product lands there.
 */
@Component({
  selector: 'app-product-form-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ProductFormComponent, ProductOptionGroupsComponent],
  template: `
    <section style="padding: clamp(16px, 3vw, 28px); max-width: 960px; margin: 0 auto">
      <a
        [routerLink]="['/menu']"
        [queryParams]="{ category: categoryId() }"
        class="flex items-center"
        style="gap: 6px; width: fit-content; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-secondary); text-decoration: none; margin-bottom: 14px"
      >
        <span aria-hidden="true">←</span>
        <span>{{ 'admin.menu.title' | translate }}</span>
      </a>

      @if (loading()) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      } @else if (error(); as message) {
        <p role="alert" style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
          {{ message }}
        </p>
      } @else if (brandId(); as brand) {
        <app-product-form
          [product]="product()"
          [categoryId]="categoryId()"
          [categories]="categories()"
          [brandId]="brand"
          [currency]="currency()"
          (saved)="onSaved($event)"
          (imagesChanged)="onImagesChanged()"
          (closed)="back()"
        />

        @if (productId(); as id) {
          <app-product-option-groups
            style="display: block; margin-top: 16px"
            [productId]="id"
            [brandId]="brand"
            [basePriceCents]="product()?.basePriceCents ?? 0"
            [currency]="currency()"
            [categoryKind]="categoryKind()"
            (saved)="onOptionsSaved()"
          />
        } @else {
          <!-- A new product: the options are the next step, shown so nobody thinks there are none. -->
          <p
            role="note"
            data-testid="product-options-after-save"
            style="margin: 16px 0 0; padding: 12px 14px; background: var(--color-cream); border: 1px dashed var(--color-border-light); border-radius: 12px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            <strong style="color: var(--color-espresso)">{{ 'admin.optionsCatalog.product.title' | translate }}</strong>
            — {{ 'admin.optionsCatalog.product.afterSave' | translate }}
          </p>
        }
      }
    </section>
  `,
})
export class ProductFormPage {
  readonly productId = input<string | undefined>();
  /** Pre-selects the category the user was looking at, when there was one. */
  readonly category = input<string | undefined>();

  private readonly api = inject(AdminCatalogApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly onboarding = inject(OnboardingFlowService);

  readonly categories = signal<CategoryAdminDto[]>([]);
  readonly product = signal<ProductDetailDto | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly brandId = computed(() => this.activeBrand.activeId());
  readonly currency = computed(() => this.activeBrand.active()?.currency ?? null);
  readonly categoryId = computed(() => this.product()?.categoryId ?? this.category() ?? this.categories()[0]?.id ?? '');
  /** The category's kind: which catalog groups the options block offers (drinks, food, or all). */
  readonly categoryKind = computed<CategoryKind | null>(() => {
    const p = this.product();
    return p?.category?.kind ?? this.categories().find((c) => c.id === p?.categoryId)?.kind ?? null;
  });

  constructor() {
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) return;
      this.api.listCategories(brandId).subscribe({
        next: (list) => this.categories.set(list),
        error: (err: unknown) => this.error.set(describeMenuError(err, this.translate)),
      });
    });

    effect(() => {
      const id = this.productId();
      if (!id) {
        this.product.set(null);
        this.loading.set(false);
        return;
      }
      this.loading.set(true);
      this.api.getProduct(id).subscribe({
        next: (p) => {
          this.product.set(p);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(describeMenuError(err, this.translate));
        },
      });
    });
  }

  /**
   * A new product goes on to its options; an edit is done. Opened from
   * «Запуск бренда», a save that finishes the menu step goes back there.
   */
  onSaved(event: ProductSavedEvent): void {
    void this.onboarding.afterSave('menu').then((r) => {
      if (r === 'returned') return;
      if (event.created) {
        void this.router.navigate(['/menu/products', event.product.id]);
        return;
      }
      this.back();
    });
  }

  /** A variant and an add-on make the product one customers see: what the menu step waits for. */
  onOptionsSaved(): void {
    void this.onboarding.afterSave('menu');
  }

  /** The first photo is what the menu step waits for. */
  onImagesChanged(): void {
    void this.onboarding.afterSave('menu');
  }

  back(): void {
    this.router.navigate(['/menu'], { queryParams: { category: this.categoryId() } });
  }
}
