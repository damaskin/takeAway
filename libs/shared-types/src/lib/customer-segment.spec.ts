import {
  DEFAULT_INACTIVE_DAYS,
  INACTIVE_DAY_PRESETS,
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
  isInactiveDays,
  parseInactiveDays,
} from './customer-segment';

describe('inactive threshold', () => {
  it('offers 7, 14, 30 and 90 days, 14 by default, all inside the bounds', () => {
    expect([...INACTIVE_DAY_PRESETS]).toEqual([7, 14, 30, 90]);
    expect(DEFAULT_INACTIVE_DAYS).toBe(14);
    expect(INACTIVE_DAY_PRESETS.every(isInactiveDays)).toBe(true);
    expect([MIN_INACTIVE_DAYS, MAX_INACTIVE_DAYS]).toEqual([1, 365]);
  });

  it('takes any whole number of days from 1 to 365, the old 3 too', () => {
    expect(isInactiveDays(3)).toBe(true);
    expect(isInactiveDays(45)).toBe(true);
    expect(isInactiveDays(0)).toBe(false);
    expect(isInactiveDays(366)).toBe(false);
    expect(isInactiveDays(7.5)).toBe(false);
    expect(isInactiveDays('7')).toBe(false);
  });

  it('reads a link or a saved row, and nothing else', () => {
    expect(parseInactiveDays('30')).toBe(30);
    expect(parseInactiveDays(3)).toBe(3);
    expect(parseInactiveDays('45')).toBe(45);
    expect(parseInactiveDays(null)).toBeNull();
    expect(parseInactiveDays(undefined)).toBeNull();
    expect(parseInactiveDays('')).toBeNull();
    expect(parseInactiveDays(' ')).toBeNull();
    expect(parseInactiveDays('abc')).toBeNull();
    expect(parseInactiveDays('0')).toBeNull();
    expect(parseInactiveDays('400')).toBeNull();
    expect(parseInactiveDays('2.5')).toBeNull();
  });
});
