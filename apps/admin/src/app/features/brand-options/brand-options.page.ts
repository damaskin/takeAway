import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { BrandOptionCatalogComponent } from './brand-option-catalog.component';

/**
 * «Добавки»: the options catalog as the brand sees it — what it has, the
 * price of each add-on for the whole brand, the variant prices its product
 * cards set (read-only here), and per store what has run out. The older
 * add-in library is gone (2026-11-18).
 */
@Component({
  selector: 'app-brand-options',
  standalone: true,
  imports: [TranslatePipe, BrandOptionCatalogComponent],
  template: `
    <div
      class="flex items-center flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px 16px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.ingredients.title' | translate }}
      </h1>
      @if (brand(); as b) {
        <span
          class="flex items-center"
          style="height: 26px; padding: 0 10px; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
          >{{ b.name }}</span
        >
      }
    </div>

    <section style="padding: clamp(16px, 3vw, 24px); max-width: 880px">
      @if (brand(); as b) {
        <app-brand-option-catalog [brandId]="b.id" [currency]="b.currency" />
      } @else if (brandsLoaded()) {
        <p style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
          {{ 'admin.optionsCatalog.brand.noBrand' | translate }}
        </p>
      }
    </section>
  `,
})
export class BrandOptionsPage {
  private readonly activeBrand = inject(ActiveBrandService);

  readonly brand = this.activeBrand.active;
  readonly brandsLoaded = computed(() => this.activeBrand.loaded());
}
