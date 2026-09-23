import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Text fields of the menu editor. People type prices the way they write
 * them — "35", "35.5", "35,50" — and times in minutes; the API keeps
 * integer cents and seconds. These helpers are the only place the two
 * meet, so a field can never send 3550 when "35,50" was meant, or the
 * other way round.
 */

/** 1 000 000 in currency units — the API's ceiling, and well past any menu price. */
const MAX_CENTS = 100_000_000;
const MAX_MINUTES = 24 * 60;
const DECIMAL = /^([+-])?(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Drops spaces — `\s` includes the no-break spaces a number formatter puts
 * between thousands — and turns typographic minus and dash signs into "-".
 */
function normalize(raw: string): string {
  return raw.replace(/\s/g, '').replace(/[\u2212\u2012\u2013\u2014]/g, '-');
}

function parseDecimal(raw: string, allowNegative: boolean): number | null {
  const match = DECIMAL.exec(normalize(raw));
  if (!match) return null;
  const [, sign, whole, fraction] = match;
  if (sign === '-' && !allowNegative) return null;
  const value = Number(`${whole}.${fraction ?? '0'}`);
  return sign === '-' ? -value : value;
}

/** Cents from "35", "35.5" or "35,50"; `null` when it is not a price. */
export function parseMoney(raw: string, allowNegative = false): number | null {
  const units = parseDecimal(raw, allowNegative);
  if (units === null) return null;
  const cents = Math.round(units * 100);
  return Math.abs(cents) > MAX_CENTS ? null : cents;
}

/** Cents as the editor shows them back: "35", "35,50", "-2,50". */
export function formatMoneyInput(cents: number, separator = ','): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const fraction = abs % 100;
  const whole = (abs - fraction) / 100;
  return fraction === 0 ? `${sign}${whole}` : `${sign}${whole}${separator}${String(fraction).padStart(2, '0')}`;
}

/** Seconds from minutes typed as "3" or "2,5"; `null` when it is not a duration. */
export function parseMinutes(raw: string): number | null {
  const minutes = parseDecimal(raw, false);
  if (minutes === null || minutes > MAX_MINUTES) return null;
  return Math.round(minutes * 60);
}

export function formatMinutesInput(seconds: number, separator = ','): string {
  const minutes = Math.round((seconds / 60) * 100) / 100;
  return String(minutes).replace('.', separator);
}

/** A non-negative number with up to two decimals (grams); `null` otherwise. */
export function parseAmount(raw: string): number | null {
  return parseDecimal(raw, false);
}

export function formatAmountInput(value: number | null, separator = ','): string {
  return value === null ? '' : String(value).replace('.', separator);
}

/** A whole number within the bounds; `null` otherwise. */
export function parseCount(raw: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  const text = normalize(raw);
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value < min || value > max ? null : value;
}

export const MAX_ALLERGENS = 20;
export const MAX_ALLERGEN_LENGTH = 40;

/** "молоко, орехи; глютен" → ["молоко", "орехи", "глютен"], without repeats. */
export function parseAllergens(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const item = part.trim().replace(/\s+/g, ' ');
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function optionalText(check: (text: string) => boolean, error: string): ValidatorFn {
  return (control: AbstractControl<string | null>): ValidationErrors | null => {
    const text = (control.value ?? '').trim();
    if (!text) return null;
    return check(text) ? null : { [error]: true };
  };
}

/** Empty passes (pair with `Validators.required` where a price is mandatory). */
export function moneyValidator(allowNegative = false): ValidatorFn {
  return optionalText((text) => parseMoney(text, allowNegative) !== null, 'money');
}

export const minutesValidator: ValidatorFn = optionalText((text) => parseMinutes(text) !== null, 'minutes');

export const amountValidator: ValidatorFn = optionalText((text) => parseAmount(text) !== null, 'amount');

export function countValidator(min = 0, max = Number.MAX_SAFE_INTEGER): ValidatorFn {
  return optionalText((text) => parseCount(text, min, max) !== null, 'count');
}

export const allergensValidator: ValidatorFn = optionalText((text) => {
  const items = parseAllergens(text);
  return items.length <= MAX_ALLERGENS && items.every((item) => item.length <= MAX_ALLERGEN_LENGTH);
}, 'allergens');

/** The API's slug rule; empty means "build it from the name". */
export const slugValidator: ValidatorFn = optionalText((text) => /^[a-z0-9-]{2,60}$/.test(text), 'slug');
