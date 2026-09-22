import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/format/tax.dart';

/// Mirrors `libs/utils/src/lib/tax.spec.ts` case for case: the app shows the
/// total the API will charge, so the two implementations must agree.
TaxBreakdown tax({
  int subtotalCents = 2000,
  int discountCents = 0,
  int deliveryFeeCents = 0,
  int giftCardCents = 0,
  int taxRateBps = 0,
  bool taxIncludedInPrice = true,
}) => computeTax(
  subtotalCents: subtotalCents,
  discountCents: discountCents,
  deliveryFeeCents: deliveryFeeCents,
  giftCardCents: giftCardCents,
  taxRateBps: taxRateBps,
  taxIncludedInPrice: taxIncludedInPrice,
);

void main() {
  test('charges nothing and changes nothing at a zero rate', () {
    final r = tax();
    expect([r.taxableCents, r.taxCents, r.totalCents], [2000, 0, 2000]);
  });

  group('tax already in the price', () {
    test('carves the tax out without changing what the customer pays', () {
      final r = tax(taxRateBps: 500);
      expect(r.totalCents, 2000);
      expect(r.taxCents, 95);
    });

    test('carves out UK VAT correctly', () {
      final r = tax(subtotalCents: 1200, taxRateBps: 2000);
      expect(r.totalCents, 1200);
      expect(r.taxCents, 200);
    });

    test('never lets the carved-out tax exceed the price', () {
      expect(tax(subtotalCents: 100, taxRateBps: 2000).taxCents, lessThan(100));
    });
  });

  test('adds the tax on top where the price excludes it', () {
    final r = tax(taxRateBps: 875, taxIncludedInPrice: false);
    expect(r.taxCents, 175);
    expect(r.totalCents, 2175);
  });

  group('what the tax applies to', () {
    test('taxes the discounted price, not the list price', () {
      final r = tax(discountCents: 500, taxRateBps: 2000, taxIncludedInPrice: false);
      expect([r.taxableCents, r.taxCents, r.totalCents], [1500, 300, 1800]);
    });

    test('taxes the delivery fee', () {
      final r = tax(deliveryFeeCents: 500, taxRateBps: 2000, taxIncludedInPrice: false);
      expect(r.taxableCents, 2500);
      expect(r.taxCents, 500);
    });

    test('does not let a gift card reduce the tax', () {
      final without = tax(taxRateBps: 2000, taxIncludedInPrice: false);
      final withCard = tax(taxRateBps: 2000, taxIncludedInPrice: false, giftCardCents: 1000);
      expect(withCard.taxCents, without.taxCents);
      expect(withCard.totalCents, without.totalCents - 1000);
    });

    test('holds for a tax-inclusive store too', () {
      final without = tax(taxRateBps: 500);
      final withCard = tax(taxRateBps: 500, giftCardCents: 800);
      expect(withCard.taxCents, without.taxCents);
      expect(withCard.totalCents, 1200);
    });
  });

  group('edges', () {
    test('never returns a negative total when the gift card covers everything', () {
      expect(tax(taxRateBps: 500, giftCardCents: 99999).totalCents, 0);
    });

    test('floors the taxable base at zero when a discount exceeds the subtotal', () {
      final r = tax(discountCents: 9999, taxRateBps: 2000, taxIncludedInPrice: false);
      expect([r.taxableCents, r.taxCents, r.totalCents], [0, 0, 0]);
    });

    test('still taxes delivery when the items are fully discounted', () {
      final r = tax(discountCents: 9999, deliveryFeeCents: 500, taxRateBps: 2000, taxIncludedInPrice: false);
      expect(r.taxableCents, 500);
      expect(r.taxCents, 100);
    });

    test('treats a negative rate as no tax rather than a credit', () {
      final r = tax(taxRateBps: -500);
      expect(r.taxCents, 0);
      expect(r.totalCents, 2000);
    });

    test('rounds once, so the parts reconcile with the total', () {
      final r = tax(subtotalCents: 333, taxRateBps: 725, taxIncludedInPrice: false);
      expect(r.taxCents, 24);
      expect(r.totalCents, r.taxableCents + r.taxCents);
    });

    test('keeps the inclusive total equal to the taxable base', () {
      final r = tax(subtotalCents: 777, taxRateBps: 725);
      expect(r.totalCents, r.taxableCents);
    });
  });
}
