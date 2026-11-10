import { BOARD_INCLUDE, type BoardOrder, toBoardRow } from './kds-row';

function boardOrder(takeawayPromoRedemption: BoardOrder['takeawayPromoRedemption']): BoardOrder {
  return {
    id: 'order-1',
    orderCode: '4832',
    status: 'PAID',
    pickupMode: 'ASAP',
    pickupAt: new Date('2026-11-10T08:15:00Z'),
    createdAt: new Date('2026-11-10T08:01:00Z'),
    kitchenVisibleAt: new Date('2026-11-10T08:02:00Z'),
    prepSeconds: 180,
    workSeconds: 180,
    customerName: 'Ира',
    notes: null,
    events: [],
    items: [],
    store: { kitchenParallelism: 2, baseEtaSeconds: 300 },
    takeawayPromoRedemption,
  } as unknown as BoardOrder;
}

describe('the kitchen board row — takeAway promos (docs/takeaway-promos.md §4.4)', () => {
  it('reads the promo with the row', () => {
    expect(BOARD_INCLUDE.takeawayPromoRedemption).toBeDefined();
  });

  it('says the guest paid in full and what takeAway compensates', () => {
    const row = toBoardRow(
      boardOrder({
        code: 'AUTUMN10',
        percent: 10,
        menuTotalCents: 10_000,
        discountCents: 1_000,
        promo: { name: 'Осенняя акция' },
      }),
    );

    expect(row.takeawayPromo).toEqual({
      code: 'AUTUMN10',
      name: 'Осенняя акция',
      percent: 10,
      menuTotalCents: 10_000,
      discountCents: 1_000,
      paidByGuestCents: 9_000,
    });
  });

  it('carries null without one', () => {
    expect(toBoardRow(boardOrder(null)).takeawayPromo).toBeNull();
  });
});
