/**
 * Loyalty points for people to read and type.
 *
 * The API keeps every points figure — balances, lifetime points, ledger
 * amounts, the redeem quote, the minimum, `pointsToSpend` — as integer
 * **units**: a unit is a hundredth of a point, and a point is worth one major
 * unit of the store's currency («1 балл = 1 руб.»), so a unit is worth one
 * cent. Like money, figures travel as integers and turn into «12,40 балла»
 * only on screen; every client formats them with these helpers so that a
 * balance reads the same in the web, the Mini App, the admin and the app.
 */

import { isRussian } from './money';

/** Units in one point: a point is worth 100 cents, a unit one cent. */
export const POINT_UNITS_PER_POINT = 100;

const MINUS = '−';

/** Units as points: 1240 → 12.4. For arithmetic and plural rules, not for display. */
export function pointsFromUnits(units: number): number {
  return units / POINT_UNITS_PER_POINT;
}

/**
 * What the customer typed into a points field, in units: «12,4», «12.40» and
 * «12» all work, with the comma or the dot; a third decimal rounds half up to
 * a whole unit. Anything that is not a non-negative number — empty, letters,
 * a minus — is 0.
 */
export function pointUnitsFromInput(raw: string | number): number {
  let points: number;
  if (typeof raw === 'number') {
    points = raw;
  } else {
    // Spaces (also the no-break ones a formatted «2 450» carries) are grouping.
    const text = raw.replace(/[\s  ]/g, '').replace(',', '.');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return 0;
    points = Number(text);
  }
  if (!Number.isFinite(points) || points <= 0) return 0;
  // toFixed strips the float noise first: 1.005 × 100 is 100.49999…, not 100.5.
  return Math.round(Number((points * POINT_UNITS_PER_POINT).toFixed(6)));
}

/**
 * Units as a number to read: whole points without decimals («30», «2 450»),
 * anything else with two decimals and the language's separator («12,40»,
 * «0,40»; "12.40" in English). A negative amount starts with a real minus
 * sign («−0,40»), as money does.
 */
export function formatPoints(units: number, locale = 'ru'): string {
  const whole = Math.round(units);
  const abs = Math.abs(whole);
  const body = numberFormat(locale, abs % POINT_UNITS_PER_POINT === 0 ? 0 : 2).format(abs / POINT_UNITS_PER_POINT);
  return whole < 0 ? `${MINUS}${body}` : body;
}

/**
 * The word after a points figure: «1 балл», «2 балла», «5 баллов», «21 балл»
 * by the Russian plural rules for whole points, and «балла» for any fraction
 * («0,40 балла», «12,40 балла»). English: "1 point", "0.40 points". The sign
 * does not change the word.
 */
export function pointsWord(units: number, locale = 'ru'): string {
  const abs = Math.abs(Math.round(units));
  const fractional = abs % POINT_UNITS_PER_POINT !== 0;
  const points = abs / POINT_UNITS_PER_POINT;
  if (!isRussian(locale)) return !fractional && points === 1 ? 'point' : 'points';
  if (fractional) return 'балла';
  const mod10 = points % 10;
  const mod100 = points % 100;
  if (mod10 === 1 && mod100 !== 11) return 'балл';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'балла';
  return 'баллов';
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}|${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    const options = { minimumFractionDigits: digits, maximumFractionDigits: digits };
    try {
      format = new Intl.NumberFormat(locale || 'ru', options);
    } catch {
      // A malformed language tag throws; the figure still has to show.
      format = new Intl.NumberFormat('ru', options);
    }
    numberFormats.set(key, format);
  }
  return format;
}
