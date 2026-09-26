import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

import { BrandLogoComponent } from '../brand-logo/brand-logo.component';

/**
 * Square logo tile for a store card: the business's own logo when it has
 * uploaded one, otherwise the takeAway mark. A logo that fails to load
 * falls back to the mark too, so a card never shows a broken image.
 */
@Component({
  selector: 'lib-store-logo',
  standalone: true,
  imports: [BrandLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lib-store-logo',
    '[style.--lib-store-logo-size.px]': 'size()',
    '[class.lib-store-logo--image]': 'url() && !failed()',
  },
  template: `
    @if (url() && !failed()) {
      <img [src]="url()" [alt]="name()" loading="lazy" (error)="failed.set(true)" />
    } @else {
      <lib-brand-logo [size]="size() * 0.42" [wordmark]="false" />
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: var(--lib-store-logo-size);
        height: var(--lib-store-logo-size);
        border-radius: calc(var(--lib-store-logo-size) * 0.29);
        border: 1px solid var(--color-border-light);
        background: var(--color-latte);
        overflow: hidden;
      }
      /* Logos are drawn for a light background, whatever the theme. */
      :host(.lib-store-logo--image) {
        background: #fff;
      }
      img {
        width: 84%;
        height: 84%;
        object-fit: contain;
      }
    `,
  ],
})
export class StoreLogoComponent {
  readonly url = input<string | null | undefined>(null);
  /** Business name, used as the image's alt text. */
  readonly name = input('');
  readonly size = input(44);
  protected readonly failed = signal(false);
}
