import { isRussian } from './money';

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
