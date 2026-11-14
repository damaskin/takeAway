import { takeawayFundedCents } from './orders.service';

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
