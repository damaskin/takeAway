/// Dart port of `computeTax` from `libs/utils/src/lib/tax.ts` — the same
/// function the API settles orders with, so the total on the pay button is
/// the total that gets charged.
///
/// A promo (and points) reduce the taxable base; a gift card is a means of
/// payment and is deducted after tax. Everything is integer cents with a
/// single rounding on the tax figure.
class TaxBreakdown {
  const TaxBreakdown({required this.taxableCents, required this.taxCents, required this.totalCents});

  final int taxableCents;
  final int taxCents;
  final int totalCents;
}

TaxBreakdown computeTax({
  required int subtotalCents,
  required int discountCents,
  required int deliveryFeeCents,
  required int giftCardCents,
  required int taxRateBps,
  required bool taxIncludedInPrice,
}) {
  final rate = taxRateBps < 0 ? 0 : taxRateBps;
  final taxable = _max0(subtotalCents - discountCents) + deliveryFeeCents;

  if (rate == 0) {
    return TaxBreakdown(taxableCents: taxable, taxCents: 0, totalCents: _max0(taxable - giftCardCents));
  }
  if (taxIncludedInPrice) {
    final tax = _roundHalfUp(taxable * rate / (10000 + rate));
    return TaxBreakdown(taxableCents: taxable, taxCents: tax, totalCents: _max0(taxable - giftCardCents));
  }
  final tax = _roundHalfUp(taxable * rate / 10000);
  return TaxBreakdown(taxableCents: taxable, taxCents: tax, totalCents: _max0(taxable + tax - giftCardCents));
}

int _max0(int value) => value < 0 ? 0 : value;

/// JavaScript's `Math.round` — halves go up, matching the server exactly.
int _roundHalfUp(double value) => (value + 0.5).floor();
