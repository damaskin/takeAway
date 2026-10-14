/**
 * International (E.164) phone numbers: a plus, a country code that never
 * starts with zero, and 8–15 digits in all.
 */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * Digits after the country code in the markets takeAway works in. A number
 * of one of these countries with any other length is a typo, not a number.
 */
const NATIONAL_DIGITS: ReadonlyArray<{ code: string; digits: number }> = [
  // Moldova and Transnistria share +373: 8 digits (69 123 456, 533 12 345).
  { code: '373', digits: 8 },
  // Ukraine: 9 digits (50 123 4567).
  { code: '380', digits: 9 },
  // Russia (and Kazakhstan): 10 digits (916 123-45-67).
  { code: '7', digits: 10 },
];

/**
 * A phone number the way people type it, reduced to E.164 — or null when it
 * is not a phone number. Separators are dropped and the `00` exit prefix
 * becomes `+`. Without a country code only the home-market habits are read,
 * each told apart by its length:
 *
 * - `0` + 8 digits — Moldova / Transnistria («069 123 456» → +37369123456);
 * - `0` + 9 digits — Ukraine («050 123 4567» → +380501234567);
 * - `8` + 10 digits — Russia / Kazakhstan («8 916 123-45-67» → +79161234567);
 * - the country code without the plus («373 69 123 456»).
 *
 * Anything else needs its country code; the form shows the number it will
 * save, so a wrong reading is visible before it is sent.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s().\-‐-―]/g, '');
  if (!compact) return null;

  let e164: string;
  if (compact.startsWith('+')) e164 = compact;
  else if (compact.startsWith('00')) e164 = `+${compact.slice(2)}`;
  else if (/^0\d{8}$/.test(compact)) e164 = `+373${compact.slice(1)}`;
  else if (/^0\d{9}$/.test(compact)) e164 = `+38${compact}`;
  else if (/^8[3-9]\d{9}$/.test(compact)) e164 = `+7${compact.slice(1)}`;
  else if (/^(373\d{8}|380\d{9}|7[3-9]\d{9})$/.test(compact)) e164 = `+${compact}`;
  else return null;

  if (!E164_PATTERN.test(e164)) return null;
  const market = NATIONAL_DIGITS.find(({ code }) => e164.startsWith(`+${code}`));
  if (market && e164.length !== 1 + market.code.length + market.digits) return null;
  return e164;
}

/**
 * An E.164 number grouped for reading: «+373 69 123 456», «+380 50 123 4567»,
 * «+7 916 123-45-67». Other countries keep the bare E.164 form.
 */
export function formatPhone(e164: string): string {
  const md = /^\+373(\d{2})(\d{3})(\d{3})$/.exec(e164);
  if (md) return `+373 ${md[1]} ${md[2]} ${md[3]}`;
  const ua = /^\+380(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (ua) return `+380 ${ua[1]} ${ua[2]} ${ua[3]}`;
  const ru = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  if (ru) return `+7 ${ru[1]} ${ru[2]}-${ru[3]}-${ru[4]}`;
  return e164;
}

/**
 * A `tel:` link for a phone number as a business typed it — «Позвонить в
 * точку». Normalised to E.164 when it reads as one, otherwise the digits
 * (and a leading plus) as they are; null when there is no number to dial.
 */
export function phoneHref(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  const dial = normalizePhone(raw) ?? raw.replace(/(?!^\+)[^\d]/g, '');
  return dial.replace(/\D/g, '').length >= 3 ? `tel:${dial}` : null;
}
