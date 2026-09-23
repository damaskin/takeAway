import { isRussian } from './money';

/**
 * Metres to a short label, as the Flutter app writes it: «850 м», «1,2 км»,
 * "15 km" — one decimal under ten kilometres, none above.
 */
export function formatDistance(metres: number, lang = 'ru'): string {
  const russian = isRussian(lang);
  if (metres < 1000) return `${Math.round(metres)}\u00a0${russian ? 'м' : 'm'}`;
  const km = new Intl.NumberFormat(russian ? 'ru' : 'en', { maximumFractionDigits: metres < 10_000 ? 1 : 0 });
  return `${km.format(metres / 1000)}\u00a0${russian ? 'км' : 'km'}`;
}

export interface FormatPercentOptions {
  /** Show "+" on growth — for a change against a previous period. */
  signed?: boolean;
  /** Fraction digits to keep at most; one by default. */
  maxDigits?: number;
}

/**
 * A percentage given in percent units (12.5 → «12,5 %» / "12.5%"), with the
 * language's own separator and spacing and, like money, a real minus sign.
 */
export function formatPercent(percent: number, lang = 'ru', options: FormatPercentOptions = {}): string {
  const format = new Intl.NumberFormat(isRussian(lang) ? 'ru' : 'en', {
    style: 'percent',
    maximumFractionDigits: options.maxDigits ?? 1,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  });
  return format.format(percent / 100).replace('-', '\u2212');
}
