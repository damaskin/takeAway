import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';

/**
 * Square logo tile for a store card: the business's own logo, whole and
 * centred on a light tile, when it has uploaded one; otherwise a quiet
 * storefront icon. A logo that fails to load falls back to the icon too, so
 * a card never shows a broken image.
 *
 * The logo is fitted (`contain`), not cropped: wide wordmarks used to lose
 * their ends to `cover`. The tile stays light in every theme — logos are
 * drawn for a light background, and a transparent PNG with dark ink would
 * vanish on a dark Telegram theme.
 */
@Component({
  selector: 'lib-store-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lib-store-logo',
    '[style.--lib-store-logo-size.px]': 'size()',
    '[class.lib-store-logo--image]': 'showsImage()',
  },
  template: `
    @if (showsImage()) {
      <img [src]="url()" [alt]="name()" loading="lazy" (error)="failed.set(true)" />
    } @else {
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path
          d="M21.9 8.89l-1.05-4.37c-.22-.9-1-1.52-1.91-1.52H5.05c-.9 0-1.69.63-1.9 1.52L2.1 8.89c-.24 1.02-.02 2.06.62 2.88.08.11.19.19.28.29V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-6.94c.09-.09.2-.18.28-.28.64-.82.87-1.87.62-2.89zM13 5h1.96l.54 4.52c.05.39-.07.78-.33 1.07-.22.26-.54.41-.95.41-.67 0-1.22-.59-1.22-1.31V5zM8.49 9.52L9.04 5H11v4.69c0 .72-.55 1.31-1.29 1.31-.34 0-.65-.15-.89-.41-.25-.29-.37-.68-.33-1.07zm-4.45-.16L5.05 5h1.97l-.58 4.86c-.08.65-.6 1.14-1.21 1.14-.49 0-.8-.29-.93-.47-.27-.34-.36-.79-.26-1.17zM5 19v-6.03c.08.01.15.03.23.03.87 0 1.66-.36 2.24-.95.6.6 1.4.95 2.31.95.87 0 1.65-.36 2.23-.93.59.57 1.39.93 2.29.93.84 0 1.64-.35 2.24-.95.58.59 1.37.95 2.24.95.08 0 .15-.02.23-.03V19H5zM19.18 11c-.61 0-1.14-.49-1.21-1.14L17.39 5l1.94-.01 1.05 4.37c.1.42.01.85-.25 1.18-.14.18-.44.46-.95.46z"
        />
      </svg>
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
        background: color-mix(in srgb, var(--color-caramel) 13%, transparent);
        color: var(--color-caramel);
        overflow: hidden;
      }
      :host(.lib-store-logo--image) {
        /* Fixed light tile, not a theme token: see the class comment. */
        background: #ffffff;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
        padding: calc(var(--lib-store-logo-size) * 0.1);
        box-sizing: border-box;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
      }
      svg {
        width: 50%;
        height: 50%;
      }
    `,
  ],
})
export class StoreLogoComponent {
  readonly url = input<string | null | undefined>(null);
  /** Business name, used as the image's alt text. */
  readonly name = input('');
  readonly size = input(44);
  /** Reset when the url changes, so a new logo gets its own chance to load. */
  protected readonly failed = linkedSignal({ source: this.url, computation: () => false });
  protected readonly showsImage = computed(() => !!this.url() && !this.failed());
}
