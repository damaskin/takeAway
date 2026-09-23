import { formatPercent } from './number';

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
