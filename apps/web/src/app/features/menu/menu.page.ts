import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { CategoryWithProducts, ProductSummary, StoreDetail, StoreMenu } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';

/**
 * Web Menu / Catalog — pencil A2 (Y9Imj).
 *
 * Structure:
 *   storeBar (56px, foam)   — pin + store name + "Изменить" + quick category chips
 *   menuBody (sidebar + main)
 *     sidebar (240px, foam) — sticky category rail with caramel-light highlight on active
 *     mainContent (cream)   — category title + count + product card grid (3 per row)
 *   etaBanner (48px, caramel) — "Ready in X min" + "Start prep at HH:MM"
 */
@Component({
  selector: 'app-web-menu',
  standalone: true,
  imports: [RouterLink],
  template: `
    <!-- Store bar — pencil EVEFd -->
    <div
      class="flex items-center"
      style="background: var(--color-foam); height: 56px; padding: 0 48px; border-bottom: 1px solid var(--color-border-light); gap: 16px"
    >
      @if (store(); as s) {
        <span style="color: var(--color-caramel); font-size: 18px">📍</span>
        <span
          style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
          >{{ s.name }}</span
        >
        <a
          routerLink="/stores"
          style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-caramel)"
          >Change</a
        >
        <span style="width: 1px; height: 24px; background: var(--color-border)"></span>
      }

      <div class="flex items-center" style="gap: 8px; overflow-x: auto">
        @for (cat of categories(); track cat.id; let i = $index) {
          <button
            type="button"
            (click)="scrollToCategory(cat.id)"
            class="flex items-center whitespace-nowrap"
            [style.background]="activeCategoryId() === cat.id ? 'var(--color-caramel)' : 'transparent'"
            [style.color]="activeCategoryId() === cat.id ? 'var(--color-foam)' : 'var(--color-text-primary)'"
            style="height: 28px; padding: 0 12px; border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
          >
            {{ categoryEmoji(i) }} {{ cat.name }}
          </button>
        }
      </div>
    </div>

    <!-- Body: sidebar + main content -->
    <div class="flex" style="min-height: calc(100vh - 72px - 56px - 48px)">
      <!-- Sidebar — pencil i92Sa -->
      <aside
        class="flex flex-col"
        style="width: 240px; background: var(--color-foam); border-right: 1px solid var(--color-border-light); padding: 24px 16px; gap: 4px; position: sticky; top: 128px; align-self: flex-start; max-height: calc(100vh - 128px); overflow-y: auto"
      >
        <div style="padding: 0 12px 12px 12px">
          <span
            style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; letter-spacing: 1px; color: var(--color-text-tertiary)"
            >CATEGORIES</span
          >
        </div>
        @for (cat of categories(); track cat.id; let i = $index) {
          <button
            type="button"
            (click)="scrollToCategory(cat.id)"
            class="flex items-center w-full"
            [style.background]="activeCategoryId() === cat.id ? 'var(--color-caramel-light)' : 'transparent'"
            [style.color]="activeCategoryId() === cat.id ? 'var(--color-caramel)' : 'var(--color-text-secondary)'"
            style="height: 42px; padding: 0 12px; border-radius: 10px; gap: 10px; font-family: var(--font-sans); font-size: 14px; font-weight: 600; text-align: left"
          >
            <span style="font-size: 18px">{{ categoryEmoji(i) }}</span>
            <span>{{ cat.name }}</span>
          </button>
        }
      </aside>

      <!-- Main content — pencil QKAH4 -->
      <main class="flex-1 flex flex-col" style="background: var(--color-cream); padding: 32px; gap: 24px">
        @for (cat of categories(); track cat.id) {
          <section [attr.id]="'cat-' + cat.id">
            <header class="flex items-center justify-between" style="margin-bottom: 20px">
              <h2
                style="font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-espresso)"
              >
                {{ cat.name }}
              </h2>
              <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-tertiary)"
                >{{ cat.products.length }} items</span
              >
            </header>

            <div class="grid" style="grid-template-columns: repeat(3, 1fr); gap: 20px">
              @for (p of cat.products; track p.id) {
                <a
                  [routerLink]="['/products', p.slug]"
                  class="flex flex-col transition-all"
                  [class.opacity-50]="p.onStopList"
                  style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-card); overflow: hidden"
                  [style.cursor]="p.onStopList ? 'not-allowed' : 'pointer'"
                >
                  <div
                    [style.background]="productImageBg(p)"
                    style="height: 180px; background-size: cover; background-position: center"
                  ></div>
                  <div class="flex flex-col" style="padding: 14px; gap: 6px">
                    <span
                      style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-text-primary)"
                      >{{ p.name }}</span
                    >
                    @if (p.description) {
                      <span
                        class="line-clamp-2"
                        style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
                        >{{ p.description }}</span
                      >
                    }
                    <div class="flex items-center justify-between" style="margin-top: 2px">
                      <span
                        style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-caramel)"
                        >{{ price(p.basePriceCents) }}</span
                      >
                      @if (p.onStopList) {
                        <span
                          style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-berry)"
                          >Sold out</span
                        >
                      } @else {
                        <span
                          class="flex items-center justify-center"
                          style="width: 32px; height: 32px; border-radius: 9999px; background: var(--color-caramel); color: white; font-size: 18px; font-weight: 700"
                          >+</span
                        >
                      }
                    </div>
                  </div>
                </a>
              }
            </div>
          </section>
        }

        @if (error()) {
          <p class="text-sm" style="color: var(--color-berry)">{{ error() }}</p>
        }
      </main>
    </div>

    <!-- ETA banner — pencil 5zeiK -->
    @if (store(); as s) {
      <div
        class="flex items-center justify-between"
        style="background: var(--color-caramel); height: 48px; padding: 0 48px; color: var(--color-foam)"
      >
        <div class="flex items-center" style="gap: 8px">
          <span style="font-size: 16px">⏱</span>
          <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 600"
            >Ready in {{ etaMinutes(s) }} min</span
          >
        </div>
        <span style="font-family: var(--font-sans); font-size: 12px; color: #f8f3ebcc"
          >We start prepping at {{ startPrepAt(s) }}</span
        >
      </div>
    }
  `,
})
export class MenuPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly catalog = inject(CatalogService);

  readonly store = signal<StoreDetail | null>(null);
  readonly menu = signal<StoreMenu | null>(null);
  readonly error = signal<string | null>(null);
  readonly activeCategoryId = signal<string | null>(null);

  readonly categories = computed<CategoryWithProducts[]>(() => this.menu()?.categories ?? []);

  private readonly emojiByIndex = ['☕', '🍵', '✨', '🍳', '🥪', '🍰', '🥤', '🍪'];

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

  scrollToCategory(id: string): void {
    this.activeCategoryId.set(id);
    const el = document.getElementById('cat-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  categoryEmoji(idx: number): string {
    return this.emojiByIndex[idx % this.emojiByIndex.length] ?? '☕';
  }

  etaMinutes(store: StoreDetail): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  startPrepAt(store: StoreDetail): string {
    const target = new Date(Date.now() + Math.max(0, store.currentEtaSeconds) * 1000);
    return target.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  price(cents: number): string {
    const currency = this.store()?.currency ?? 'USD';
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }

  productImageBg(p: ProductSummary): string {
    const url = p.imageUrls?.[0];
    if (url) return `url('${url}')`;
    // Fallback: warm cream gradient so empty cards still look finished.
    return 'linear-gradient(135deg, var(--color-latte) 0%, var(--color-cream) 100%)';
  }

  private loadStore(slug: string): void {
    this.error.set(null);
    this.catalog.getStore(slug).subscribe({
      next: (s) => this.store.set(s),
      error: () => this.error.set('Store not found'),
    });
    this.catalog.getMenu(slug).subscribe({
      next: (m) => {
        this.menu.set(m);
        const first = m.categories[0];
        if (first) this.activeCategoryId.set(first.id);
      },
      error: () => this.error.set('Menu not available'),
    });
  }
}
