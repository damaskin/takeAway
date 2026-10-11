import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { productPlaceholderSrc } from './product-placeholder';

/**
 * A product's picture: its photo filling the box, or — when the business has
 * not uploaded one, or the photo fails to load — the illustration for its
 * category kind, whole and centred. So a menu without photos still reads as
 * one style instead of a grid of grey boxes.
 *
 * The box is sized by the host (width, height or aspect-ratio on
 * `lib-product-image`). Its background stays light in every theme: the
 * illustrations, like product photos, are drawn on white.
 */
@Component({
  selector: 'lib-product-image',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lib-product-image',
    '[class.lib-product-image--placeholder]': '!photo()',
  },
  template: `
    @if (photo(); as url) {
      <img
        [src]="url"
        [alt]="alt()"
        [attr.loading]="eager() ? null : 'lazy'"
        decoding="async"
        (error)="failed.set(url)"
      />
    } @else {
      <img class="placeholder" [src]="placeholder()" [alt]="alt()" decoding="async" />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        overflow: hidden;
        background: var(--lib-product-image-bg, #ffffff);
      }
      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      img.placeholder {
        object-fit: contain;
        padding: 6%;
        box-sizing: border-box;
      }
    `,
  ],
})
export class ProductImageComponent {
  /** The product's first photo, if it has one. */
  readonly src = input<string | null | undefined>(null);
  /** The product's category kind (`CategoryKind`); anything unknown draws the neutral bag. */
  readonly kind = input<string | null | undefined>(null);
  readonly alt = input('');
  /** Load at once — the hero of a product page — instead of when scrolled near. */
  readonly eager = input(false);

  /** The photo that failed to load, so a new `src` gets its own chance. */
  protected readonly failed = signal<string | null>(null);

  protected readonly photo = computed(() => {
    const src = this.src()?.trim();
    return src && src !== this.failed() ? src : null;
  });

  protected readonly placeholder = computed(() => productPlaceholderSrc(this.kind()));
}
