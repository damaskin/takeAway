import { formatDistance, formatPercent } from './number';

const NBSP = '\u00a0';

describe('formatPercent', () => {
  it('writes the percent sign the way each language does', () => {
    expect(formatPercent(12.5, 'ru')).toBe(`12,5${NBSP}%`);
    expect(formatPercent(12.5, 'en')).toBe('12.5%');
    expect(formatPercent(95, 'ru')).toBe(`95${NBSP}%`);
  });

  it('signs a change on request, with a real minus', () => {
    expect(formatPercent(12.5, 'ru', { signed: true })).toBe(`+12,5${NBSP}%`);
    expect(formatPercent(-8, 'en', { signed: true })).toBe('\u22128%');
    expect(formatPercent(0, 'en', { signed: true })).toBe('0%');
  });

  it('rounds to the requested digits', () => {
    expect(formatPercent(33.333, 'en')).toBe('33.3%');
    expect(formatPercent(33.333, 'en', { maxDigits: 0 })).toBe('33%');
  });
});

describe('formatDistance', () => {
  it('writes metres and kilometres for both languages', () => {
    expect(formatDistance(850, 'en')).toBe(`850${NBSP}m`);
    expect(formatDistance(850.4, 'ru')).toBe(`850${NBSP}м`);
    expect(formatDistance(1234, 'en')).toBe(`1.2${NBSP}km`);
    expect(formatDistance(1234, 'ru')).toBe(`1,2${NBSP}км`);
    expect(formatDistance(15200, 'en')).toBe(`15${NBSP}km`);
  });
});
