import qrcode from 'qrcode-generator';

/** A QR code as one SVG path over a square of `size` modules, drawn in the template. */
export interface QrCode {
  size: number;
  /** One `M x y h1 v1 h-1 z` square per dark module. */
  path: string;
}

/**
 * The QR code of a short text — a t.me link — built in the browser, so the
 * link never leaves the page for a third-party image service. Error
 * correction M: a phone reads it off a tablet screen at arm's length.
 */
export function qrCode(text: string): QrCode {
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
  return { size, path };
}
