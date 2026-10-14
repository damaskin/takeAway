import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ProductDetail, StoreListItem, StoreMenu } from '@takeaway/shared-types';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import { checkoutErrorText, LocaleFormatService } from '@takeaway/i18n';
import { ProductImageComponent } from '@takeaway/ui-kit';
import {
  allergenChips,
  defaultVariationSelection,
  describeChoice,
  initialModifierCounts,
  isDrinkKind,
  isFoodKind,
  isStoreInactive,
  priceWithOptions,
  productKind,
  suggestFood,
  type VariationSelection,
} from '@takeaway/utils';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FoodSuggestionsComponent } from '../../shared/food-suggestions.component';
import { ProductOptionsComponent } from './product-options.component';

/**
 * Web Product Detail — pencil A3 (9ISer).
 *
 * Layout:
 *   pdpBody (padding 48/80, gap 64)
 *     pdpImgCol (560px) — hero image (the photo, or the placeholder for the
 *       product's kind), 24px radius
 *     pdpDetailCol (fill) —
 *       breadcrumb
 *       title (Fraunces 36/700) + description (Inter 16, 1.6 line-height)
 *       meta: calories, caffeine (drinks — not food or bakery), allergen chips
 *       options: choice chips per size / temperature / milk / cup, add-on
 *         groups opening in place (see ProductOptionsComponent)
 *       note: «Пожелание бариста» for a drink, «Комментарий к заказу» else
 *       add bar: the choice in one line, qty stepper + caramel pill button
 *         ("Add to cart — $X"); pinned to the bottom of a phone's screen
 *       «К этому напитку» under a drink, when the store sells food
 */
