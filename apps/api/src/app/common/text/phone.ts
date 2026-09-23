/**
 * International (E.164) phone numbers: a plus, a country code that never
 * starts with zero, and 8–15 digits in all.
 */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * A phone number the way people type it — «+373 (69) 12-34-56»,
 * «0037369123456» — reduced to E.164. Only separators are dropped and the
 * `00` exit prefix becomes `+`; a number without its country code is left
 * as it is and fails {@link E164_PATTERN}, because «069…» is a local number
 * in more than one country and guessing which would put the wrong number
 * on the account.
 */
export function normalizePhone(input: string): string {
  const compact = input.trim().replace(/[\s().-]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}
