import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { IngredientsPage } from '../ingredients/ingredients.page';
import { BrandOptionCatalogComponent } from './brand-option-catalog.component';

type Tab = 'catalog' | 'legacy';

/**
 * «Добавки» since 2026-11-09: the options catalog as the brand sees it.
 *
 * The old add-in library stays reachable as a second tab, «Старые
 * добавки», only while the brand still has entries in it — they keep
 * working on products without catalog groups until the takeAway team
 * clears them. The platform team reads the count from the legacy summary
 * (`GET /admin/brands/:id/legacy-options`, SUPER_ADMIN only); a brand's
 * roles from the library itself. `?tab=legacy` opens the old tab.
 */
@Component({
  selector: 'app-brand-options',
  standalone: true,
  imports: [TranslatePipe, BrandOptionCatalogComponent, IngredientsPage],
  styles: [
    `
      .tab {
        height: 34px;
        padding: 0 14px;
        border-radius: 9999px;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-secondary);
        background: transparent;
        border: 1px solid var(--color-border-light);
      }
      .tab.active {
        background: var(--color-caramel);
        color: white;
        border-color: transparent;
      }
    `,
  ],
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

    @if (legacyCount() > 0) {
      <div
        class="flex items-center flex-wrap"
        style="gap: 8px; padding: clamp(16px, 3vw, 24px) clamp(16px, 3vw, 24px) 0"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          class="tab"
          [class.active]="tab() === 'catalog'"
          [attr.aria-selected]="tab() === 'catalog'"
          (click)="pick('catalog')"
          data-testid="brand-options-tab-catalog"
        >
          {{ 'admin.optionsCatalog.brand.tabCatalog' | translate }}
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          [class.active]="tab() === 'legacy'"
          [attr.aria-selected]="tab() === 'legacy'"
          (click)="pick('legacy')"
          data-testid="brand-options-tab-legacy"
        >
          {{ 'admin.optionsCatalog.brand.tabLegacy' | translate: { count: legacyCount() } }}
        </button>
      </div>
    }

    @if (tab() === 'legacy') {
      <p
        class="hint"
        style="margin: 12px clamp(16px, 3vw, 24px) 0; max-width: 880px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
      >
        {{ 'admin.optionsCatalog.brand.legacyHint' | translate }}
      </p>
      <app-ingredients [embedded]="true" />
    } @else {
      <section style="padding: clamp(16px, 3vw, 24px); max-width: 880px">
        @if (brand(); as b) {
          <app-brand-option-catalog [brandId]="b.id" [currency]="b.currency" />
        } @else if (brandsLoaded()) {
          <p style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
            {{ 'admin.optionsCatalog.brand.noBrand' | translate }}
          </p>
        }
      </section>
    }
  `,
})
export class BrandOptionsPage {
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly auth = inject(AuthStore);
  private readonly options = inject(OptionCatalogApi);
  private readonly catalog = inject(AdminCatalogApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly brand = this.activeBrand.active;
  readonly brandsLoaded = computed(() => this.activeBrand.loaded());
  /** Entries left in the old add-in library; 0 hides its tab. */
  readonly legacyCount = signal(0);
  private readonly picked = signal<Tab>(
    this.route.snapshot.queryParamMap.get('tab') === 'legacy' ? 'legacy' : 'catalog',
  );
  readonly tab = computed<Tab>(() => (this.legacyCount() > 0 ? this.picked() : 'catalog'));

  constructor() {
    effect(() => {
      const brandId = this.activeBrand.activeId();
      untracked(() => this.countLegacy(brandId));
    });
  }

  pick(tab: Tab): void {
    this.picked.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'legacy' ? 'legacy' : null },
      replaceUrl: true,
    });
  }

  private countLegacy(brandId: string | null): void {
    this.legacyCount.set(0);
    if (!brandId) return;
    const done = (count: number) => {
      if (this.activeBrand.activeId() === brandId) this.legacyCount.set(count);
    };
    if (this.auth.user()?.role === 'SUPER_ADMIN') {
      this.options.legacySummary(brandId).subscribe({ next: (s) => done(s.ingredients), error: () => done(0) });
    } else {
      this.catalog.listIngredients(brandId).subscribe({ next: (list) => done(list.length), error: () => done(0) });
    }
  }
}
