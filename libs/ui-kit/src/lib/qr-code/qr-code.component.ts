import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/** Modules of white around the code, as the QR standard asks, so a camera finds its edges. */
const QUIET_ZONE = 4;

/**
 * A QR code of a text, drawn in the browser as one SVG path: the text never
 * leaves the page for a third-party image service. Black on white whatever
 * the theme — bank apps read a dark-on-light code. Sized by the host
 * (`width` on `lib-qr-code`); the picture keeps its square.
 */
@Component({
  selector: 'lib-qr-code',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (code(); as qr) {
      <svg
        role="img"
        [attr.aria-label]="label()"
        [attr.viewBox]="qr.viewBox"
        shape-rendering="crispEdges"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect [attr.x]="-quiet" [attr.y]="-quiet" width="100%" height="100%" fill="#ffffff" />
        <path [attr.d]="qr.path" fill="#000000" />
      </svg>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        background: #ffffff;
      }
      svg {
        display: block;
        width: 100%;
        height: auto;
      }
    `,
  ],
})
export class QrCodeComponent {
  /** What the code says. */
  readonly text = input.required<string>();
  /** Read out by a screen reader. */
  readonly label = input('');

  protected readonly quiet = QUIET_ZONE;

  readonly code = computed(() => {
    const text = this.text();
    if (!text) return null;
    // Error correction M: read off a phone screen at arm's length, a smudge or a glare allowed.
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    let path = '';
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
      }
    }
    const side = size + QUIET_ZONE * 2;
    return { size, path, viewBox: `${-QUIET_ZONE} ${-QUIET_ZONE} ${side} ${side}` };
  });
}
