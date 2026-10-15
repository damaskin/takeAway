import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { checkoutErrorText, LocaleFormatService } from '@takeaway/i18n';
import { ProductImageComponent } from '@takeaway/ui-kit';
import {
  defaultVariationSelection,
  hasRequiredOptions,
  initialModifierCounts,
  type ProductSuggestion,
} from '@takeaway/utils';
import { EMPTY, switchMap } from 'rxjs';

import { CartService, type CartView } from '../core/cart/cart.service';
import { CatalogService } from '../core/catalog/catalog.service';

/**
 * A row of products to add next to those in hand — at checkout and on a
 * product's page. «Часто берут вместе» when the store's orders say what
 * goes together, else something to eat next to the drinks: «Добавить к
 * напитку?», «К этому напитку» (see `suggestionRow`).
 *
 * A card opens the product; its «+» adds one straight to the cart with the
 * default size and milk, unless the product has an add-on that must be taken
 * — then the product page opens, so the customer sees what goes in and what
 * it costs.
 */
@Component({
  selector: 'app-food-suggestions',
  standalone: true,
  imports: [ProductImageComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">{{ title() | translate }}</h2>
    <div class="row">
      @for (s of suggestions(); track s.product.id) {
        <div class="card" data-testid="food-suggestion">
          <a class="open" [routerLink]="['/products', s.product.slug]" [queryParams]="{ store: store().slug }">
            <lib-product-image class="image" [src]="s.product.imageUrls[0]" [kind]="s.kind" [alt]="s.product.name" />
            <span class="name">{{ s.product.name }}</span>
            <span class="price">{{ fmt.money(s.product.basePriceCents, store().currency) }}</span>
          </a>
          @if (canAdd()) {
            <button
              type="button"
              class="add"
              [class.done]="added().has(s.product.id)"
              [disabled]="busy() !== null"
              [attr.aria-label]="'common.upsell.add' | translate: { name: s.product.name }"
              (click)="quickAdd(s)"
            >
              {{ added().has(s.product.id) ? '✓' : '+' }}
            </button>
          }
        </div>
      }
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--font-sans);
      }
      .title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .row {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding-bottom: 4px;
        scrollbar-width: thin;
      }
      .card {
        position: relative;
        flex: none;
        width: 140px;
        border: 1px solid var(--color-border-light);
        border-radius: 16px;
        background: var(--color-foam);
        overflow: hidden;
      }
      .open {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-bottom: 10px;
      }
      .image {
        aspect-ratio: 1;
      }
      .name {
        padding: 4px 10px 0;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--color-text-primary);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .price {
        padding: 0 44px 0 10px;
        font-size: 13px;
        font-weight: 700;
        color: var(--color-caramel);
      }
      .add {
        position: absolute;
        right: 8px;
        bottom: 8px;
        width: 30px;
        height: 30px;
        border-radius: var(--radius-pill);
        background: var(--color-caramel);
        color: #fff;
        font: 700 17px/1 var(--font-sans);
      }
      .add:disabled {
        opacity: 0.6;
      }
      .add.done {
        background: var(--color-mint);
      }
      .error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
    `,
  ],
})
export class FoodSuggestionsComponent {
  private readonly catalog = inject(CatalogService);
  private readonly cart = inject(CartService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  readonly fmt = inject(LocaleFormatService);

  readonly suggestions = input.required<readonly ProductSuggestion[]>();
  /** The store the items go to: its id for the cart, slug for links, currency for prices. */
  readonly store = input.required<{ id: string; slug: string; currency: string }>();
  /** Translation key of the heading. */
  readonly title = input('common.upsell.title');
  /** Signed in and the store takes orders: the «+» shows. */
  readonly canAdd = input(false);
  /** The cart after a quick add. */
  readonly cartChanged = output<CartView>();

  /** The product being added, so a second tap waits. */
  readonly busy = signal<string | null>(null);
  readonly added = signal<ReadonlySet<string>>(new Set());
  readonly error = signal<string | null>(null);

  quickAdd(suggestion: ProductSuggestion): void {
    const store = this.store();
    const { product } = suggestion;
    if (this.busy()) return;
    this.busy.set(product.id);
    this.error.set(null);
    this.catalog
      .getProduct(product.slug, store.slug)
      .pipe(
        switchMap((detail) => {
          if (hasRequiredOptions(detail)) {
            void this.router.navigate(['/products', product.slug], { queryParams: { store: store.slug } });
            return EMPTY;
          }
          return this.cart.add({
            storeId: store.id,
            productId: detail.id,
            quantity: 1,
            variationIds: Object.values(defaultVariationSelection(detail.variations)).filter((id): id is string =>
              Boolean(id),
            ),
            modifiers: initialModifierCounts(detail.modifiers),
          });
        }),
      )
      .subscribe({
        next: (cart) => {
          this.added.update((ids) => new Set(ids).add(product.id));
          this.cartChanged.emit(cart);
        },
        error: (err: { error?: { message?: unknown } }) => {
          this.busy.set(null);
          const body = err.error;
          const message = typeof body?.message === 'string' && body.message ? body.message : null;
          this.error.set(
            checkoutErrorText(body, this.translate, this.fmt) ??
              message ??
              this.translate.instant('web.product.addFailed'),
          );
        },
        complete: () => this.busy.set(null),
      });
  }
}
