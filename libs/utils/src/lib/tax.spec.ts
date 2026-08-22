import { computeTax, type TaxInput } from './tax';

function input(overrides: Partial<TaxInput> = {}): TaxInput {
  return {
    subtotalCents: 2000,
    discountCents: 0,
    deliveryFeeCents: 0,
    giftCardCents: 0,
    taxRateBps: 0,
    taxIncludedInPrice: true,
    ...overrides,
  };
}

describe('computeTax', () => {
  it('charges nothing and changes nothing at a zero rate', () => {
    expect(computeTax(input())).toEqual({ taxableCents: 2000, taxCents: 0, totalCents: 2000 });
  });

  describe('tax already in the price (UAE, UK, EU retail)', () => {
    it('carves the tax out without changing what the customer pays', () => {
      // 20.00 AED at 5% VAT: the customer pays 20.00, of which 0.95 is tax.
      const result = computeTax(input({ taxRateBps: 500 }));

      expect(result.totalCents).toBe(2000);
      expect(result.taxCents).toBe(95); // 2000 * 500 / 10500
    });

    it('carves out UK VAT correctly', () => {
      // 12.00 GBP at 20%: 2.00 of it is VAT.
      const result = computeTax(input({ subtotalCents: 1200, taxRateBps: 2000 }));

      expect(result.totalCents).toBe(1200);
      expect(result.taxCents).toBe(200);
    });

    it('never lets the carved-out tax exceed the price', () => {
      const result = computeTax(input({ subtotalCents: 100, taxRateBps: 2000 }));
      expect(result.taxCents).toBeLessThan(100);
    });
  });

  describe('tax added at the till (most of the US)', () => {
    it('adds the tax on top', () => {
      const result = computeTax(input({ taxRateBps: 875, taxIncludedInPrice: false }));

      expect(result.taxCents).toBe(175); // 2000 * 875 / 10000
      expect(result.totalCents).toBe(2175);
    });
  });

  describe('what the tax applies to', () => {
    it('taxes the discounted price, not the list price', () => {
      // A promo lowers the price, so it lowers the tax with it.
      const result = computeTax(input({ discountCents: 500, taxRateBps: 2000, taxIncludedInPrice: false }));

      expect(result.taxableCents).toBe(1500);
      expect(result.taxCents).toBe(300);
      expect(result.totalCents).toBe(1800);
    });

    it('taxes the delivery fee — it is a taxable service', () => {
      const result = computeTax(input({ deliveryFeeCents: 500, taxRateBps: 2000, taxIncludedInPrice: false }));

      expect(result.taxableCents).toBe(2500);
      expect(result.taxCents).toBe(500);
    });

    it('does NOT let a gift card reduce the tax', () => {
      // A gift card is a means of payment. Paying with one does not make the
      // sale tax-free, so the tax is identical to the no-gift-card case and
      // only the amount owed changes.
      const withoutCard = computeTax(input({ taxRateBps: 2000, taxIncludedInPrice: false }));
      const withCard = computeTax(input({ taxRateBps: 2000, taxIncludedInPrice: false, giftCardCents: 1000 }));

      expect(withCard.taxCents).toBe(withoutCard.taxCents);
      expect(withCard.totalCents).toBe(withoutCard.totalCents - 1000);
    });

    it('holds for a tax-inclusive store too', () => {
      const withoutCard = computeTax(input({ taxRateBps: 500 }));
      const withCard = computeTax(input({ taxRateBps: 500, giftCardCents: 800 }));

      expect(withCard.taxCents).toBe(withoutCard.taxCents);
      expect(withCard.totalCents).toBe(1200);
    });
  });

  describe('edges', () => {
    it('never returns a negative total when the gift card covers everything', () => {
      const result = computeTax(input({ taxRateBps: 500, giftCardCents: 99999 }));
      expect(result.totalCents).toBe(0);
    });

    it('floors the taxable base at zero when a discount exceeds the subtotal', () => {
      const result = computeTax(input({ discountCents: 9999, taxRateBps: 2000, taxIncludedInPrice: false }));

      expect(result.taxableCents).toBe(0);
      expect(result.taxCents).toBe(0);
      expect(result.totalCents).toBe(0);
    });

    it('still taxes delivery when the items are fully discounted', () => {
      const result = computeTax(
        input({ discountCents: 9999, deliveryFeeCents: 500, taxRateBps: 2000, taxIncludedInPrice: false }),
      );

      expect(result.taxableCents).toBe(500);
      expect(result.taxCents).toBe(100);
    });

    it('treats a negative rate as no tax rather than a credit', () => {
      const result = computeTax(input({ taxRateBps: -500 }));
      expect(result.taxCents).toBe(0);
      expect(result.totalCents).toBe(2000);
    });

    it('rounds once, so the parts reconcile with the total', () => {
      // 3.33 at 7.25%, added on top: 0.24 tax, 3.57 due.
      const result = computeTax(input({ subtotalCents: 333, taxRateBps: 725, taxIncludedInPrice: false }));

      expect(result.taxCents).toBe(24);
      expect(result.totalCents).toBe(result.taxableCents + result.taxCents);
    });

    it('keeps the inclusive total equal to the taxable base', () => {
      const result = computeTax(input({ subtotalCents: 777, taxRateBps: 725 }));
      expect(result.totalCents).toBe(result.taxableCents);
    });
  });
});
