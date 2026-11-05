import { FormControl } from '@angular/forms';

import { ACCEPT_MINUTES_VALIDATORS, acceptWindowMinutes } from './store-options';

describe('«Время для принятия заказа» in the store form (list 5.0, items 6 and 9)', () => {
  const control = (value: number | null) => new FormControl<number | null>(value, ACCEPT_MINUTES_VALIDATORS);

  it('takes whole minutes from 1 to 60', () => {
    expect(control(1).valid).toBe(true);
    expect(control(10).valid).toBe(true);
    expect(control(60).valid).toBe(true);
  });

  it('refuses nothing, zero, more than an hour and a part of a minute', () => {
    expect(control(null).errors).toHaveProperty('required');
    expect(control(0).errors).toHaveProperty('min');
    expect(control(61).errors).toHaveProperty('max');
    expect(control(2.5).errors).toHaveProperty('pattern');
  });

  it("shows a store's seconds as minutes, an older 0 as the default 10 the API counts it as", () => {
    expect(acceptWindowMinutes(600)).toBe(10);
    expect(acceptWindowMinutes(180)).toBe(3);
    expect(acceptWindowMinutes(3600)).toBe(60);
    expect(acceptWindowMinutes(0)).toBe(10);
    expect(acceptWindowMinutes(undefined)).toBe(10);
    expect(acceptWindowMinutes(7200)).toBe(60);
  });
});
