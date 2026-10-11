import { STAFF_PASSWORD_MAX_LENGTH, STAFF_PASSWORD_MIN_LENGTH } from '@takeaway/shared-types';

/** Letters and digits that cannot be mixed up when read aloud or copied by hand: no 0/O, 1/l/I. */
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL = LOWER + UPPER + DIGITS;

/** A source of random 32-bit integers — Web Crypto's `getRandomValues`, in the browser and in Node alike. */
export type RandomWords = (count: number) => Uint32Array;

const cryptoWords: RandomWords = (count) => crypto.getRandomValues(new Uint32Array(count));

/** The rule the API applies to a temporary password: 8 to 128 characters. */
export function tempPasswordValid(password: string): boolean {
  return password.length >= STAFF_PASSWORD_MIN_LENGTH && password.length <= STAFF_PASSWORD_MAX_LENGTH;
}

/**
 * A strong temporary password — for the admin's invite form, and for the
 * API when an owner resets an employee's password: 12 characters from a
 * 56-symbol alphabet (about 70 bits), with at least one lower-case letter,
 * one capital and one digit, and nothing easy to misread when the owner
 * dictates it. Unbiased: values that would favour some symbols are redrawn.
 */
export function generateTempPassword(length = 12, random: RandomWords = cryptoWords): string {
  const size = Math.max(length, STAFF_PASSWORD_MIN_LENGTH);
  const pick = (alphabet: string): string => {
    const limit = Math.floor(0x1_0000_0000 / alphabet.length) * alphabet.length;
    for (;;) {
      const [value] = random(1);
      if (value !== undefined && value < limit) return alphabet[value % alphabet.length] as string;
    }
  };
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS)];
  while (chars.length < size) chars.push(pick(ALL));
  // Shuffle so the guaranteed classes do not always sit in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Number(random(1)[0] ?? 0) % (i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
