/**
 * Prices for people to read. Amounts travel as integer minor units (cents)
 * with a currency code, exactly as the API sends them; the rules match the
 * Flutter app's `Money.format`, so a latte costs the same "38 MDL" on every
 * screen.
 *
 * - Whole amounts drop the cents ("38 MDL", not "38.00 MDL"); others keep
 *   two digits with the language's own separators ("4,50 MDL" in Russian).
 * - Currencies with a well-known sign put it before the number in English
 *   ("$4.50") and after it in Russian ("4,50 $").
 * - The rest are written as a code after the number. The Transnistrian
 *   rouble has no ISO code; in Russian it is «руб.», as it is written there.
 * - Negative amounts start with a real minus sign ("−5 MDL").
 */

import type { Currency } from '@takeaway/shared-types';

const PREFIX_SIGNS: Readonly<Record<string, string>> = { USD: '$', EUR: '€', GBP: '£', THB: '฿', IDR: 'Rp' };

const RUSSIAN_CODES: Readonly<Record<string, string>> = { RUP: 'руб.' };

// A no-break space keeps "38 MDL" on one line in a narrow card.
const NBSP = '\u00a0';
const MINUS = '\u2212';

export interface FormatMoneyOptions {
  /** Round to whole units — for KPI cards and chart labels, where cents are noise. */
  round?: boolean;
}

export function formatMoney(
  cents: number,
  currency: Currency | string | null | undefined,
  lang = 'ru',
  options: FormatMoneyOptions = {},
): string {
  const minor = options.round ? Math.round(cents / 100) * 100 : Math.round(cents);
  const abs = Math.abs(minor);
  const number = numberFormat(lang, abs % 100 === 0 ? 0 : 2).format(abs / 100);
  const russian = isRussian(lang);
  const code = (currency ?? '').toUpperCase();

  let body: string;
  if (!code) {
    // A total across brands with different currencies has no single unit.
    body = number;
  } else if (PREFIX_SIGNS[code]) {
    body = russian ? `${number}${NBSP}${PREFIX_SIGNS[code]}` : `${PREFIX_SIGNS[code]}${number}`;
  } else {
    body = `${number}${NBSP}${(russian && RUSSIAN_CODES[code]) || code}`;
  }
  return minor < 0 ? `${MINUS}${body}` : body;
}

/** Whether a language tag is Russian ("ru", "ru-RU", "RU"). */
export function isRussian(lang: string | null | undefined): boolean {
  return (lang ?? '').toLowerCase().startsWith('ru');
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(lang: string, digits: number): Intl.NumberFormat {
  const key = `${lang}|${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    const options = { minimumFractionDigits: digits, maximumFractionDigits: digits };
    try {
      format = new Intl.NumberFormat(lang || 'ru', options);
    } catch {
      // A malformed language tag throws; the amount still has to show.
      format = new Intl.NumberFormat('ru', options);
    }
    numberFormats.set(key, format);
  }
  return format;
}
