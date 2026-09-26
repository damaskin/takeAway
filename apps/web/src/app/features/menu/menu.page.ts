import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { CategoryWithProducts, StoreDetail, StoreMenu } from '@takeaway/shared-types';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { Subscription, catchError, map, of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { storeAddress } from '../../core/catalog/store-place';
import { prefersReducedMotion, stickyTopInset } from '../../core/layout/sticky-inset';
import { categoryIcon } from '../../core/catalog/category-icon';

/**
 * Web Menu / Catalog — pencil A2 (Y9Imj).
 *
 *   store bar (56px, foam)  — the store, its address and when an order
 *                             placed now would be ready. Pinned under the
 *                             header on a desktop.
 *   category chips          — phones only, pinned under the header in
 *                             place of the rail.
 *   menu body
 *     rail (240px, foam)    — a column the full height of the menu; the
 *                             category list inside it stays in view.
 *     main (cream)          — a section per category, product card grid.
 *     cart bar              — floats at the bottom once the cart for this
 *                             store has something in it.
 *
 * The category being read is highlighted in the rail and the chips as the
 * page scrolls; clicking one scrolls to it.
 */
@Component({
  selector: 'app-web-menu',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="store-bar" data-sticky-top>
      @if (store(); as s) {
        <div class="store-place">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            style="flex: none; width: 20px; height: 20px; fill: var(--color-caramel)"
          >
            <path
              d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"
            />
          </svg>
          <div class="min-w-0 flex items-baseline" style="gap: 10px">
            <span class="truncate" style="font-size: 15px; font-weight: 600; color: var(--color-text-primary)">{{
              s.name
            }}</span>
            @if (address(); as a) {
              <span class="store-address truncate" style="font-size: 13px; color: var(--color-text-tertiary)">{{
                a
              }}</span>
            }
          </div>
          <a routerLink="/stores" style="flex: none; font-size: 14px; font-weight: 500; color: var(--color-caramel)">{{
            'common.change' | translate
          }}</a>
        </div>
        @if (s.openNow) {
          <span class="store-eta">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {{ 'common.readyIn' | translate: { min: etaMinutes(s) } }}
          </span>
        } @else {
          <span class="store-eta is-closed">{{ 'web.menu.closedNow' | translate }}</span>
        }
      } @else if (!error()) {
        <span
          class="block animate-pulse"
          style="border-radius: 10px; background: var(--color-latte); width: 200px; height: 18px"
        ></span>
      }
    </div>

    @if (categories().length > 0) {
      <nav class="menu-chips" #chips data-sticky-top [attr.aria-label]="'web.menu.categoriesLabel' | translate">
        @for (cat of categories(); track cat.id) {
          <button
            type="button"
            class="menu-chip"
            [class.is-active]="activeCategoryId() === cat.id"
            [attr.aria-current]="activeCategoryId() === cat.id ? 'true' : null"
            [attr.data-cat]="cat.id"
            (click)="scrollToCategory(cat.id)"
          >
            <span aria-hidden="true">{{ icon(cat) }}</span>
            {{ cat.name }}
          </button>
        }
      </nav>
    }

    <div class="menu-body">
      <aside class="menu-sidebar">
        <nav class="menu-rail" #rail [attr.aria-label]="'web.menu.categoriesLabel' | translate">
          <span
            style="padding: 0 12px 10px; font-family: var(--font-sans); font-size: 11px; font-weight: 600; letter-spacing: 1px; color: var(--color-text-tertiary)"
            >{{ 'web.menu.sidebarHeading' | translate }}</span
          >
          @for (cat of categories(); track cat.id) {
            <button
              type="button"
              class="rail-item"
              [class.is-active]="activeCategoryId() === cat.id"
              [attr.aria-current]="activeCategoryId() === cat.id ? 'true' : null"
              [attr.data-cat]="cat.id"
              (click)="scrollToCategory(cat.id)"
            >
              <span aria-hidden="true" style="flex: none; width: 22px; font-size: 17px; text-align: center">
                @if (cat.iconUrl) {
                  <img [src]="cat.iconUrl" alt="" width="20" height="20" />
                } @else {
                  {{ icon(cat) }}
                }
              </span>
              <span class="flex-1 min-w-0">{{ cat.name }}</span>
              <span style="font-size: 12px; font-weight: 500; color: var(--color-text-tertiary)">{{
                cat.products.length
              }}</span>
            </button>
          }
          @if (loading()) {
            @for (i of placeholders; track i) {
              <span
                class="block animate-pulse"
                style="border-radius: 10px; background: var(--color-latte); height: 36px; margin: 2px 0"
              ></span>
            }
          }
        </nav>
      </aside>

      <main class="menu-main">
        @for (cat of categories(); track cat.id) {
          <section class="menu-section" [attr.id]="'cat-' + cat.id" [attr.data-cat]="cat.id">
            <header class="flex items-baseline justify-between" style="gap: 12px; margin-bottom: 16px">
              <h2
                style="font-family: var(--font-display); font-size: clamp(22px, 2.6vw, 28px); font-weight: 700; line-height: 1.15; color: var(--color-espresso)"
              >
                {{ cat.name }}
              </h2>
              <span
                style="flex: none; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
                >{{ fmt.plural('common.itemsCount', cat.products.length) }}</span
              >
            </header>

            <div class="menu-grid">
              @for (p of cat.products; track p.id) {
                <a
                  [routerLink]="['/products', p.slug]"
                  [queryParams]="{ store: store()?.slug }"
                  class="product-card"
                  [class.is-sold-out]="p.onStopList"
                >
                  <div class="product-media">
                    @if (p.imageUrls[0]; as url) {
                      <img
                        [src]="url"
                        [alt]="p.name"
                        loading="lazy"
                        decoding="async"
                        class="w-full h-full object-cover"
                      />
                    } @else {
                      <span aria-hidden="true">{{ icon(cat) }}</span>
                    }
                  </div>
                  <div class="flex flex-1 flex-col" style="gap: 6px; padding: 12px 14px 14px">
                    <span
                      class="line-clamp-2"
                      style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--color-text-primary)"
                      >{{ p.name }}</span
                    >
                    @if (p.description) {
                      <span
                        class="line-clamp-2"
                        style="font-family: var(--font-sans); font-size: 13px; line-height: 1.4; color: var(--color-text-secondary)"
                        >{{ p.description }}</span
                      >
                    }
                    <div class="flex items-center justify-between" style="margin-top: auto; padding-top: 4px">
                      <span
                        style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-caramel)"
                        >{{ price(p.basePriceCents) }}</span
                      >
                      @if (p.onStopList) {
                        <span
                          style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-berry)"
                          >{{ 'common.soldOut' | translate }}</span
                        >
                      } @else {
                        <span class="product-add" aria-hidden="true">+</span>
                      }
                    </div>
                  </div>
                </a>
              }
            </div>
          </section>
        }

        @if (loading()) {
          <div class="menu-grid" aria-hidden="true">
            @for (i of placeholders; track i) {
              <span
                class="block animate-pulse"
                style="border-radius: 10px; background: var(--color-latte); aspect-ratio: 3 / 4; border-radius: var(--radius-card)"
              ></span>
            }
          </div>
        } @else if (error(); as e) {
          <div
            class="flex flex-col items-start"
            style="gap: 12px; font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary)"
          >
            <p>{{ e }}</p>
            <a routerLink="/stores" style="font-weight: 600; color: var(--color-caramel)">{{
              'web.menu.otherStores' | translate
            }}</a>
          </div>
        } @else if (menu() && categories().length === 0) {
          <div
            class="flex flex-col items-start"
            style="gap: 12px; font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary)"
          >
            <p>{{ 'web.menu.empty' | translate }}</p>
            <a routerLink="/stores" style="font-weight: 600; color: var(--color-caramel)">{{
              'web.menu.otherStores' | translate
            }}</a>
          </div>
        }

        @if (cartForStore(); as c) {
          <a
            routerLink="/checkout"
            [queryParams]="{ store: store()?.slug }"
            class="cart-bar"
            [attr.aria-label]="
              'web.menu.cart.aria'
                | translate: { items: fmt.plural('common.itemsCount', cartCount()), total: price(c.subtotalCents) }
            "
          >
            <span class="cart-count">{{ cartCount() }}</span>
            <span style="flex: 1; font-family: var(--font-sans); font-size: 15px; font-weight: 600">{{
              'web.menu.cart.checkout' | translate
            }}</span>
            <span style="font-family: var(--font-sans); font-size: 15px; font-weight: 700">{{
              price(c.subtotalCents)
            }}</span>
          </a>
        }
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .store-bar {
        position: sticky;
        top: 72px;
        z-index: 9;
        display: flex;
        align-items: center;
        gap: 16px;
        height: 56px;
        padding: 0 clamp(16px, 3vw, 40px);
        background: var(--color-foam);
        border-bottom: 1px solid var(--color-border-light);
        font-family: var(--font-sans);
      }
      .store-place {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .store-eta {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border-radius: 9999px;
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        font-size: 13px;
        font-weight: 600;
      }
      .store-eta.is-closed {
        background: #d94b5e1f;
        color: var(--color-berry);
      }
      .menu-chips {
        display: none;
      }
      .menu-body {
        display: flex;
        min-height: calc(100vh - 128px);
      }
      .menu-sidebar {
        flex: none;
        width: 240px;
        background: var(--color-foam);
        border-right: 1px solid var(--color-border-light);
      }
      .menu-rail {
        position: sticky;
        top: 128px;
        max-height: calc(100vh - 128px);
        overflow-y: auto;
        scrollbar-width: thin;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 20px 12px 24px;
      }
      .rail-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 40px;
        padding: 8px 12px;
        border-radius: 10px;
        text-align: left;
        font: 600 14px/1.25 var(--font-sans);
        color: var(--color-text-secondary);
        transition:
          background 0.15s,
          color 0.15s;
      }
      .rail-item:hover {
        background: var(--color-cream);
        color: var(--color-text-primary);
      }
      .rail-item.is-active {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
      }
      .menu-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 40px;
        padding: 28px clamp(16px, 3vw, 40px) 40px;
      }
      .menu-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
        gap: 20px;
      }
      .product-card {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-card);
        transition:
          transform 0.2s,
          box-shadow 0.2s;
      }
      .product-card.is-sold-out {
        opacity: 0.55;
      }
      .product-media {
        display: grid;
        place-items: center;
        aspect-ratio: 4 / 3;
        overflow: hidden;
        background: linear-gradient(135deg, var(--color-latte), var(--color-cream));
        font-size: 44px;
      }
      .product-add,
      .cart-count {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 9999px;
        background: var(--color-caramel);
        color: #fff;
        font: 700 18px/1 var(--font-sans);
      }
      .cart-bar {
        position: sticky;
        bottom: 16px;
        z-index: 5;
        align-self: center;
        width: min(100%, 480px);
        display: flex;
        align-items: center;
        gap: 12px;
        height: 56px;
        padding: 0 20px 0 12px;
        border-radius: 9999px;
        background: var(--color-caramel);
        color: #fff;
        box-shadow: var(--shadow-lifted);
      }
      .cart-count {
        background: #fff;
        color: var(--color-caramel);
        font-size: 14px;
      }
      @media (hover: hover) {
        .product-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-lifted);
        }
      }
      @media (max-width: 768px) {
        .store-bar {
          position: static;
          height: auto;
          min-height: 52px;
          padding-block: 8px;
          flex-wrap: wrap;
          gap: 8px 12px;
        }
        .store-address {
          display: none;
        }
        /* The name keeps its line; the ready-in pill wraps under it when both do not fit. */
        .store-place {
          flex: 1 0 auto;
          max-width: 100%;
        }
        .menu-chips {
          position: sticky;
          top: 72px;
          z-index: 9;
          display: flex;
          gap: 8px;
          padding: 10px 16px;
          overflow-x: auto;
          scrollbar-width: none;
          background: var(--color-foam);
          border-bottom: 1px solid var(--color-border-light);
        }
        .menu-chips::-webkit-scrollbar {
          display: none;
        }
        .menu-chip {
          flex: none;
          height: 34px;
          padding: 0 14px;
          border-radius: 9999px;
          border: 1px solid var(--color-border);
          background: var(--color-foam);
          font: 600 13px var(--font-sans);
          color: var(--color-text-primary);
          white-space: nowrap;
        }
        .menu-chip.is-active {
          border-color: var(--color-caramel);
          background: var(--color-caramel);
          color: #fff;
        }
        .menu-sidebar {
          display: none;
        }
        .menu-main {
          gap: 32px;
          padding: 20px 16px 32px;
        }
        .menu-grid {
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }
        .product-media {
          font-size: 36px;
        }
        .cart-bar {
          bottom: 12px;
        }
      }
    `,
  ],
})
export class MenuPage {
  private readonly route = inject(ActivatedRoute);
  private readonly catalog = inject(CatalogService);
  private readonly cart = inject(CartService);
  private readonly auth = inject(AuthStore);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  readonly fmt = inject(LocaleFormatService);

  private readonly chips = viewChild<ElementRef<HTMLElement>>('chips');
  private readonly rail = viewChild<ElementRef<HTMLElement>>('rail');

  readonly store = signal<StoreDetail | null>(null);
  readonly menu = signal<StoreMenu | null>(null);
  readonly error = signal<string | null>(null);
  readonly activeCategoryId = signal<string | null>(null);

  readonly categories = computed<CategoryWithProducts[]>(() => this.menu()?.categories ?? []);
  readonly loading = computed(() => this.menu() === null && this.error() === null);
  readonly address = computed(() => {
    const store = this.store();
    return store ? storeAddress(store) : '';
  });

  /** The cart, when it is this store's and has something in it. */
  readonly cartForStore = computed(() => {
    const cart = this.cart.cart();
    const store = this.store();
    return cart && store && cart.storeId === store.id && cart.items.length > 0 ? cart : null;
  });
  readonly cartCount = computed(() => this.cartForStore()?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0);

  readonly placeholders = [0, 1, 2, 3, 4, 5, 6, 7];

  private readonly storeId = computed(() => this.store()?.id ?? null);
  private loads = new Subscription();
  /** Set while a click-started scroll runs, so the highlight does not flick through every category it passes. */
  private spyHeld = false;
  private spyHoldTimer = 0;
  private spyFrame = 0;
  /** A `#cat-…` link lands on its category once, on the first draw of the menu. */
  private fragmentPending: string | null = null;

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('slug')),
        takeUntilDestroyed(),
      )
      .subscribe((slug) => this.open(slug));
    this.destroyRef.onDestroy(() => this.loads.unsubscribe());

    // The cart of the store on screen, for a signed-in customer.
    effect(() => {
      const storeId = this.storeId();
      if (!storeId || !this.auth.isAuthenticated()) return;
      untracked(() => this.cart.load(storeId).subscribe({ error: () => undefined }));
    });

    // Keep the highlighted category in sight in the chip row and the rail.
    afterRenderEffect(() => {
      const id = this.activeCategoryId();
      if (id) untracked(() => this.revealInNav(id));
    });

    afterRenderEffect(() => {
      if (this.categories().length === 0 || !this.fragmentPending) return;
      const id = this.fragmentPending;
      this.fragmentPending = null;
      // Coming back to the menu restores the scroll position instead.
      if (window.scrollY === 0) untracked(() => this.scrollToCategory(id, 'instant'));
    });

    afterNextRender(() => {
      const onScroll = () => this.onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        cancelAnimationFrame(this.spyFrame);
        clearTimeout(this.spyHoldTimer);
      });
    });
  }

  scrollToCategory(id: string, behavior: ScrollBehavior = 'smooth'): void {
    const section = document.getElementById('cat-' + id);
    if (!section) return;
    this.activeCategoryId.set(id);
    this.holdSpy();
    const top = section.getBoundingClientRect().top + window.scrollY - stickyTopInset() - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'instant' : behavior });
  }

  icon(cat: CategoryWithProducts): string {
    return categoryIcon(cat.name);
  }

  etaMinutes(store: StoreDetail): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.store()?.currency);
  }

  /** `/menu` shows the first store of the list; `/stores/:slug` that store. */
  private open(slug: string | null): void {
    this.loads.unsubscribe();
    this.loads = new Subscription();
    this.error.set(null);
    this.fragmentPending = this.route.snapshot.fragment?.match(/^cat-(.+)$/)?.[1] ?? null;
    const known = slug ?? this.catalog.cachedStores()?.[0]?.slug ?? null;
    if (known) {
      this.load(known);
      return;
    }
    this.store.set(null);
    this.menu.set(null);
    this.loads.add(
      this.catalog
        .listStores()
        .pipe(catchError(() => of([])))
        .subscribe((list) => {
          const first = list[0];
          if (first) this.load(first.slug);
          else this.error.set(this.translate.instant('web.menu.storeNotFound'));
        }),
    );
  }

  /** Draws what was fetched before at once, then swaps in a fresh copy. */
  private load(slug: string): void {
    const store = this.catalog.cachedStore(slug);
    const menu = this.catalog.cachedMenu(slug);
    this.store.set(store);
    this.menu.set(menu);
    this.activeCategoryId.set(menu?.categories[0]?.id ?? null);

    this.loads.add(
      this.catalog.getStore(slug).subscribe({
        next: (s) => this.store.set(s),
        error: () => {
          if (!store) this.error.set(this.translate.instant('web.menu.storeNotFound'));
        },
      }),
    );
    this.loads.add(
      this.catalog.getMenu(slug).subscribe({
        next: (m) => {
          const first = !this.menu();
          this.menu.set(m);
          if (first) this.activeCategoryId.set(m.categories[0]?.id ?? null);
        },
        error: () => {
          if (!menu && !this.error()) this.error.set(this.translate.instant('web.menu.menuUnavailable'));
        },
      }),
    );
  }

  private onScroll(): void {
    if (this.spyHeld) {
      this.holdSpy();
      return;
    }
    if (this.spyFrame) return;
    this.spyFrame = requestAnimationFrame(() => {
      this.spyFrame = 0;
      this.syncActiveWithScroll();
    });
  }

  /** Released once the page has not scrolled for a moment — the click-started scroll is over. */
  private holdSpy(): void {
    this.spyHeld = true;
    clearTimeout(this.spyHoldTimer);
    this.spyHoldTimer = window.setTimeout(() => (this.spyHeld = false), 180);
  }

  /** The category being read is the last one whose heading has reached the bars at the top. */
  private syncActiveWithScroll(): void {
    const sections = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('section[data-cat]'));
    const first = sections[0];
    const last = sections[sections.length - 1];
    if (!first || !last) return;
    const line = stickyTopInset() + 24;
    let active = first.dataset['cat'] ?? null;
    for (const section of sections) {
      if (section.getBoundingClientRect().top > line) break;
      active = section.dataset['cat'] ?? active;
    }
    // The last categories can be too short to ever reach the line: at the
    // very bottom of the page the last one is the one on screen.
    const root = document.documentElement;
    if (window.scrollY > 0 && window.innerHeight + window.scrollY >= root.scrollHeight - 2) {
      active = last.dataset['cat'] ?? active;
    }
    if (active && active !== this.activeCategoryId()) this.activeCategoryId.set(active);
  }

  /** Scrolls the chip row and the rail — never the page — to show the highlighted category. */
  private revealInNav(id: string): void {
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'instant' : 'smooth';
    const chips = this.chips()?.nativeElement;
    const chip = chips?.querySelector<HTMLElement>(`[data-cat="${id}"]`);
    if (chips && chip && chips.clientWidth > 0) {
      chips.scrollTo({ left: chip.offsetLeft - (chips.clientWidth - chip.offsetWidth) / 2, behavior });
    }
    const rail = this.rail()?.nativeElement;
    const item = rail?.querySelector<HTMLElement>(`[data-cat="${id}"]`);
    if (rail && item && rail.clientHeight > 0) {
      const above = item.offsetTop - rail.scrollTop;
      const below = item.offsetTop + item.offsetHeight - (rail.scrollTop + rail.clientHeight);
      if (above < 0) rail.scrollBy({ top: above - 8, behavior });
      else if (below > 0) rail.scrollBy({ top: below + 8, behavior });
    }
  }
}
