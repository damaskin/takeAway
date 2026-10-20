import { cancelNeedsCall, customerCanCancel, freshEstimateMinutes, pickupClock } from './order-timing';

describe('pickupClock', () => {
  const now = new Date('2026-10-20T20:00:00Z');

  it('counts down to an order due within the hour', () => {
    expect(pickupClock({ pickupAt: '2026-10-20T20:12:30Z' }, now, 'UTC')).toEqual({
      kind: 'countdown',
      remainingMs: 750_000,
    });
  });

  // A pre-order for tomorrow morning: «к 09:15 завтра», not «13:15:00».
  it('names the time of a pre-order hours away', () => {
    expect(pickupClock({ pickupAt: '2026-10-21T09:15:00Z' }, now, 'UTC')).toEqual({
      kind: 'at',
      at: '2026-10-21T09:15:00Z',
      days: 1,
    });
  });

  it('runs to the kitchen’s new estimate once it accepted late', () => {
    const order = { pickupAt: '2026-10-20T19:55:00Z', readyEstimateAt: '2026-10-20T20:06:00Z' };
    expect(pickupClock(order, now, 'UTC')).toEqual({ kind: 'countdown', remainingMs: 360_000 });
  });

  it('never counts below zero', () => {
    expect(pickupClock({ pickupAt: '2026-10-20T19:50:00Z' }, now, 'UTC')).toEqual({
      kind: 'countdown',
      remainingMs: 0,
    });
  });
});

describe('freshEstimateMinutes', () => {
  const now = new Date('2026-10-20T12:00:00Z');

  it('gives the minutes to the new estimate while the order is being made', () => {
    const order = { status: 'IN_PROGRESS', readyEstimateAt: '2026-10-20T12:05:20Z' };
    expect(freshEstimateMinutes(order, now)).toBe(6);
    expect(freshEstimateMinutes({ ...order, status: 'ACCEPTED' }, now)).toBe(6);
  });

  it('has nothing to say without an estimate, once it passed, or before the accept', () => {
    expect(freshEstimateMinutes({ status: 'IN_PROGRESS', readyEstimateAt: null }, now)).toBeNull();
    expect(freshEstimateMinutes({ status: 'IN_PROGRESS', readyEstimateAt: '2026-10-20T11:59:00Z' }, now)).toBeNull();
    expect(freshEstimateMinutes({ status: 'PAID', readyEstimateAt: '2026-10-20T12:05:00Z' }, now)).toBeNull();
  });
});

describe('cancel rule', () => {
  it('follows the API', () => {
    expect(customerCanCancel({ status: 'CREATED', canCancel: true })).toBe(true);
    // Money already taken: the customer calls the store even before the accept.
    expect(customerCanCancel({ status: 'PAID', canCancel: false })).toBe(false);
    expect(cancelNeedsCall({ status: 'PAID', canCancel: false })).toBe(true);
  });

  it('falls back to the status on an older API', () => {
    expect(customerCanCancel({ status: 'CREATED' })).toBe(true);
    expect(customerCanCancel({ status: 'PAID' })).toBe(true);
    expect(customerCanCancel({ status: 'ACCEPTED' })).toBe(false);
  });

  it('sends the customer to the store once accepted, until the order is ready', () => {
    expect(cancelNeedsCall({ status: 'ACCEPTED', canCancel: false })).toBe(true);
    expect(cancelNeedsCall({ status: 'IN_PROGRESS' })).toBe(true);
    expect(cancelNeedsCall({ status: 'READY', canCancel: false })).toBe(false);
    expect(cancelNeedsCall({ status: 'CANCELLED', canCancel: false })).toBe(false);
    expect(cancelNeedsCall({ status: 'CREATED', canCancel: true })).toBe(false);
  });
});
