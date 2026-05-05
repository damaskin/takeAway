import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

export interface ReceiptForPdf {
  orderCode: string;
  storeName: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  items: Array<{ name: string; quantity: number; totalCents: number }>;
  /** ISO-8601 of when the order was paid; printed as the receipt date. */
  issuedAt?: string;
}

const PDF_TIMEOUT_MS = 5000;

/**
 * Renders a PDF receipt using pdfkit's built-in Helvetica face. That face
 * is ASCII-only — embedding a Cyrillic-capable font would balloon the
 * api Docker image by ~250KB per font face, so for now we **fall back to
 * "no PDF"** when the receipt contains non-ASCII text. The customer still
 * gets the HTML email in that case; only the attachment is dropped.
 *
 * If/when product names start carrying Cyrillic / CJK / RTL glyphs, the
 * fix is to register one Roboto-equivalent font at module init and route
 * every text() call through it.
 */
@Injectable()
export class ReceiptPdfService {
  private readonly logger = new Logger(ReceiptPdfService.name);

  /**
   * Returns a PDF buffer, or `null` when the receipt contains characters
   * that the built-in Helvetica face cannot render. The caller (mail
   * service) treats `null` as "send the HTML email without an attachment".
   */
  async render(receipt: ReceiptForPdf): Promise<Buffer | null> {
    if (!this.isAsciiSafe(receipt)) {
      this.logger.debug(`receipt #${receipt.orderCode} has non-ASCII content — skipping PDF attachment`);
      return null;
    }

    return await new Promise<Buffer | null>((resolve) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `takeAway receipt #${receipt.orderCode}` } });
      const timeout = setTimeout(() => {
        this.logger.warn(`receipt #${receipt.orderCode} PDF render timed out`);
        try {
          doc.end();
        } catch {
          /* swallow */
        }
        resolve(null);
      }, PDF_TIMEOUT_MS);

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
      doc.on('error', (err: unknown) => {
        clearTimeout(timeout);
        this.logger.error(`receipt #${receipt.orderCode} PDF render failed: ${err instanceof Error ? err.message : err}`);
        resolve(null);
      });

      try {
        this.draw(doc, receipt);
        doc.end();
      } catch (err) {
        clearTimeout(timeout);
        this.logger.error(`receipt #${receipt.orderCode} PDF synth threw: ${err instanceof Error ? err.message : err}`);
        resolve(null);
      }
    });
  }

  private draw(doc: PDFKit.PDFDocument, receipt: ReceiptForPdf): void {
    const fmt = (cents: number) => formatMoney(cents, receipt.currency);

    doc.font('Helvetica-Bold').fontSize(20).text('takeAway', { align: 'left' });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor('#555').text('Pre-order. Skip the queue. Pick it up.');
    doc.moveDown(1);

    doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(`Receipt #${receipt.orderCode}`);
    doc.font('Helvetica').fontSize(10).fillColor('#555').text(receipt.storeName);
    if (receipt.issuedAt) doc.text(receipt.issuedAt);
    doc.moveDown(1);

    // Items table — fixed column widths, single line per row. Long names wrap
    // by pdfkit's continued-text behaviour; we do not paginate explicitly
    // because a typical takeaway receipt fits on one A4.
    const colName = 50;
    const colQty = 360;
    const colTotal = 430;
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(11);
    doc.text('Item', colName, doc.y, { continued: true });
    doc.text('Qty', colQty, undefined, { continued: true });
    doc.text('Total', colTotal);
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10);
    for (const it of receipt.items) {
      const y = doc.y;
      doc.text(it.name, colName, y, { width: 300 });
      doc.text(`x${it.quantity}`, colQty, y);
      doc.text(fmt(it.totalCents), colTotal, y);
      doc.moveDown(0.3);
    }
    doc.moveDown(0.8);

    // Totals block — right-aligned summary stack.
    const totalsX = 350;
    const writeRow = (label: string, value: string, bold = false) => {
      const font = bold ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(font).fontSize(11);
      const y = doc.y;
      doc.text(label, totalsX, y);
      doc.text(value, totalsX + 90, y, { align: 'right', width: 100 });
      doc.moveDown(0.3);
    };

    writeRow('Subtotal', fmt(receipt.subtotalCents));
    if (receipt.discountCents > 0) writeRow('Discount', `-${fmt(receipt.discountCents)}`);
    if (receipt.deliveryFeeCents > 0) writeRow('Delivery', fmt(receipt.deliveryFeeCents));
    writeRow('Total', fmt(receipt.totalCents), true);

    doc.moveDown(2);
    doc.font('Helvetica').fontSize(8).fillColor('#888');
    doc.text(`Generated by takeAway · order ${receipt.orderCode}`, 50, undefined, { align: 'center' });
  }

  private isAsciiSafe(receipt: ReceiptForPdf): boolean {
    const probe = [receipt.storeName, ...receipt.items.map((i) => i.name)].join('\n');
    // 0x09 (tab), 0x0A (newline), 0x0D (CR) plus printable ASCII range.
    return /^[\t\n\r\x20-\x7E]*$/.test(probe);
  }
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
