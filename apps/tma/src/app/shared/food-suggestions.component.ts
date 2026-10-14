import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { checkoutErrorText, LocaleFormatService } from '@takeaway/i18n';
import { ProductImageComponent } from '@takeaway/ui-kit';
import {
  defaultVariationSelection,
  type FoodSuggestion,
  hasRequiredOptions,
  initialModifierCounts,
} from '@takeaway/utils';
import { EMPTY, switchMap } from 'rxjs';

import { CartService, type CartView } from '../core/cart/cart.service';
import { CatalogService } from '../core/catalog/catalog.service';
import { TelegramBridgeService } from '../core/telegram/telegram-bridge.service';

/**
 * A row of things to eat next to the drinks — «Добавить к напитку?» at
 * checkout, «К этому напитку» on a drink's screen (see `suggestFood`).
 *
 * A card opens the product; its «+» adds one straight to the cart with the
 * default options, unless the product has an add-on that must be taken —
 * then the product screen opens, so the customer sees what goes in.
 */
@Component({
  selector: 'app-tma-food-suggestions',
  standalone: true,
  imports: [ProductImageComponent, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="title">{{ title() | translate }}</span>
    <div class="row">
      @for (s of suggestions(); track s.product.id) {
        <div class="card" data-testid="food-suggestion">
          <a class="open" [routerLink]="['/products', s.product.slug]">
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
      <span class="error" role="alert">{{ error() }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 10px;
        font-family: var(--font-sans);
      }
      .title {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .row {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        margin: 0 -16px;
        padding: 0 16px 2px;
        scrollbar-width: none;
      }
      .row::-webkit-scrollbar {
        display: none;
      }
      .card {
        position: relative;
        flex: none;
        width: 124px;
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
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
        padding: 2px 10px 0;
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
        padding: 0 40px 0 10px;
        font-size: 12px;
        font-weight: 700;
        color: var(--color-caramel);
      }
      .add {
        position: absolute;
        right: 8px;
        bottom: 8px;
        width: 28px;
        height: 28px;
        border-radius: var(--radius-pill);
        background: var(--color-caramel);
        color: var(--tg-button-text-color, #fff);
        font: 700 16px/1 var(--font-sans);
      }
      .add:disabled {
        opacity: 0.6;
      }
      .add.done {
        background: var(--color-mint);
      }
      .error {
        font-size: 12px;
        color: var(--color-berry);
      }
    `,
  ],
})
export class TmaFoodSuggestionsComponent {
  private readonly catalog = inject(CatalogService);
  private readonly cart = inject(CartService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly tg = inject(TelegramBridgeService);
  readonly fmt = inject(LocaleFormatService);

  readonly suggestions = input.required<readonly FoodSuggestion[]>();
  /** The store the items go to: its id for the cart and the product lookup, currency for prices. */
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

  quickAdd(suggestion: FoodSuggestion): void {
    const store = this.store();
    const { product } = suggestion;
    if (this.busy()) return;
    this.tg.haptic('light');
    this.busy.set(product.id);
    this.error.set(null);
    this.catalog
      .getProduct(product.slug, store.id)
      .pipe(
        switchMap((detail) => {
          if (hasRequiredOptions(detail)) {
            void this.router.navigate(['/products', product.slug]);
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
          this.tg.haptic('medium');
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
              this.translate.instant('tma.product.addFailed'),
          );
        },
        complete: () => this.busy.set(null),
      });
  }
}
