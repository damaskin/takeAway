import { ReceiptPdfService } from './receipt-pdf.service';

describe('ReceiptPdfService', () => {
  const service = new ReceiptPdfService();

  const baseReceipt = {
    orderCode: '4832',
    storeName: 'Downtown Lisbon',
    currency: 'EUR',
    subtotalCents: 850,
    discountCents: 50,
    deliveryFeeCents: 0,
    totalCents: 800,
    items: [
      { name: 'Latte', quantity: 2, totalCents: 600 },
      { name: 'Croissant', quantity: 1, totalCents: 250 },
    ],
    issuedAt: '2026-05-05T08:30:00Z',
  };

  it('renders a PDF buffer that starts with the %PDF magic bytes', async () => {
    const buf = await service.render(baseReceipt);
    expect(buf).not.toBeNull();
    // First four bytes are 0x25 0x50 0x44 0x46 → "%PDF"
    expect(buf!.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(buf!.length).toBeGreaterThan(800); // sanity — empty pdfkit doc is ~1KB
  });

  it('returns null when the receipt contains non-ASCII characters (Helvetica fallback)', async () => {
    const buf = await service.render({ ...baseReceipt, storeName: 'Кофе на углу' });
    expect(buf).toBeNull();
  });

  it('returns null when an item name is non-ASCII', async () => {
    const buf = await service.render({
      ...baseReceipt,
      items: [{ name: 'Латте', quantity: 1, totalCents: 300 }],
    });
    expect(buf).toBeNull();
  });
});
