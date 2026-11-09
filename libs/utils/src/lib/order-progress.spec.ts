import {
  endedOrderMoney,
  expiredOutcome,
  formatCountdown,
  isAwaitingAcceptance,
  orderCancellation,
  orderDueAt,
  orderWaitNote,
} from './order-progress';

describe('isAwaitingAcceptance', () => {
  const order = { pickupAt: '2026-10-15T06:15:00Z', totalCents: 4500 };

  it('waits for the store once the card hold is in, or with nothing to pay', () => {
    expect(isAwaitingAcceptance({ ...order, status: 'CREATED', payment: { state: 'HELD' } })).toBe(true);
    expect(isAwaitingAcceptance({ ...order, status: 'PAID', payment: { state: 'PAID' } })).toBe(true);
    expect(isAwaitingAcceptance({ ...order, status: 'CREATED', totalCents: 0, payment: { state: 'NONE' } })).toBe(true);
  });

  it('is not on the board before its card goes through, nor once accepted', () => {
    expect(isAwaitingAcceptance({ ...order, status: 'CREATED', payment: { state: 'NONE' } })).toBe(false);
    expect(isAwaitingAcceptance({ ...order, status: 'CREATED', payment: { state: 'PENDING' } })).toBe(false);
    expect(isAwaitingAcceptance({ ...order, status: 'CREATED' })).toBe(false);
    expect(isAwaitingAcceptance({ ...order, status: 'ACCEPTED', payment: { state: 'PAID' } })).toBe(false);
  });
});

describe('orderWaitNote', () => {
  const now = new Date('2026-10-15T06:20:00Z');
  const held = { state: 'HELD' };

  it('owns up to running late once an accepted order is past its time', () => {
    expect(orderWaitNote({ status: 'ACCEPTED', pickupAt: '2026-10-15T06:15:00Z' }, null, now)).toBe('late');
    expect(orderWaitNote({ status: 'IN_PROGRESS', pickupAt: '2026-10-15T06:15:00Z' }, null, now)).toBe('late');
    expect(orderWaitNote({ status: 'IN_PROGRESS', pickupAt: '2026-10-15T06:30:00Z' }, null, now)).toBeNull();
    expect(orderWaitNote({ status: 'READY', pickupAt: '2026-10-15T06:15:00Z' }, null, now)).toBeNull();
  });

  it('counts down to the new estimate once the kitchen accepted the order late', () => {
    const order = {
      status: 'IN_PROGRESS',
      pickupAt: '2026-10-15T06:15:00Z',
      readyEstimateAt: '2026-10-15T06:23:00Z',
    };
    expect(orderDueAt(order)).toBe('2026-10-15T06:23:00Z');
    expect(orderWaitNote(order, null, now)).toBeNull();
    expect(orderWaitNote(order, null, new Date('2026-10-15T06:24:00Z'))).toBe('late');
    expect(orderDueAt({ pickupAt: '2026-10-15T06:15:00Z', readyEstimateAt: null })).toBe('2026-10-15T06:15:00Z');
  });

  it('says a pre-order is confirmed when the store opens, while it is closed', () => {
    const order = { status: 'CREATED', pickupMode: 'SCHEDULED', pickupAt: '2026-10-15T06:15:00Z', payment: held };
    const night = new Date('2026-10-14T22:00:00Z');
    expect(orderWaitNote(order, { openNow: false, asapBlockedReason: 'OUTSIDE_HOURS' }, night)).toBe(
      'preorderAwaitingOpening',
    );
    expect(orderWaitNote(order, { openNow: false, asapBlockedReason: 'SHIFT_CLOSED' }, night)).toBe(
      'preorderAwaitingOpening',
    );
  });

  it('waits for the store otherwise: open, busy, an ASAP order, or the store unknown', () => {
    const order = { status: 'CREATED', pickupMode: 'SCHEDULED', pickupAt: '2026-10-15T06:15:00Z', payment: held };
    expect(orderWaitNote(order, { openNow: true }, now)).toBe('awaitingAcceptance');
    expect(orderWaitNote(order, { openNow: false, asapBlockedReason: 'QUEUE_FULL' }, now)).toBe('awaitingAcceptance');
    expect(orderWaitNote(order, null, now)).toBe('awaitingAcceptance');
    expect(orderWaitNote({ ...order, pickupMode: 'ASAP' }, { openNow: false }, now)).toBe('awaitingAcceptance');
  });

  it('adds nothing to an order still waiting for its payment, or over', () => {
    expect(
      orderWaitNote({ status: 'CREATED', pickupAt: '2026-10-15T06:15:00Z', totalCents: 100 }, null, now),
    ).toBeNull();
    expect(orderWaitNote({ status: 'EXPIRED', pickupAt: '2026-10-15T06:15:00Z' }, null, now)).toBeNull();
  });
});

describe('expiredOutcome', () => {
  it('tells a store that never accepted from a payment that never went through', () => {
    expect(expiredOutcome({ payment: { state: 'NONE' } })).toBe('notAccepted');
    expect(expiredOutcome({ payment: { state: 'HELD' } })).toBe('notAccepted');
    expect(expiredOutcome({})).toBe('notAccepted');
    expect(expiredOutcome({ payment: { state: 'REFUNDED' } })).toBe('notAcceptedRefunded');
    expect(expiredOutcome({ payment: { state: 'FAILED' } })).toBe('paymentNotCompleted');
    expect(expiredOutcome({ payment: { state: 'PENDING' } })).toBe('paymentNotCompleted');
  });

  // A released hold is a REFUNDED payment too: only the money the API recorded tells it from a refund.
  it('goes by the money the API recorded when it let the order go', () => {
    const refundedPayment = { payment: { state: 'REFUNDED' } };
    expect(expiredOutcome({ ...refundedPayment, cancelMoney: 'RELEASED' })).toBe('notAccepted');
    expect(expiredOutcome({ ...refundedPayment, cancelMoney: 'REFUNDED' })).toBe('notAcceptedRefunded');
    expect(expiredOutcome({ payment: { state: 'NONE' }, cancelMoney: 'NOT_CHARGED' })).toBe('notAccepted');
    expect(expiredOutcome({ payment: { state: 'HELD' }, cancelMoney: 'PENDING' })).toBe('notAccepted');
    // A value this build does not know: the payment decides, as before.
    expect(expiredOutcome({ ...refundedPayment, cancelMoney: 'SOMETHING_NEW' })).toBe('notAcceptedRefunded');
  });
});

