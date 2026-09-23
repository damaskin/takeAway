import { formatMoney, isRussian } from './money';

// Intl separates groups and the unit with no-break spaces; spelled out here
// so a failing assertion shows where the difference is.
const NBSP = '\u00a0';

describe('formatMoney', () => {
  it('drops the cents on whole amounts and keeps two digits otherwise', () => {
    expect(formatMoney(3800, 'MDL', 'ru')).toBe(`38${NBSP}MDL`);
    expect(formatMoney(450, 'MDL', 'ru')).toBe(`4,50${NBSP}MDL`);
    expect(formatMoney(2500, 'USD', 'en')).toBe('$25');
    expect(formatMoney(450, 'USD', 'en')).toBe('$4.50');
    expect(formatMoney(405, 'EUR', 'en')).toBe('€4.05');
  });

  it('uses the language separators for thousands and decimals', () => {
    expect(formatMoney(123456, 'MDL', 'ru')).toBe(`1${NBSP}234,56${NBSP}MDL`);
    expect(formatMoney(123456, 'MDL', 'en')).toBe(`1,234.56${NBSP}MDL`);
  });

  it('puts a sign before the number in English and after it in Russian', () => {
    expect(formatMoney(450, 'USD', 'ru')).toBe(`4,50${NBSP}$`);
    expect(formatMoney(1000, 'EUR', 'ru')).toBe(`10${NBSP}€`);
    expect(formatMoney(1000, 'GBP', 'en')).toBe('£10');
    expect(formatMoney(15000, 'THB', 'en')).toBe('฿150');
    expect(formatMoney(1500000, 'IDR', 'en')).toBe('Rp15,000');
    expect(formatMoney(1500000, 'IDR', 'ru')).toBe(`15${NBSP}000${NBSP}Rp`);
  });

  it('writes MDL and AED as a code after the number in both languages', () => {
    expect(formatMoney(2200, 'MDL', 'en')).toBe(`22${NBSP}MDL`);
    expect(formatMoney(1250, 'AED', 'en')).toBe(`12.50${NBSP}AED`);
    expect(formatMoney(1250, 'AED', 'ru')).toBe(`12,50${NBSP}AED`);
  });

  it('spells the Transnistrian rouble the local way in Russian', () => {
    expect(formatMoney(3300, 'RUP', 'ru')).toBe(`33${NBSP}руб.`);
    expect(formatMoney(3300, 'RUP', 'en')).toBe(`33${NBSP}RUP`);
  });

  it('marks negative amounts with a real minus sign', () => {
    expect(formatMoney(-500, 'GBP', 'en')).toBe('−£5');
    expect(formatMoney(-450, 'MDL', 'ru')).toBe(`−4,50${NBSP}MDL`);
    expect(formatMoney(-450, 'USD', 'ru')).toBe(`−4,50${NBSP}$`);
  });

  it('accepts lower-case codes and regional language tags', () => {
    expect(formatMoney(450, 'usd', 'en-US')).toBe('$4.50');
    expect(formatMoney(3300, 'rup', 'ru-RU')).toBe(`33${NBSP}руб.`);
  });

  it('shows a bare number when there is no currency', () => {
    expect(formatMoney(3850, null, 'ru')).toBe('38,50');
    expect(formatMoney(3800, undefined, 'en')).toBe('38');
  });

  it('defaults to Russian', () => {
    expect(formatMoney(450, 'MDL')).toBe(`4,50${NBSP}MDL`);
  });

  it('rounds to whole units on request', () => {
    expect(formatMoney(123456, 'MDL', 'ru', { round: true })).toBe(`1${NBSP}235${NBSP}MDL`);
    expect(formatMoney(-149, 'USD', 'en', { round: true })).toBe('−$1');
  });

  it('falls back to Russian number formatting for a malformed language tag', () => {
    expect(formatMoney(450, 'MDL', '!!')).toBe(`4,50${NBSP}MDL`);
  });
});

describe('isRussian', () => {
  it('matches any Russian tag', () => {
    expect(isRussian('ru')).toBe(true);
    expect(isRussian('RU-ru')).toBe(true);
    expect(isRussian('en')).toBe(false);
    expect(isRussian(null)).toBe(false);
  });
});
