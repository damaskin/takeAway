import { KDS_PIN_MAX_LENGTH, KDS_PIN_MIN_LENGTH, KDS_PIN_PATTERN } from '@takeaway/shared-types';

/**
 * PIN rules for the admin, mirroring the API's KdsPinService:
 *  - the tablet takes 4–6 digits, so PINs set before 6 became the rule still work;
 *  - a new PIN is exactly 6 digits and not a first guess.
 */

/** Whether a PIN typed on the tablet may be sent: 4 to 6 digits. */
export function canSubmitPin(pin: string): boolean {
  return KDS_PIN_PATTERN.test(pin);
}

/** The PIN with one more digit, unless it already has the most a PIN can have. */
export function appendPinDigit(pin: string, digit: string): string {
  if (!/^[0-9]$/.test(digit) || pin.length >= KDS_PIN_MAX_LENGTH) return pin;
  return pin + digit;
}

/** Keypad slots: the first {@link KDS_PIN_MIN_LENGTH} are needed, the rest optional. */
export function pinSlots(pin: string): Array<{ filled: boolean; optional: boolean }> {
  return Array.from({ length: KDS_PIN_MAX_LENGTH }, (_, i) => ({
    filled: i < pin.length,
    optional: i >= KDS_PIN_MIN_LENGTH,
  }));
}

/** Why a PIN about to be set is refused — the API answers the same with KDS_PIN_FORMAT / KDS_PIN_TOO_SIMPLE. */
export function newPinProblem(pin: string): 'FORMAT' | 'TOO_SIMPLE' | null {
  if (!/^[0-9]{6}$/.test(pin)) return 'FORMAT';
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - (digits[i] as number));
  const guessable = steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
  return guessable ? 'TOO_SIMPLE' : null;
}
