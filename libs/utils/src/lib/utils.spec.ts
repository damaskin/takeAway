import { formatPrice, secondsToMinutes } from './utils';

describe('utils', () => {
  describe('formatPrice', () => {
    it('formats cents to USD', () => {
      expect(formatPrice(950, 'USD', 'en')).toBe('$9.50');
    });
  });

  describe('secondsToMinutes', () => {
    it('rounds up to the nearest minute', () => {
      expect(secondsToMinutes(65)).toBe(2);
      expect(secondsToMinutes(60)).toBe(1);
      expect(secondsToMinutes(0)).toBe(0);
    });
  });
});
