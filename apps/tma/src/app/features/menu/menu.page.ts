import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CategoryWithProducts, StoreDetail, StoreMenu } from '@takeaway/shared-types';
import { TranslatePipe } from '@ngx-translate/core';

import { CatalogService } from '../../core/catalog/catalog.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { BrandThemeService } from '../../core/theme/brand-theme.service';
import { TmaTabBarComponent } from '../../shared/tab-bar.component';

/**
 * TMA Menu — pencil hoC8v.
 *
 * tmaContent (16px padding, gap 16):
 *   tmaStoreRow — store pin + name + change link
 *   tmaCats — horizontal emoji-prefixed category chips (scroll-x)
 *   tmaGrid — 2-column product cards (foam, 16px radius)
 */
@Component({
  selector: 'app-tma-menu',
  standalone: true,
  imports: [RouterLink, TmaTabBarComponent, TranslatePipe],
  template: `
    @if (store(); as s) {
      <div
        class="flex items-center"
        style="background: var(--color-foam); padding: 12px 16px; gap: 10px; border-bottom: 1px solid var(--color-border-light)"
      >
        <span style="color: var(--color-caramel); font-size: 16px">📍</span>
        <span
          class="flex-1"
          style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
          >{{ s.name }}</span
        >
        <a
          routerLink="/stores"
          style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-caramel)"
          >{{ 'tma.menu.change' | translate }}</a
        >
      </div>
    }

    <section style="padding: 16px 16px 88px 16px; display: flex; flex-direction: column; gap: 16px">
      <!-- Category chips -->
      <div class="flex" style="gap: 8px; overflow-x: auto; margin: 0 -16px; padding: 0 16px">
        @for (cat of categories(); track cat.id; let i = $index) {
          <button
            type="button"
            (click)="scrollToCategory(cat.id)"
            class="flex items-center whitespace-nowrap"
            [style.background]="activeCategoryId() === cat.id ? 'var(--color-caramel)' : 'var(--color-foam)'"
            [style.color]="activeCategoryId() === cat.id ? 'white' : 'var(--color-text-primary)'"
            [style.border]="
              activeCategoryId() === cat.id ? '1px solid transparent' : '1px solid var(--color-border-light)'
            "
            style="height: 36px; padding: 0 14px; border-radius: 9999px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; gap: 4px"
          >
            {{ categoryEmoji(i) }} {{ cat.name }}
          </button>
        }
      </div>

      <!-- 2-column grid per category -->
      @for (cat of categories(); track cat.id) {
        <section [attr.id]="'tma-cat-' + cat.id" class="flex flex-col" style="gap: 12px">
          <h2
            style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
          >
            {{ cat.name }}
          </h2>
          <div class="grid" style="grid-template-columns: repeat(2, 1fr); gap: 12px">
            @for (p of cat.products; track p.id) {
              <a
                [routerLink]="['/products', p.slug]"
                class="flex flex-col"
                [class.opacity-50]="p.onStopList"
                style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; overflow: hidden"
              >
                <div
                  [style.background]="'linear-gradient(135deg, var(--color-latte) 0%, var(--color-cream) 100%)'"
                  style="aspect-ratio: 1 / 1; background-size: cover"
                ></div>
                <div class="flex flex-col" style="padding: 12px; gap: 4px">
                  <span
                    class="line-clamp-2"
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                    >{{ p.name }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-caramel)"
                    >{{ price(p.basePriceCents) }}</span
                  >
                </div>
              </a>
            }
          </div>
        </section>
      }
    </section>

    <app-tma-tab-bar />
  `,
})
export class TmaMenuPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly tg = inject(TelegramBridgeService);
  private readonly brandTheme = inject(BrandThemeService);

  readonly store = signal<StoreDetail | null>(null);
  readonly menu = signal<StoreMenu | null>(null);
  readonly activeCategoryId = signal<string | null>(null);
  readonly categories = computed<CategoryWithProducts[]>(() => this.menu()?.categories ?? []);

  private detachBack: (() => void) | null = null;

  private readonly emojiByIndex = ['☕', '🍵', '✨', '🍳', '🥪', '🍰', '🥤', '🍪'];

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.catalog.listStores().subscribe({
        next: (list) => {
          const first = list[0];
          if (first) void this.router.navigate(['/stores', first.slug], { replaceUrl: true });
        },
      });
      return;
    }

    this.catalog.getStore(slug).subscribe({
      next: (s) => {
        this.store.set(s);
        this.brandTheme.apply(s.brand?.themeOverrides ?? null);
      },
    });
    this.catalog.getMenu(slug).subscribe({
      next: (m) => {
        this.menu.set(m);
        const first = m.categories[0];
        if (first) this.activeCategoryId.set(first.id);
      },
    });

    this.detachBack = this.tg.setBackButton(() => void this.router.navigate(['/']));
  }

  ngOnDestroy(): void {
    this.detachBack?.();
    this.brandTheme.reset();
  }

  scrollToCategory(id: string): void {
    this.activeCategoryId.set(id);
    const el = document.getElementById('tma-cat-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  categoryEmoji(idx: number): string {
    return this.emojiByIndex[idx % this.emojiByIndex.length] ?? '☕';
  }

  price(cents: number): string {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: this.store()?.currency ?? 'USD',
    }).format(cents / 100);
  }
}