@Component({
  selector: 'app-product',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslatePipe,
    ProductImageComponent,
    ProductOptionsComponent,
    FoodSuggestionsComponent,
  ],
  template: `
    @if (product(); as p) {
      <section class="pdp">
        <!-- Image column -->
        <div class="pdp-media flex flex-col" style="gap: 16px">
          <lib-product-image
            class="pdp-hero"
            [src]="p.imageUrls[0]"
            [kind]="kind()"
            [alt]="p.name"
            [eager]="true"
            style="border-radius: 24px"
          />
        </div>

        <!-- Detail column -->
        <div class="flex flex-col flex-1" style="gap: 20px; min-width: 0">
          <!-- Breadcrumb -->
          <nav class="flex items-center flex-wrap" style="gap: 8px">
            <a
              [routerLink]="menuLink()"
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
              >{{ 'web.product.breadcrumbMenu' | translate }}</a
            >
            @if (category(); as c) {
              <span style="color: var(--color-text-tertiary); font-size: 11px">›</span>
              <a
                [routerLink]="menuLink()"
                [fragment]="'cat-' + c.id"
                style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
                >{{ c.name }}</a
              >
            }
            <span style="color: var(--color-text-tertiary); font-size: 11px">›</span>
            <span
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary)"
              >{{ p.name }}</span
            >
          </nav>

          <!-- Title block -->
          <div class="flex flex-col" style="gap: 8px">
            <h1
              style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso); margin: 0"
            >
              {{ p.name }}
            </h1>
            @if (p.description) {
              <p
                style="font-family: var(--font-sans); font-size: 16px; line-height: 1.6; color: var(--color-text-secondary); margin: 0"
              >
                {{ p.description }}
              </p>
            }
            <!-- Meta: calories, caffeine -->
            @if (p.calories !== null || showCaffeine()) {
              <div class="pdp-meta">
                @if (p.calories !== null) {
                  <span>🔥 {{ 'web.product.labels.kcal' | translate: { calories: p.calories } }}</span>
                }
                @if (showCaffeine()) {
                  <span class="flex items-center" style="gap: 6px">
                    {{ 'web.product.labels.caffeine' | translate }}
                    <span class="flex items-center" style="gap: 2px" aria-hidden="true">
                      @for (i of [0, 1, 2, 3]; track i) {
                        <span [style.opacity]="i < (p.caffeineLevel ?? 0) ? 1 : 0.25">☕</span>
                      }
                    </span>
                  </span>
                }
              </div>
            }
            @if (allergens().length > 0) {
              <div class="pdp-allergens" data-testid="allergens">
                <span>{{ 'common.product.allergens' | translate }}:</span>
                @for (a of allergens(); track a.text) {
                  <span class="pdp-chip">{{ a.code ? ('common.allergens.' + a.code | translate) : a.text }}</span>
                }
              </div>
            }
          </div>

          <app-product-options
            [variations]="p.variations"
            [modifiers]="p.modifiers"
            [currency]="resolvedStore()?.currency"
            [(selection)]="selectedVariations"
            [(counts)]="modifierCounts"
          />

          <!-- Note for whoever makes it -->
          <div class="flex flex-col" style="gap: 8px">
            <label
              for="pdp-notes"
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
              >{{ (isDrink() ? 'common.product.noteDrink' : 'common.product.noteOther') | translate }}</label
            >
            <textarea
              id="pdp-notes"
              [(ngModel)]="notes"
              rows="2"
              maxlength="200"
              [placeholder]="
                (isDrink() ? 'common.product.noteDrinkPlaceholder' : 'common.product.noteOtherPlaceholder') | translate
              "
              style="background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); padding: 12px 16px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); resize: vertical"
            ></textarea>
          </div>

          <!-- Add bar: the choice, qty + primary button -->
          <div class="pdp-add">
            @if (choice()) {
              <p class="pdp-choice" data-testid="choice-summary">{{ choice() }}</p>
            }
            <div class="flex items-center" style="gap: 16px">
              <div
                class="flex items-center"
                style="border: 1px solid var(--color-border); border-radius: var(--radius-button); overflow: hidden; background: var(--color-foam)"
              >
                <button
                  type="button"
                  (click)="decQty()"
                  [disabled]="quantity() <= 1"
                  class="flex items-center justify-center disabled:opacity-30"
                  style="width: 44px; height: 48px; font-size: 20px; color: var(--color-text-primary)"
                >
                  −
                </button>
                <span
                  class="flex items-center justify-center"
                  style="width: 44px; height: 48px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
                  >{{ quantity() }}</span
                >
                <button
                  type="button"
                  (click)="incQty()"
                  class="flex items-center justify-center"
                  style="width: 44px; height: 48px; font-size: 20px; color: var(--color-text-primary)"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                (click)="addToCart()"
                [disabled]="adding() || !authStore.isAuthenticated() || !resolvedStore() || storeClosed()"
                class="flex items-center justify-center disabled:opacity-60"
                style="flex: 1; height: 56px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); gap: 12px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
              >
                <span style="font-size: 18px">🛍</span>
                <span>{{
                  adding()
                    ? ('web.product.cta.adding' | translate)
                    : ('web.product.cta.add' | translate: { total: price(totalCents()) })
                }}</span>
              </button>
            </div>
          </div>
          @if (storeClosed()) {
            <p
              class="text-center"
              role="status"
              data-testid="store-closed"
              style="margin-top: 4px; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)"
            >
              {{ 'common.storeClosed.cannotOrder' | translate }}
              <a
                routerLink="/stores"
                style="color: var(--color-caramel); font-weight: 600; text-decoration: underline"
                >{{ 'common.storeClosed.chooseAnother' | translate }}</a
              >
            </p>
          } @else if (noStoreForBrand()) {
            <p
              class="text-center"
              style="margin-top: 4px; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)"
            >
              {{ 'web.product.cta.noStore' | translate }}
            </p>
          } @else if (!authStore.isAuthenticated()) {
            <p
              class="text-center"
              style="margin-top: 4px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
            >
              <a routerLink="/login" style="color: var(--color-caramel); text-decoration: underline">{{
                'common.signIn' | translate
              }}</a>
              {{ 'web.product.cta.signInPrompt' | translate }}
            </p>
          } @else if (cartItemCount() > 0) {
            <a
              routerLink="/checkout"
              [queryParams]="{ store: resolvedStore()?.slug }"
              class="flex items-center justify-center"
              style="margin-top: 4px; height: 48px; background: var(--color-espresso); color: var(--color-foam); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >{{ 'web.product.cta.goToCheckout' | translate: { count: cartItemCount() } }}</a
            >
          }
          @if (addError() && !storeClosed()) {
            <p
              class="text-center"
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin-top: 4px"
            >
              {{ addError() }}
            </p>
          }

          @if (pairings().length > 0 && resolvedStore(); as store) {
            <app-food-suggestions
              style="margin-top: 12px"
              title="common.product.pairings"
              [suggestions]="pairings()"
              [store]="store"
              [canAdd]="authStore.isAuthenticated() && !storeClosed()"
            />
          }
        </div>
      </section>
    }

    @if (error()) {
      <section style="padding: clamp(24px, 5vw, 48px) clamp(16px, 5vw, 80px); max-width: 1440px; margin: 0 auto">
        <button
          type="button"
          (click)="back()"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin-bottom: 16px"
        >
          ← {{ 'common.back' | translate }}
        </button>
        <p style="color: var(--color-berry); font-family: var(--font-sans); font-size: 14px">{{ error() }}</p>
      </section>
    }
  `,
  styles: [
    `
      .pdp {
        display: flex;
        gap: 64px;
        max-width: 1440px;
        margin: 0 auto;
        padding: 48px clamp(24px, 5vw, 80px);
      }
      .pdp-media {
        flex: none;
        width: min(560px, 45%);
      }
      .pdp-hero {
        aspect-ratio: 7 / 6;
        max-height: 480px;
      }
      .pdp-meta,
      .pdp-allergens {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 16px;
        margin-top: 4px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-tertiary);
      }
      .pdp-allergens {
        gap: 6px;
      }
      .pdp-chip {
        padding: 3px 10px;
        border-radius: var(--radius-pill);
        background: var(--color-latte);
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 500;
      }
      .pdp-add {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 8px;
      }
      .pdp-choice {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 900px) {
        .pdp {
          flex-direction: column;
          gap: 24px;
          padding: 16px 16px 32px;
        }
        .pdp-media {
          width: 100%;
        }
        .pdp-hero {
          aspect-ratio: 4 / 3;
        }
        /* The price and the button stay in reach while the options scroll by. */
        .pdp-add {
          position: sticky;
          bottom: 0;
          z-index: 5;
          margin: 8px -16px 0;
          padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
          background: var(--color-cream);
          border-top: 1px solid var(--color-border-light);
        }
      }
    `,
  ],
})
export class ProductPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly cart = inject(CartService);
  readonly authStore = inject(AuthStore);
  private readonly fmt = inject(LocaleFormatService);
  private readonly translate = inject(TranslateService);

  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);
  readonly stores = signal<StoreListItem[]>([]);
  readonly cartItemCount = this.cart.itemCount;

  readonly product = signal<ProductDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly selectedVariations = signal<VariationSelection>({});
  readonly modifierCounts = signal<Record<string, number>>({});
  readonly quantity = signal(1);
  notes = '';

  /** The serving store's menu: the product's category, its kind, and what goes well with it. */
  readonly menu = signal<StoreMenu | null>(null);

  readonly totalCents = computed(() => {
    const p = this.product();
    if (!p) return 0;
    return priceWithOptions(p, this.selectedVariations(), this.modifierCounts()) * this.quantity();
  });

  /** The choice in one line next to the button: "L · Oat · +Vanilla ×2". */
  readonly choice = computed(() => {
    const p = this.product();
    return p ? describeChoice(p, this.selectedVariations(), this.modifierCounts()) : '';
  });

  /**
   * The store this item will be added to. A cart rejects a product whose
   * brand differs from the store's, and a product opened by its own URL
   * carries no store, so taking the first entry of the catalog — which is
   * ordered by distance and ETA across every brand — added the item to
   * whichever brand happened to sort first, and started failing the moment
   * a second brand went live.
   */
  readonly resolvedStore = computed<StoreListItem | null>(() => {
    const product = this.product();
    const stores = this.stores();
    if (!product || stores.length === 0) return null;
    // The store the customer came from, when it can make this product.
    const browsed = stores.find((s) => s.slug === this.browsedStore || s.id === this.browsedStore);
    if (browsed?.brandId === product.brandId) return browsed;
    return stores.find((s) => s.brandId === product.brandId) ?? null;
  });

  /** `?store=` from the menu link: which café's product this is. */
  private browsedStore: string | null = null;

  /** The menu the customer came from, or the default one after a direct link. */
  readonly menuLink = computed<string[]>(() => {
    const store = this.resolvedStore();
    return store ? ['/stores', store.slug] : ['/menu'];
  });

  /** The product's category, named from the serving store's menu. */
  readonly category = computed(() => {
    const product = this.product();
    return (product && this.menu()?.categories.find((c) => c.id === product.categoryId)) ?? null;
  });

  /** What the product is — picks the placeholder, the note's wording and whether caffeine is shown. */
  readonly kind = computed(() => {
    const product = this.product();
    return product ? productKind(product, this.category()) : 'OTHER';
  });

  readonly isDrink = computed(() => isDrinkKind(this.kind()));

  /** Caffeine means nothing on a croissant, whatever the POS sent. */
  readonly showCaffeine = computed(() => {
    const level = this.product()?.caffeineLevel;
    return level !== null && level !== undefined && !isFoodKind(this.kind());
  });

  readonly allergens = computed(() => allergenChips(this.product()?.allergens));

  /** «К этому напитку»: food and bakery from the same menu, under a drink. */
  readonly pairings = computed(() => {
    const product = this.product();
    return product ? suggestFood(this.menu(), [product.id], 6) : [];
  });

  /** Set when the cart turned the item away because the store closed meanwhile. */
  private readonly closedOnAdd = signal(false);

  /** The store this item would go to takes no orders right now: no add button. */
  readonly storeClosed = computed(() => {
    const store = this.resolvedStore();
    return this.closedOnAdd() || (store !== null && isStoreInactive(store));
  });

  /** True once we know the product's brand has no store taking orders. */
  readonly noStoreForBrand = computed(
    () => this.product() !== null && this.stores().length > 0 && this.resolvedStore() === null,
  );

  constructor() {
    // Load the cart of whichever store ends up serving this product, so the
    // "go to checkout" line reflects that store and not another brand's.
    effect(() => {
      const store = this.resolvedStore();
      if (!store || !this.authStore.isAuthenticated()) return;
      this.cart.load(store.id).subscribe();
    });

    // The serving store's menu: drawn from the copy the menu page left
    // behind, else fetched — a product opened by its own link has none.
    effect(() => {
      const store = this.resolvedStore();
      if (!store) return;
      untracked(() => {
        const cached = this.catalog.cachedMenu(store.slug);
        if (cached) {
          this.menu.set(cached);
          return;
        }
        this.catalog.getMenu(store.slug).subscribe({
          next: (menu) => this.menu.set(menu),
          error: () => undefined,
        });
      });
    });
  }

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.error.set(this.translate.instant('web.product.notFound'));
      return;
    }
    this.browsedStore = this.route.snapshot.queryParamMap.get('store');
    const browsed = this.browsedStore;
    this.catalog
      .getProduct(slug, browsed)
      .pipe(
        // A store renamed since the link was made: look the product up without it.
        catchError((err: unknown) =>
          browsed && (err as { status?: number }).status === 404
            ? this.catalog.getProduct(slug)
            : throwError(() => err),
        ),
      )
      .subscribe({
        next: (p) => {
          this.product.set(p);
          this.selectedVariations.set(defaultVariationSelection(p.variations));
          this.modifierCounts.set(initialModifierCounts(p.modifiers));
        },
        error: () => this.error.set(this.translate.instant('web.product.notFound')),
      });

    this.catalog.listStores().subscribe({
      next: (list) => this.stores.set(list),
      error: () => this.stores.set([]),
    });
  }

  addToCart(): void {
    const p = this.product();
    const store = this.resolvedStore();
    if (!p || !store) return;
    const storeId = store.id;
    this.adding.set(true);
    this.addError.set(null);
    this.cart
      .add({
        storeId,
        productId: p.id,
        quantity: this.quantity(),
        variationIds: Object.values(this.selectedVariations()).filter((id): id is string => Boolean(id)),
        modifiers: this.modifierCounts(),
        notes: this.notes.trim() || undefined,
      })
      .subscribe({
        next: () => this.adding.set(false),
        error: (err) => {
          this.adding.set(false);
          const body = (err as { error?: { code?: unknown; message?: unknown } }).error;
          if (body?.code === 'STORE_NOT_TAKING_ORDERS') this.closedOnAdd.set(true);
          this.addError.set(
            checkoutErrorText(body, this.translate, this.fmt) ??
              (typeof body?.message === 'string' ? body.message : this.translate.instant('web.product.addFailed')),
          );
        },
      });
  }

  back(): void {
    if (history.length > 1) {
      history.back();
    } else {
      void this.router.navigate(['/menu']);
    }
  }

  incQty(): void {
    this.quantity.update((q) => Math.min(q + 1, 20));
  }

  decQty(): void {
    this.quantity.update((q) => Math.max(q - 1, 1));
  }

  price(cents: number): string {
    // The serving store's currency; the customer's profile currency is not what they pay in.
    return this.fmt.money(cents, this.resolvedStore()?.currency);
  }
}
