import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';

import { AdminCatalogApi, type CategoryAdminDto, type ProductAdminDto } from '../../core/catalog/admin-catalog.service';
import { DASH_CARD_STYLES } from '../../shared/dash-card.styles';

/** The menu at a glance — what is on it, what is hidden, what has no photo — with a way in. */
@Component({
  selector: 'app-menu-summary-widget',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <article class="dash-card">
      <header class="dash-card-head">
        <h2>{{ 'admin.dashboard.menu.title' | translate }}</h2>
        <a routerLink="/menu">{{ 'admin.dashboard.menu.open' | translate }}</a>
      </header>
      @if (summary(); as m) {
        <div class="menu-grid">
          <div>
            <span class="menu-value">{{ m.products }}</span>
            <span class="menu-label">{{ 'admin.dashboard.menu.products' | translate }}</span>
          </div>
          <div>
            <span class="menu-value">{{ m.categories }}</span>
            <span class="menu-label">{{ 'admin.dashboard.menu.categories' | translate }}</span>
          </div>
          <div [class.menu-warn]="m.hidden > 0">
            <span class="menu-value">{{ m.hidden }}</span>
            <span class="menu-label">{{ 'admin.dashboard.menu.hidden' | translate }}</span>
          </div>
          <div [class.menu-warn]="m.noPhoto > 0">
            <span class="menu-value">{{ m.noPhoto }}</span>
            <span class="menu-label">{{ 'admin.dashboard.menu.noPhoto' | translate }}</span>
          </div>
        </div>
      } @else {
        <p class="dash-muted">{{ 'common.loading' | translate }}</p>
      }
    </article>
  `,
  styles: [
    DASH_CARD_STYLES,
    `
      :host {
        display: block;
      }
      .menu-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .menu-grid > div {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 12px;
        border-radius: 14px;
        background: var(--color-cream);
      }
      .menu-value {
        font-family: var(--font-display);
        font-size: 22px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .menu-label {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .menu-warn .menu-value {
        color: #8a6720;
      }
    `,
  ],
})
export class MenuSummaryWidgetComponent {
  private readonly catalog = inject(AdminCatalogApi);

  readonly brandId = input.required<string>();

  private readonly categories = signal<CategoryAdminDto[] | null>(null);
  private readonly products = signal<ProductAdminDto[] | null>(null);

  readonly summary = computed(() => {
    const categories = this.categories();
    const products = this.products();
    if (!categories || !products) return null;
    return {
      categories: categories.length,
      products: products.length,
      hidden: products.filter((p) => !p.visible).length,
      noPhoto: products.filter((p) => p.imageUrls.length === 0).length,
    };
  });

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      untracked(() =>
        forkJoin([this.catalog.listCategories(brandId), this.catalog.listProducts(brandId)]).subscribe({
          next: ([categories, products]) => {
            this.categories.set(categories);
            this.products.set(products);
          },
        }),
      );
    });
  }
}
