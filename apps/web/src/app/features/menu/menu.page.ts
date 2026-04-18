import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { StoreDetail, StoreMenu } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';

@Component({
  selector: 'app-web-menu',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="max-w-6xl mx-auto px-4 py-12">
      @if (store(); as s) {
        <header class="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 class="text-4xl" style="font-family: var(--font-display)">{{ s.name }}</h1>
            <p class="text-sm mt-1" style="opacity: 0.6">{{ s.addressLine }} · {{ s.city }}</p>
          </div>
          <span
            class="text-sm px-4 py-2 font-medium"
            style="background: var(--color-espresso); color: white; border-radius: var(--radius-pill)"
          >
            Ready in {{ etaMinutes(s) }} min
          </span>
        </header>
      }

      @if (menu(); as m) {
        @for (cat of m.categories; track cat.id) {
          <section class="mb-12">
            <h2 class="text-2xl mb-4" style="font-family: var(--font-display)">{{ cat.name }}</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              @for (p of cat.products; track p.id) {
                <a
                  [routerLink]="['/products', p.slug]"
                  class="block p-5 transition-opacity"
                  [class.opacity-50]="p.onStopList"
                  style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
                >
                  <h3 class="text-lg" style="font-family: var(--font-display)">{{ p.name }}</h3>
                  @if (p.description) {
                    <p class="text-sm mt-1 line-clamp-2" style="opacity: 0.6">{{ p.description }}</p>
                  }
                  <div class="mt-3 flex items-center justify-between text-sm">
                    <span class="font-medium">{{ price(p.basePriceCents) }}</span>
                    <span style="opacity: 0.5">⌛ {{ prepMinutes(p.prepTimeSeconds) }} min</span>
                  </div>
                  @if (p.onStopList) {
                    <p class="text-xs mt-2" style="color: var(--color-berry)">Out of stock today</p>
                  }
                </a>
              }
            </div>
          </section>
        }
      }

      @if (error()) {
        <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
      }
    </section>
  `,
})
export class MenuPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly catalog = inject(CatalogService);

  readonly store = signal<StoreDetail | null>(null);
  readonly menu = signal<StoreMenu | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        this.catalog.listStores().subscribe({
          next: (list) => {
            const first = list[0];
            if (first) this.loadStore(first.slug);
          },
        });
      } else {
        this.loadStore(slug);
      }
    });
  }

  etaMinutes(store: StoreDetail): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  prepMinutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
  }

  price(cents: number): string {
    const currency = this.store()?.currency ?? 'USD';
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }

  private loadStore(slug: string): void {
    this.error.set(null);
    this.catalog.getStore(slug).subscribe({
      next: (s) => this.store.set(s),
      error: () => this.error.set('Store not found'),
    });
    this.catalog.getMenu(slug).subscribe({
      next: (m) => this.menu.set(m),
      error: () => this.error.set('Menu not available'),
    });
  }
}
