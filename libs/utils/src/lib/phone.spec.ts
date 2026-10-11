import { formatPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+373 69 123 456', '+37369123456'],
    ['+373 (69) 12-34-56', '+37369123456'],
    ['0037369123456', '+37369123456'],
    ['+373 533 12345', '+37353312345'],
    ['+380 50 123 4567', '+380501234567'],
    ['+7 (916) 123-45-67', '+79161234567'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+1 212 555 0123', '+12125550123'],
  ])('reads %s in international format as %s', (typed, e164) => {
    expect(normalizePhone(typed)).toBe(e164);
  });

  it.each([
    ['069 123 456', '+37369123456'],
    ['0777 12345', '+37377712345'],
    ['050 123 4567', '+380501234567'],
    ['8 916 123-45-67', '+79161234567'],
    ['373 69 123 456', '+37369123456'],
    ['380501234567', '+380501234567'],
    ['79161234567', '+79161234567'],
  ])('reads the home-market habit %s as %s', (typed, e164) => {
    expect(normalizePhone(typed)).toBe(e164);
  });

  it.each([
    '+373 69 123 45',
    '+373 69 123 4567',
    '+380 50 123 456',
    '+7 916 123 45 6',
    '+0 69 123 456',
    '+373',
    '12345',
    '8 029 123 45 67',
    'call me',
  ])('refuses %s: a typo, a missing country code or not a number', (typed) => {
    expect(normalizePhone(typed)).toBeNull();
  });

  it('treats blank as no number', () => {
    expect(normalizePhone('   ')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('groups the home-market numbers and leaves the rest as they are', () => {
    expect(formatPhone('+37369123456')).toBe('+373 69 123 456');
    expect(formatPhone('+380501234567')).toBe('+380 50 123 4567');
    expect(formatPhone('+79161234567')).toBe('+7 916 123-45-67');
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });
});
