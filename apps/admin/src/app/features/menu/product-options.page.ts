import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';
import { ProductOptionsPanelComponent } from './product-options-panel.component';

/**
 * Sizes, milks and add-ons for one product, on their own route.
 *
 * These used to expand inside a row of the product table, which put a form
 * with four controls into whatever width the table column had left.
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
        <span>{{ 'admin.menu.product.editTitle' | translate }}</span>
      </a>

      <header style="margin-bottom: 20px">
        <h1
          style="font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'admin.menu.options.title' | translate }}
        </h1>
        @if (productName(); as name) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 6px 0 0"
          >
            {{ name }}
          </p>
        }
      </header>

      <app-product-options-panel [productId]="productId()" />

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

  readonly productName = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.api.getProduct(this.productId()).subscribe({
        next: (p) => this.productName.set(p.name),
        error: (err) => this.error.set(extractMessage(err)),
      });
    });
  }
}
