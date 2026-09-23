import { FormControl } from '@angular/forms';

import {
  formatMinutesInput,
  formatMoneyInput,
  moneyValidator,
  parseAllergens,
  parseAmount,
  parseCount,
  parseMinutes,
  parseMoney,
  slugValidator,
} from './menu-input';

describe('menu input', () => {
  describe('parseMoney', () => {
    it('reads prices the way people type them', () => {
      expect(parseMoney('35')).toBe(3500);
      expect(parseMoney('35.5')).toBe(3550);
      expect(parseMoney('35,50')).toBe(3550);
      expect(parseMoney(' 35,05 ')).toBe(3505);
      expect(parseMoney('0')).toBe(0);
    });

    it('drops thousands separators, including the no-break space a formatter inserts', () => {
      expect(parseMoney('1 250')).toBe(125_000);
      expect(parseMoney(`1${String.fromCharCode(0xa0)}250,50`)).toBe(125_050);
    });

    it('rounds to whole cents without float drift', () => {
      // 0.29 * 100 is 28.999999999999996 in floating point.
      expect(parseMoney('0,29')).toBe(29);
      expect(parseMoney('19.99')).toBe(1999);
    });

    it('refuses what is not a price', () => {
      for (const bad of ['', 'abc', '35,555', '3.5.1', '35 руб', '-5', '1e3']) {
        expect(parseMoney(bad)).toBeNull();
      }
    });

    it('takes a negative surcharge only where one is allowed', () => {
      expect(parseMoney('-5', true)).toBe(-500);
      expect(parseMoney(`${String.fromCharCode(0x2212)}2,50`, true)).toBe(-250);
      expect(parseMoney('+3', true)).toBe(300);
    });

    it('refuses a price past the API ceiling', () => {
      expect(parseMoney('10000000')).toBe(1_000_000_000);
      expect(parseMoney('10000000,01')).toBeNull();
    });
  });

  it('shows cents back in the same shape', () => {
    expect(formatMoneyInput(3500)).toBe('35');
    expect(formatMoneyInput(3550)).toBe('35,50');
    expect(formatMoneyInput(3505, '.')).toBe('35.05');
    expect(formatMoneyInput(-250)).toBe('-2,50');
    expect(parseMoney(formatMoneyInput(123_456), true)).toBe(123_456);
  });

  it('turns minutes into seconds and back', () => {
    expect(parseMinutes('3')).toBe(180);
    expect(parseMinutes('2,5')).toBe(150);
    expect(parseMinutes('0')).toBe(0);
    expect(parseMinutes('-1')).toBeNull();
    expect(parseMinutes('1441')).toBeNull();
    expect(formatMinutesInput(180)).toBe('3');
    expect(formatMinutesInput(90)).toBe('1,5');
    expect(formatMinutesInput(90, '.')).toBe('1.5');
  });

  it('reads grams and counts', () => {
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('-1')).toBeNull();
    expect(parseCount('3')).toBe(3);
    expect(parseCount('3,5')).toBeNull();
    expect(parseCount('0', 1)).toBeNull();
    expect(parseCount('100', 0, 99)).toBeNull();
  });

  it('splits allergens on commas, trims them and drops repeats', () => {
    expect(parseAllergens('молоко, Орехи;глютен,, орехи ')).toEqual(['молоко', 'Орехи', 'глютен']);
    expect(parseAllergens('   ')).toEqual([]);
  });

  it('lets an empty price field through for `required` to report', () => {
    const control = new FormControl('', { nonNullable: true, validators: [moneyValidator()] });
    expect(control.valid).toBe(true);
    control.setValue('35,5');
    expect(control.valid).toBe(true);
    control.setValue('35 lei');
    expect(control.errors).toEqual({ money: true });
  });

  it('accepts an empty slug (the server builds one) and the API pattern only', () => {
    const control = new FormControl('', { nonNullable: true, validators: [slugValidator] });
    expect(control.valid).toBe(true);
    control.setValue('flat-white-2');
    expect(control.valid).toBe(true);
    for (const bad of ['Flat', 'флэт', 'a', 'flat white']) {
      control.setValue(bad);
      expect(control.errors).toEqual({ slug: true });
    }
  });
});
