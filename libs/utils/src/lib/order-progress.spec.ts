import { expiredOutcome, formatCountdown, isAwaitingAcceptance, orderDueAt, orderWaitNote } from './order-progress';

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
