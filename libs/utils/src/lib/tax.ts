/**
 * Sales tax on an order.
 *
 * Two things decide the arithmetic, and getting either wrong produces a
 * receipt that is legally wrong rather than merely surprising:
 *
 *  1. **Whether the menu price already contains the tax.** In the UAE, the
 *     UK and the EU a displayed retail price is tax-inclusive: a 20 AED
 *     latte costs 20 AED and the VAT is carved out of it for the receipt.
 *     In most of the US the tax is added at the till. `taxIncludedInPrice`
 *     picks which, and it changes what the customer pays, not just what we
 *     print.
 *
 *  2. **What the tax applies to.** A promo discount reduces the taxable
 *     amount, because it reduces the price. A gift card does not — it is a
 *     means of payment, and paying with one does not make the sale
 *     tax-free. So the gift card is deducted after tax is settled.
 *
 * Everything is integer cents; the single rounding happens on the tax
 * figure itself so subtotal, tax and total always reconcile.
 */

export interface TaxInput {
  /** Sum of line items, before any discount. */
  subtotalCents: number;
  /** Promo discount — reduces the taxable base. */
  discountCents: number;
  /** Delivery is a taxable service in every market we target. */
  deliveryFeeCents: number;
  /** Gift-card draw — a payment method, applied after tax. */
  giftCardCents: number;
  /** Store's rate in basis points: 500 = 5%, 2000 = 20%. */
  taxRateBps: number;
  /** True when menu prices already include the tax. */
  taxIncludedInPrice: boolean;
}

export interface TaxBreakdown {
  /** What the tax was charged on. */
  taxableCents: number;
  /** The tax itself — carved out of, or added on top of, the taxable base. */
  taxCents: number;
  /** What the customer actually pays. */
  totalCents: number;
}

export function computeTax(input: TaxInput): TaxBreakdown {
  const { subtotalCents, discountCents, deliveryFeeCents, giftCardCents } = input;
  const rate = Math.max(0, Math.round(input.taxRateBps));

  const taxableCents = Math.max(0, subtotalCents - discountCents) + deliveryFeeCents;

  if (rate === 0) {
    return { taxableCents, taxCents: 0, totalCents: Math.max(0, taxableCents - giftCardCents) };
  }

  if (input.taxIncludedInPrice) {
    // Carve the tax out: for a gross G at rate r, tax = G * r / (1 + r).
    // The customer pays G either way — this line is disclosure, not a charge.
    const taxCents = Math.round((taxableCents * rate) / (10_000 + rate));
    return { taxableCents, taxCents, totalCents: Math.max(0, taxableCents - giftCardCents) };
  }

  const taxCents = Math.round((taxableCents * rate) / 10_000);
  return { taxableCents, taxCents, totalCents: Math.max(0, taxableCents + taxCents - giftCardCents) };
}