describe('formatCountdown', () => {
  it('counts minutes and seconds, and hours once an hour or more away', () => {
    expect(formatCountdown(245_000)).toBe('4:05');
    expect(formatCountdown(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatCountdown(60 * 60_000)).toBe('1:00:00');
    expect(formatCountdown(13 * 3_600_000 + 5 * 60_000)).toBe('13:05:00');
  });

  it('never goes below zero', () => {
    expect(formatCountdown(-30_000)).toBe('0:00');
  });
});

describe('orderCancellation', () => {
  const cancelled = { status: 'CANCELLED', totalCents: 4500 };

  it('says nothing about an order that is not cancelled', () => {
    expect(orderCancellation({ ...cancelled, status: 'EXPIRED' })).toBeNull();
    expect(orderCancellation({ ...cancelled, status: 'READY', cancelledBy: 'STORE' })).toBeNull();
  });

  it("gives the kitchen's reason and its comment, trimmed", () => {
    expect(
      orderCancellation({
        ...cancelled,
        cancelledBy: 'STORE',
        cancelReason: 'OUT_OF_STOCK',
        cancelComment: '  Нет овсяного молока ',
        payment: { state: 'NONE' },
      }),
    ).toEqual({ by: 'store', reason: 'OUT_OF_STOCK', comment: 'Нет овсяного молока', money: 'notCharged' });
    expect(
      orderCancellation({ ...cancelled, cancelledBy: 'STORE', cancelReason: 'TOO_BUSY', cancelComment: '   ' }),
    ).toMatchObject({ by: 'store', reason: 'TOO_BUSY', comment: null });
  });

  it('tells a declined card from the kitchen turning the order down', () => {
    expect(
      orderCancellation({ ...cancelled, cancelledBy: 'STORE', cancelReason: 'CARD_DECLINED', cancelComment: 'x' }),
    ).toEqual({ by: 'cardDeclined', reason: null, comment: null, money: 'notCharged' });
  });

  it("keeps the customer's own cancel free of a reason", () => {
    expect(
      orderCancellation({ ...cancelled, cancelledBy: 'CUSTOMER', cancelReason: 'OTHER', cancelComment: 'x' }),
    ).toMatchObject({ by: 'customer', reason: null, comment: null });
  });

  it('leaves who and why open on an order cancelled before they were kept', () => {
    expect(orderCancellation({ ...cancelled, payment: { state: 'REFUNDED' } })).toEqual({
      by: null,
      reason: null,
      comment: null,
      money: 'refunded',
    });
  });

  it('says where the money is, as the push did', () => {
    const money = (state: string, cancelledBy = 'STORE', totalCents = 4500) =>
      orderCancellation({ ...cancelled, totalCents, cancelledBy, payment: { state } })?.money;
    expect(money('NONE')).toBe('notCharged');
    expect(money('FAILED')).toBe('notCharged');
    expect(money('HELD')).toBe('holdPending');
    expect(money('REFUNDED')).toBe('refunded');
    expect(money('PAID')).toBe('refunded');
    // The customer cancels only while nothing is captured: a give-back is the hold coming off.
    expect(money('REFUNDED', 'CUSTOMER')).toBe('released');
    expect(money('PENDING')).toBeNull();
    // Points or a gift card paid for it all: no card money to speak of.
    expect(money('NONE', 'STORE', 0)).toBeNull();
  });

  /**
   * The store turned down an order whose card hold came off: the push said
   * «Деньги не списаны, блокировка на карте снята», the screen used to say
   * «Деньги вернутся на карту» — the payment reads REFUNDED either way.
   */
  it('says what the push said once the API recorded where the money went', () => {
    const money = (cancelMoney: string, state = 'REFUNDED') =>
      orderCancellation({ ...cancelled, cancelledBy: 'STORE', cancelMoney, payment: { state } })?.money;
    expect(money('RELEASED')).toBe('released');
    expect(money('REFUNDED')).toBe('refunded');
    expect(money('NOT_CHARGED', 'NONE')).toBe('notCharged');
    expect(money('PENDING', 'HELD')).toBe('holdPending');
    // Even when the payment has moved on since: the order keeps the push's word.
    expect(money('PENDING', 'REFUNDED')).toBe('holdPending');
  });
});

describe('endedOrderMoney', () => {
  it('speaks of the money of cancelled and expired orders only', () => {
    expect(endedOrderMoney({ status: 'EXPIRED', cancelMoney: 'RELEASED', payment: { state: 'REFUNDED' } })).toBe(
      'released',
    );
    expect(endedOrderMoney({ status: 'EXPIRED', totalCents: 4500, payment: { state: 'HELD' } })).toBe('holdPending');
    expect(endedOrderMoney({ status: 'CREATED', cancelMoney: 'RELEASED', payment: { state: 'HELD' } })).toBeNull();
    expect(endedOrderMoney({ status: 'PICKED_UP', payment: { state: 'PAID' } })).toBeNull();
  });
});
