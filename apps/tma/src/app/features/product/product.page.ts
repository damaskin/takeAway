import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
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

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService } from '../../core/cart/cart.service';
import { ActiveStoreService } from '../../core/catalog/active-store.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaFoodSuggestionsComponent } from '../../shared/food-suggestions.component';
import { TmaProductOptionsComponent } from './product-options.component';

/**
 * TMA Product Detail — pencil XJUmz.
 *
 * tcContent (0/16/16/16 padding, gap 20):
 *   hero — 220px image: the photo, or the placeholder for the product's kind
 *   infoRow — title (Fraunces 20/700) · live price (Inter 18/700 caramel)
 *   meta — calories, prep time, caffeine (not for food or bakery), allergen chips
 *   description
 *   options — choice chips per size / temperature / milk / cup, add-on
 *     groups opening in place (see TmaProductOptionsComponent)
 *   note — «Пожелание бариста» for a drink, «Комментарий к заказу» else
 *   «Часто берут вместе» under a drink, when the store sells food
 *   choice bar — pinned above Telegram's button: the choice in one line
 *     and the price
 * MainButton (Telegram blue, 48px) handles add-to-cart action. It stays
 * hidden while the serving store is closed — the cart would refuse the item.
 */
@Component({
  selector: 'app-tma-product',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslatePipe,
    ProductImageComponent,
    TmaProductOptionsComponent,
    TmaFoodSuggestionsComponent,
  ],
  template: `
    <section style="padding: 0 16px 24px 16px; display: flex; flex-direction: column; gap: 20px">
      @if (product(); as p) {
        <lib-product-image
          [src]="p.imageUrls[0]"
          [kind]="kind()"
          [alt]="p.name"
          [eager]="true"
          style="height: 220px; margin: 16px -16px 0 -16px; border-radius: 0 0 24px 24px"
        />

        <!-- Title row -->
        <div class="flex items-start justify-between" style="gap: 12px">
          <div class="flex flex-col flex-1" style="gap: 4px">
            <span
              style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso)"
              >{{ p.name }}</span
            >
            <div class="flex items-center flex-wrap" style="gap: 4px 12px">
              @if (p.calories !== null) {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                  >🔥 {{ 'tma.product.labels.kcal' | translate: { calories: p.calories } }}</span
                >
              }
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                >⌛ {{ minutes(p.prepTimeSeconds) }} {{ 'common.units.min' | translate }}</span
              >
              @if (showCaffeine()) {
                <span
                  role="img"
                  style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                  [attr.aria-label]="'common.product.caffeine' | translate"
                >
                  @for (i of [0, 1, 2, 3]; track i) {
                    <span [style.opacity]="i < (p.caffeineLevel ?? 0) ? 1 : 0.25">☕</span>
                  }
                </span>
              }
            </div>
          </div>
          <span style="font-family: var(--font-sans); font-size: 20px; font-weight: 700; color: var(--color-caramel)">{{
            price(totalCents())
          }}</span>
        </div>

        @if (p.description) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; line-height: 1.6; color: var(--color-text-secondary); margin: 0"
          >
            {{ p.description }}
          </p>
        }

        @if (allergens().length > 0) {
          <div
            class="flex items-center flex-wrap"
            data-testid="allergens"
            style="gap: 6px; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
          >
            <span>{{ 'common.product.allergens' | translate }}:</span>
            @for (a of allergens(); track a.text) {
              <span
                style="padding: 3px 9px; border-radius: 9999px; background: var(--color-latte); color: var(--color-text-secondary); font-weight: 500"
                >{{ a.code ? ('common.allergens.' + a.code | translate) : a.text }}</span
              >
            }
          </div>
        }

        <app-tma-product-options
          [variations]="p.variations"
          [modifiers]="p.modifiers"
          [currency]="currency()"
          [(selection)]="selectedVariations"
          [(counts)]="modifierCounts"
        />

        <!-- Note for whoever makes it -->
        <label class="flex flex-col" style="gap: 8px">
          <span
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
            >{{ (isDrink() ? 'common.product.noteDrink' : 'common.product.noteOther') | translate }}</span
          >
          <textarea
            [(ngModel)]="notes"
            rows="2"
            maxlength="200"
            [placeholder]="
              (isDrink() ? 'common.product.noteDrinkPlaceholder' : 'common.product.noteOtherPlaceholder') | translate
            "
            style="padding: 10px 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); resize: none; outline: none"
          ></textarea>
        </label>

        @if (storeClosed()) {
          <div
            role="status"
            data-testid="store-closed"
            class="flex flex-col items-center text-center"
            style="gap: 8px; padding: 14px 16px; border-radius: 12px; background: rgba(217, 75, 94, 0.08); border: 1px solid rgba(217, 75, 94, 0.3); font-family: var(--font-sans)"
          >
            <span style="font-size: 14px; font-weight: 600; color: var(--color-espresso)">{{
              'common.storeClosed.cannotOrder' | translate
            }}</span>
            <a routerLink="/stores" style="font-size: 13px; font-weight: 600; color: var(--color-caramel)">{{
              'common.storeClosed.chooseAnother' | translate
            }}</a>
          </div>
        } @else if (error()) {
          <p
            class="text-center"
            style="font-family: var(--font-sans); font-size: 12px; color: var(--color-danger, #c0392b)"
          >
            {{ error() }}
          </p>
        }

        @if (!authStore.isAuthenticated()) {
          <p
            class="text-center"
            style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
          >
            {{ 'tma.product.offlinePrompt' | translate }}
          </p>
        }

        @if (pairings().length > 0 && store(); as s) {
          <app-tma-food-suggestions
            title="common.product.pairings"
            [suggestions]="pairings()"
            [store]="s"
            [canAdd]="authStore.isAuthenticated() && !storeClosed()"
          />
        }
      }
    </section>

    @if (product(); as p) {
      <!-- The choice and its price, right above Telegram's add button. -->
      <div
        data-testid="choice-summary"
        class="flex items-center"
        style="position: sticky; bottom: 0; z-index: 5; gap: 12px; padding: 10px 16px calc(10px + var(--tg-safe-area-bottom, 0px)); background: var(--color-cream); border-top: 1px solid var(--color-border-light); font-family: var(--font-sans)"
      >
        <span
          class="flex-1"
          style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--color-text-secondary)"
          >{{ choice() || p.name }}</span
        >
        <span style="flex: none; font-size: 15px; font-weight: 700; color: var(--color-caramel)">{{
          price(totalCents())
        }}</span>
      </div>
    }
  `,
})
export class TmaProductPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly cartService = inject(CartService);
  private readonly tg = inject(TelegramBridgeService);
  private readonly translate = inject(TranslateService);
  private readonly activeStore = inject(ActiveStoreService);
  private readonly fmt = inject(LocaleFormatService);
  readonly authStore = inject(TmaAuthStore);

  readonly product = signal<ProductDetail | null>(null);
  readonly error = signal<string | null>(null);
  /** The store this product would be added to takes no orders right now. */
  readonly storeClosed = signal(false);
  readonly selectedVariations = signal<VariationSelection>({});
  readonly modifierCounts = signal<Record<string, number>>({});
  notes = '';
  /** The store the product would be added to. */
  readonly store = signal<StoreListItem | null>(null);
  /** The serving store's currency; the customer's profile currency is not what they pay in. */
  readonly currency = computed(() => this.store()?.currency ?? null);
  /** The serving store's menu: the product's kind, and what goes well with it. */
  readonly menu = signal<StoreMenu | null>(null);
  private detachBack: (() => void) | null = null;

  readonly totalCents = computed(() => {
    const p = this.product();
    return p ? priceWithOptions(p, this.selectedVariations(), this.modifierCounts()) : 0;
  });

  /** The choice in one line over the add button: "L · Oat · +Vanilla ×2". */
  readonly choice = computed(() => {
    const p = this.product();
    return p ? describeChoice(p, this.selectedVariations(), this.modifierCounts()) : '';
  });

  /** What the product is — picks the placeholder, the note's wording and whether caffeine is shown. */
  readonly kind = computed(() => {
    const p = this.product();
    if (!p) return 'OTHER';
    const category = this.menu()?.categories.find((c) => c.id === p.categoryId) ?? null;
    return productKind(p, category);
  });

  readonly isDrink = computed(() => isDrinkKind(this.kind()));

  /** Caffeine means nothing on a croissant, whatever the POS sent. */
  readonly showCaffeine = computed(() => {
    const level = this.product()?.caffeineLevel;
    return level !== null && level !== undefined && !isFoodKind(this.kind());
  });

  readonly allergens = computed(() => allergenChips(this.product()?.allergens));

  /** «Часто берут вместе»: food and bakery from the same menu, under a drink. */
  readonly pairings = computed(() => {
    const p = this.product();
    return p ? suggestFood(this.menu(), [p.id], 6) : [];
  });

  constructor() {
    // The session can land after this screen renders (a retry from the
    // route guard). Bring the Telegram main button back when it does,
    // instead of leaving the customer looking at a dead product page. The
    // label carries the price, so it follows every change of the options.
    effect(() => {
      if (this.authStore.isAuthenticated() && this.product()) {
        this.refreshMainButton();
      }
    });
  }

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) return;
    // The active store's brand first (two cafés can both have a `latte`); a
    // product shared from another brand's menu is not there, so look again
    // without a store.
    const active = this.activeStore.current();
    this.catalog
      .getProduct(slug, active)
      .pipe(
        catchError((err: unknown) =>
          active && (err as { status?: number }).status === 404 ? this.catalog.getProduct(slug) : throwError(() => err),
        ),
      )
      .subscribe({
        next: (p) => {
          this.product.set(p);
          this.selectedVariations.set(defaultVariationSelection(p.variations));
          this.modifierCounts.set(initialModifierCounts(p.modifiers));
          this.resolveStore(p.brandId);
          this.refreshMainButton();
        },
      });
    this.detachBack = this.tg.setBackButton(() => {
      if (history.length > 1) history.back();
      else void this.router.navigate(['/']);
    });
  }

  ngOnDestroy(): void {
    this.tg.hideMainButton();
    this.detachBack?.();
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }

  minutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
  }

  private refreshMainButton(): void {
    if (!this.authStore.isAuthenticated() || this.storeClosed()) {
      this.tg.hideMainButton();
      return;
    }
    const label = this.translate.instant('tma.product.cta.add', { total: this.price(this.totalCents()) });
    this.tg.setMainButton(label, () => this.onMainButton());
  }

  /**
   * A cart rejects a product whose brand differs from the store's, so the
   * store the customer was last browsing only works when it belongs to the
   * same brand — a product opened from a shared link usually does not. Fall
   * back to a store of the product's own brand rather than to whichever
   * store the catalog happens to list first.
   */
  private resolveStore(brandId: string): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        const active = list.find((s) => s.id === this.activeStore.current());
        const fit = active?.brandId === brandId ? active : list.find((s) => s.brandId === brandId);
        this.store.set(fit ?? null);
        this.storeClosed.set(!!fit && isStoreInactive(fit));
        if (!fit) this.error.set(this.translate.instant('tma.product.noStore'));
        else this.loadMenu(fit.slug);
        this.refreshMainButton();
      },
    });
  }

  private loadMenu(storeSlug: string): void {
    this.catalog.getMenu(storeSlug).subscribe({
      next: (menu) => this.menu.set(menu),
      error: () => undefined,
    });
  }

  private onMainButton(): void {
    const p = this.product();
    const store = this.store();
    if (!p || !store) return;
    this.tg.haptic('medium');
    this.cartService
      .add({
        storeId: store.id,
        productId: p.id,
        quantity: 1,
        variationIds: Object.values(this.selectedVariations()).filter((id): id is string => Boolean(id)),
        modifiers: this.modifierCounts(),
        notes: this.notes.trim() || undefined,
      })
      .subscribe({
        next: () => void this.router.navigate(['/checkout']),
        // Without this the request failing left the button looking inert —
        // the customer taps "add" and nothing at all happens.
        // A coded refusal (sold out here, not sold in this store) reads in the
        // customer's language, like on the website.
        error: (err: { error?: { code?: string; message?: string }; message?: string }) => {
          // The store closed while the customer was choosing.
          if (err.error?.code === 'STORE_NOT_TAKING_ORDERS') {
            this.storeClosed.set(true);
            this.refreshMainButton();
            return;
          }
          this.error.set(
            checkoutErrorText(err.error, this.translate, this.fmt) ??
              err.error?.message ??
              err.message ??
              this.translate.instant('tma.product.addFailed'),
          );
        },
      });
  }
}
