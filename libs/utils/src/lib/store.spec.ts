import { isStoreInactive } from './store';

describe('isStoreInactive', () => {
  it('is inactive while no shift is open', () => {
    expect(isStoreInactive({ status: 'OPEN', acceptingOrders: false })).toBe(true);
  });

  it('is inactive when switched off, whatever the shift', () => {
    expect(isStoreInactive({ status: 'CLOSED', acceptingOrders: true })).toBe(true);
  });

  it('is active with a shift running, busy or not', () => {
    expect(isStoreInactive({ status: 'OPEN', acceptingOrders: true })).toBe(false);
    expect(isStoreInactive({ status: 'OVERLOADED', acceptingOrders: true })).toBe(false);
  });

  it('treats an API without shifts as active', () => {
    expect(isStoreInactive({ status: 'OPEN' })).toBe(false);
  });
});
