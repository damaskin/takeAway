import { Currency } from '@prisma/client';

import { toCountedRedemption } from './takeaway-debt';

type Row = Parameters<typeof toCountedRedemption>[0];

function redemption(payments: Row['order']['payments']): Row {
  return {
    id: 'r1',
    orderId: 'o1',
    promoId: 'p1',
    userId: 'u1',
    brandId: 'b1',
    storeId: 's1',
    currency: Currency.RUP,
    code: 'SALE10',
    percent: 10,
    menuTotalCents: 10000,
    discountCents: 1000,
    payoutId: null,
    promo: { name: 'Скидка 10%' },
    payout: null,
    order: {
      orderCode: '1001',
      status: 'PICKED_UP',
      acceptedAt: new Date('2026-11-17T10:00:00Z'),
      currency: Currency.RUP,
      store: { name: 'Центр', brand: { name: 'Бренд' } },
      payments,
    },
  };
}

const paid = (amountCents: number, refundedCents = 0, currency: Currency = Currency.RUP) => ({
  createdAt: new Date('2026-11-17T09:59:00Z'),
  currency,
  amountCents,
  refundedCents,
});

/** The debt reports count a refund the way settlements do (owner, 2026-11-17). */
describe('toCountedRedemption — compensation after a refund', () => {
  it('is the promo discount while nothing went back', () => {
    expect(toCountedRedemption(redemption([paid(9000)]))?.discountCents).toBe(1000);
  });

  it('loses the refunded share', () => {
    expect(toCountedRedemption(redemption([paid(9000, 4500)]))?.discountCents).toBe(500);
  });

  it('is nothing after a full refund', () => {
    expect(toCountedRedemption(redemption([paid(9000, 9000)]))?.discountCents).toBe(0);
  });

  it('ignores payments in another currency', () => {
    const other = paid(9000, 9000, Currency.USD);
    expect(toCountedRedemption(redemption([paid(9000), other]))?.discountCents).toBe(1000);
  });
});
