import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ProductDetail, StoreListItem, StoreMenu } from '@takeaway/shared-types';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, throwError, type Observable } from 'rxjs';
import { checkoutErrorText, LocaleFormatService } from '@takeaway/i18n';
import { ProductImageComponent } from '@takeaway/ui-kit';
import {
  defaultOptionPicks,
  defaultVariationSelection,
  describeChoice,
  describeOptionLines,
  initialModifierCounts,
  isDrinkKind,
  isStoreInactive,
  normalizeOptionPicks,
  optionLinesFor,
  orderOptionGroups,
  priceWithOptionPicks,
  priceWithOptions,
  productKind,
  showsNutrition,
  suggestionRow,
  toOptionSelections,
  type SuggestionRow,
  type VariationSelection,
} from '@takeaway/utils';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService } from '../../core/cart/cart.service';
import { ActiveStoreService } from '../../core/catalog/active-store.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { storeSuggestions } from '../../core/catalog/store-suggestions';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaFoodSuggestionsComponent } from '../../shared/food-suggestions.component';
import { optionChoiceProblem, TmaProductOptionGroupsComponent } from './product-option-groups.component';
import { TmaProductOptionsComponent } from './product-options.component';

/**
 * TMA Product Detail — pencil XJUmz.
 *
 * tcContent (0/16/16/16 padding, gap 20):
 *   hero — 220px image: the photo, or the placeholder for the product's kind
 *   infoRow — title (Fraunces 20/700) · live price (Inter 18/700 caramel)
 *   meta — calories (a meal only), prep time
 *   description
 *   options — the options catalog's groups when the product has them (see
 *     TmaProductOptionGroupsComponent), else choice chips per size /
 *     temperature / milk / cup and add-on groups opening in place (see
 *     TmaProductOptionsComponent)
 *   note — «Пожелание бариста» for a drink, «Комментарий к заказу» else
 *   «К этому напитку» under a drink, when the store sells food
 *   choice bar — pinned above Telegram's button: the choice in one line (or
 *     what is still to choose) and the price
 * MainButton (Telegram blue, 48px) handles add-to-cart action. It stays
 * hidden while the serving store is closed — the cart would refuse the item —
 * and inert, saying what to choose, until the choice can go in the cart.
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
    TmaProductOptionGroupsComponent,
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
              @if (hasNutrition() && p.calories !== null) {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                  >🔥 {{ 'tma.product.labels.kcal' | translate: { calories: p.calories } }}</span
                >
              }
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                >⌛ {{ minutes(p.prepTimeSeconds) }} {{ 'common.units.min' | translate }}</span
              >
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

        @if (optionGroups().length > 0) {
          <app-tma-product-option-groups [groups]="optionGroups()" [currency]="currency()" [(picks)]="optionPicks" />
        } @else {
          <app-tma-product-options
            [variations]="p.variations"
            [modifiers]="p.modifiers"
            [currency]="currency()"
            [(selection)]="selectedVariations"
            [(counts)]="modifierCounts"
          />
        }

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

        @if (pairings().items.length > 0 && store(); as s) {
          <app-tma-food-suggestions
            [title]="pairings().source === 'copurchase' ? 'common.upsell.together' : 'common.product.pairings'"
            [suggestions]="pairings().items"
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
        style="position: sticky; bottom: 0; z-index: 5; gap: 12px; padding: 10px 16px calc(10px + var(--tma-safe-bottom)); background: var(--color-cream); border-top: 1px solid var(--color-border-light); font-family: var(--font-sans)"
      >
        @if (optionProblem(); as problem) {
          <span
            class="flex-1"
            role="status"
            data-testid="option-hint"
            style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--color-caramel)"
            >{{ problem.key | translate: problem }}</span
          >
        } @else {
          <span
            class="flex-1"
            style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--color-text-secondary)"
            >{{ choice() || p.name }}</span
          >
        }
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
  /** The choice from the options catalog, for a product with catalog groups. */
  readonly optionPicks = signal<Record<string, number>>({});
  notes = '';
  /** The store the product would be added to. */
  readonly store = signal<StoreListItem | null>(null);
  /** The serving store's currency; the customer's profile currency is not what they pay in. */
  readonly currency = computed(() => this.store()?.currency ?? null);
  /** The serving store's menu: the product's kind, and what goes well with it. */
  readonly menu = signal<StoreMenu | null>(null);
  private detachBack: (() => void) | null = null;

  /**
   * The product's groups from the options catalog, variants first. When there
   * are any the product is ordered through them alone; empty for a product
   * on its older options, or from an API that predates the catalog.
   */
  readonly optionGroups = computed(() => orderOptionGroups(this.product()?.optionGroups ?? []));

  /** What keeps the choice out of the cart — «Выберите: Размер (кофе)» — or null. */
  readonly optionProblem = computed(() =>
    this.optionGroups().length > 0 ? optionChoiceProblem(this.optionGroups(), this.optionPicks()) : null,
  );

  readonly totalCents = computed(() => {
    const p = this.product();
    if (!p) return 0;
    const groups = this.optionGroups();
    return groups.length > 0
      ? priceWithOptionPicks(p.basePriceCents, groups, this.optionPicks())
      : priceWithOptions(p, this.selectedVariations(), this.modifierCounts());
  });

  /** The choice in one line over the add button: "L · Oat · +Vanilla ×2", "M, Горячий · Овсяное · Ваниль". */
  readonly choice = computed(() => {
    const p = this.product();
    if (!p) return '';
    const groups = this.optionGroups();
    return groups.length > 0
      ? describeOptionLines(optionLinesFor(groups, this.optionPicks()))
      : describeChoice(p, this.selectedVariations(), this.modifierCounts());
  });

  /** What the product is — picks the placeholder and the note's wording. */
  readonly kind = computed(() => {
    const p = this.product();
    if (!p) return 'OTHER';
    const category = this.menu()?.categories.find((c) => c.id === p.categoryId) ?? null;
    return productKind(p, category);
  });

  readonly isDrink = computed(() => isDrinkKind(this.kind()));

  /** Calories are a meal's: a drink or a pastry shows none, whatever an older API sends. */
  readonly hasNutrition = computed(() => showsNutrition(this.kind()));

  /** The store's answer for the product on screen (see `storeSuggestions`). */
  private readonly suggestions = storeSuggestions(() => {
    const menu = this.menu();
    const product = this.product();
    return menu && product ? { storeId: menu.storeId, productIds: [product.id] } : null;
  });

  /**
   * Under the product: what customers buy together with it, else — under a
   * drink — food and bakery from the same menu («К этому напитку»).
   */
  readonly pairings = computed<SuggestionRow>(() => {
    const product = this.product();
    return product ? suggestionRow(this.menu(), [product.id], this.suggestions(), 6) : { items: [], source: 'rule' };
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
    this.fetchProduct(slug).subscribe({
      next: (p) => {
        this.product.set(p);
        this.selectedVariations.set(defaultVariationSelection(p.variations));
        this.modifierCounts.set(initialModifierCounts(p.modifiers));
        this.optionPicks.set(defaultOptionPicks(orderOptionGroups(p.optionGroups ?? [])));
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

  /** The product by its slug, in the active store's brand when it has it. */
  private fetchProduct(slug: string): Observable<ProductDetail> {
    const active = this.activeStore.current();
    return this.catalog
      .getProduct(slug, active)
      .pipe(
        catchError((err: unknown) =>
          active && (err as { status?: number }).status === 404 ? this.catalog.getProduct(slug) : throwError(() => err),
        ),
      );
  }

  /**
   * Telegram's button carries the price; while the choice cannot go in the
   * cart it is inert and says what is missing instead.
   */
  private refreshMainButton(): void {
    if (!this.authStore.isAuthenticated() || this.storeClosed()) {
      this.tg.hideMainButton();
      return;
    }
    const problem = this.optionProblem();
    if (problem) {
      this.tg.setMainButton(this.translate.instant(problem.key, problem), () => undefined, false);
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

  /**
   * The product's groups as the store has them now. The customer's choice
   * stays, less whatever left the menu, which the screen could no longer
   * show to take back.
   */
  private refreshOptions(slug: string): void {
    this.fetchProduct(slug).subscribe({
      next: (p) => {
        this.product.set(p);
        this.optionPicks.update((picks) => normalizeOptionPicks(this.optionGroups(), picks));
      },
      error: () => undefined,
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
    if (!p || !store || this.optionProblem()) return;
    this.tg.haptic('medium');
    const notes = this.notes.trim() || undefined;
    this.cartService
      .add(
        this.optionGroups().length > 0
          ? { storeId: store.id, productId: p.id, quantity: 1, options: toOptionSelections(this.optionPicks()), notes }
          : {
              storeId: store.id,
              productId: p.id,
              quantity: 1,
              variationIds: Object.values(this.selectedVariations()).filter((id): id is string => Boolean(id)),
              modifiers: this.modifierCounts(),
              notes,
            },
      )
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
          // An option ran out or left the menu while the screen was open:
          // fetch the product again, so the screen greys it out and says
          // what to change.
          if (err.error?.code === 'OPTIONS_INVALID') this.refreshOptions(p.slug);
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
