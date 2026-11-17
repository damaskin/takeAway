import { brandDiscountCents, takeawayFundedCents } from './orders.service';

/** Maxim's list 6.0, item 4: the business sees the full amount of an order takeAway compensates. */
describe('takeawayFundedCents', () => {
  it('adds a takeAway promo discount and the points spent', () => {
    expect(takeawayFundedCents({ status: 'PICKED_UP', takeawayDiscountCents: 1_000, pointsDiscountCents: 0 })).toBe(
      1_000,
    );
    expect(takeawayFundedCents({ status: 'ACCEPTED', takeawayDiscountCents: 0, pointsDiscountCents: 250 })).toBe(250);
    expect(takeawayFundedCents({ status: 'READY', takeawayDiscountCents: 0, pointsDiscountCents: 0 })).toBe(0);
  });

  it('is nothing once the order was cancelled or expired — the promo and the points went back', () => {
    expect(takeawayFundedCents({ status: 'CANCELLED', takeawayDiscountCents: 1_000, pointsDiscountCents: 250 })).toBe(
      0,
    );
    expect(takeawayFundedCents({ status: 'EXPIRED', takeawayDiscountCents: 1_000, pointsDiscountCents: 0 })).toBe(0);
  });
});

describe('brandDiscountCents', () => {
  it("is what is left of the discount once takeAway's promo and the points are out", () => {
    // A brand code alone: all of it is the brand's.
    expect(brandDiscountCents({ discountCents: 300, takeawayDiscountCents: 0, pointsDiscountCents: 0 })).toBe(300);
    // A takeAway promo: nothing is the brand's.
    expect(brandDiscountCents({ discountCents: 200, takeawayDiscountCents: 200, pointsDiscountCents: 0 })).toBe(0);
    // Points only.
    expect(brandDiscountCents({ discountCents: 100, takeawayDiscountCents: 0, pointsDiscountCents: 100 })).toBe(0);
  });

  it('never goes below zero on inconsistent rows', () => {
    expect(brandDiscountCents({ discountCents: 50, takeawayDiscountCents: 100, pointsDiscountCents: 0 })).toBe(0);
  });
});
