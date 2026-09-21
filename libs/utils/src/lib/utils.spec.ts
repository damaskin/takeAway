import { buildDirectionsUrl, formatPrice, secondsToMinutes } from './utils';

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

  describe('buildDirectionsUrl', () => {
    it('builds a Google Maps directions URL with the destination', () => {
      expect(buildDirectionsUrl({ lat: 47.0105, lng: 28.8638 })).toBe(
        'https://www.google.com/maps/dir/?api=1&destination=47.0105,28.8638',
      );
    });

    it('handles negative coordinates', () => {
      expect(buildDirectionsUrl({ lat: -33.8688, lng: -70.6693 })).toBe(
        'https://www.google.com/maps/dir/?api=1&destination=-33.8688,-70.6693',
      );
    });
  });
});
