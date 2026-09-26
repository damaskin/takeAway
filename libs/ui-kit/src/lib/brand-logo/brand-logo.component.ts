import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * takeAway logo: the cup-with-arrow mark followed by the "takeAway" wordmark
 * set in the display face (Fraunces). The mark is drawn with `currentColor`,
 * so `color` on the host recolours both parts.
 *
 * Source of the mark: `tools/brand/mark.svg` (keep the paths in sync).
 */
@Component({
  selector: 'lib-brand-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lib-brand-logo',
    '[style.--lib-brand-logo-size.px]': 'size()',
    '[attr.role]': 'wordmark() ? null : "img"',
    '[attr.aria-label]': 'wordmark() ? null : "takeAway"',
  },
  template: `
    <svg
      class="lib-brand-logo__mark"
      viewBox="0 0 75 100"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="2.9"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M11.3 9.8L46 13.1L44.5 1.4L73.3 21.3L45.9 42L47.4 30.5L1.4 30.5L3.1 20.8L8.5 20.8Z" />
      <path d="M8.7 37.3L38.9 37.3L38.4 40A7.1 7.1 0 0 0 50.6 46.2L66.7 35.8L59.6 98.6L16.2 98.6Z" />
    </svg>
    @if (wordmark()) {
      <span class="lib-brand-logo__word">takeAway</span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: calc(var(--lib-brand-logo-size) * 0.3);
        color: var(--color-caramel);
        line-height: 1;
      }
      .lib-brand-logo__mark {
        height: calc(var(--lib-brand-logo-size) * 1.15);
        width: auto;
        flex: none;
        /* The arrow sits high; nudge so the cup body lines up with the text. */
        margin-top: calc(var(--lib-brand-logo-size) * -0.12);
      }
      .lib-brand-logo__word {
        font-family: var(--font-display);
        font-size: var(--lib-brand-logo-size);
        font-weight: 700;
        white-space: nowrap;
      }
    `,
  ],
})
export class BrandLogoComponent {
  /** Font size of the wordmark in px; the mark scales with it. */
  readonly size = input(24);
  /** Show the "takeAway" text next to the mark. */
  readonly wordmark = input(true);
}
