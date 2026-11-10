import { TestBed } from '@angular/core/testing';

import { PaymentMethodChoice } from './payment-method-choice.service';

describe('web PaymentMethodChoice', () => {
  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('remembers the last way the customer paid on this device', () => {
    expect(TestBed.inject(PaymentMethodChoice).remembered()).toBeNull();
    TestBed.inject(PaymentMethodChoice).remember('QR');
    expect(localStorage.getItem('takeaway.web.paymentMethod')).toBe('QR');

    TestBed.resetTestingModule();
    expect(TestBed.inject(PaymentMethodChoice).remembered()).toBe('QR');
  });

  it('ignores a value it does not know', () => {
    localStorage.setItem('takeaway.web.paymentMethod', 'CASH');
    expect(TestBed.inject(PaymentMethodChoice).remembered()).toBeNull();
  });

  // Private mode, storage switched off: the choice lasts for this visit.
  it('still works when storage refuses', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const choice = TestBed.inject(PaymentMethodChoice);
    expect(choice.remembered()).toBeNull();
    choice.remember('QR');
    expect(choice.remembered()).toBe('QR');
  });
});
