import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { describeMenuError } from './menu-errors';
import { ProductOptionsPanelComponent } from './product-options-panel.component';

/**
 * Sizes, milks and add-ons for one product, on their own route.
 *
 * These used to expand inside a row of the product table, which put a form
 * with four controls into whatever width the table column had left.
 *
 * Since 2026-11-09 a product with groups from the options catalog is sold
 * through them only; for such a product this page says so instead of
 * offering the older options.
 */
@Component({
  selector: 'app-product-options',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ProductOptionsPanelComponent],
  template: `
    <section style="padding: clamp(16px, 3vw, 28px); max-width: 960px; margin: 0 auto">
      <a
        [routerLink]="['/menu/products', productId()]"
        class="flex items-center"
        style="gap: 6px; width: fit-content; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-secondary); text-decoration: none; margin-bottom: 14px"
      >
        <span aria-hidden="true">←</span>
        <span>{{ 'admin.menu.product.options' | translate }}</span>
      </a>

      <header style="margin-bottom: 20px">
        <h1
          style="font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'admin.menu.product.options' | translate }}
        </h1>
        @if (productName(); as name) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 6px 0 0"
          >
            {{ name }}
          </p>
        }
      </header>

      @if (catalogGroups() > 0) {
        <div
          class="flex flex-col"
          style="gap: 10px; padding: 14px 16px; background: var(--color-foam); border-left: 3px solid var(--color-mint); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
          role="note"
          data-testid="legacy-options-note"
        >
          <span>{{ 'admin.optionsCatalog.product.legacyNote' | translate }}</span>
          <a
            [routerLink]="['/menu/products', productId()]"
            style="width: fit-content; font-weight: 600; color: var(--color-caramel); text-decoration: none"
            >{{ 'admin.optionsCatalog.product.toCatalog' | translate }}</a
          >
        </div>
      } @else if (catalogChecked()) {
        <app-product-options-panel [productId]="productId()" [currency]="currency()" />
      }

      @if (error(); as message) {
        <p role="alert" style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
          {{ message }}
        </p>
      }
    </section>
  `,
})
export class ProductOptionsPage {
  readonly productId = input.required<string>();

  private readonly api = inject(AdminCatalogApi);
  private readonly options = inject(OptionCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly productName = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly currency = computed(() => this.activeBrand.active()?.currency ?? null);
  /** Catalog groups on the product: then these older options do not apply and are not offered. */
  readonly catalogGroups = signal(0);
  readonly catalogChecked = signal(false);

  constructor() {
    effect(() => {
      const id = this.productId();
      this.api.getProduct(id).subscribe({
        next: (p) => this.productName.set(p.name),
        error: (err: unknown) => this.error.set(describeMenuError(err, this.translate)),
      });
      this.catalogChecked.set(false);
      // An API without the catalog answers an error: the older editor stays.
      this.options.productGroups(id).subscribe({
        next: (config) => {
          this.catalogGroups.set(config.groups?.length ?? 0);
          this.catalogChecked.set(true);
        },
        error: () => {
          this.catalogGroups.set(0);
          this.catalogChecked.set(true);
        },
      });
    });
  }
}
