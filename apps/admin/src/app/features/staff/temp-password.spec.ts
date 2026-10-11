import { generateTempPassword, tempPasswordValid } from './temp-password';

describe('temporary password', () => {
  it('follows the API rule: 8 to 128 characters', () => {
    expect(tempPasswordValid('1234567')).toBe(false);
    expect(tempPasswordValid('12345678')).toBe(true);
    expect(tempPasswordValid('x'.repeat(128))).toBe(true);
    expect(tempPasswordValid('x'.repeat(129))).toBe(false);
  });

  it('generates 12 characters with a lower-case letter, a capital and a digit, nothing easy to misread', () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTempPassword();
      expect(password).toHaveLength(12);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).not.toMatch(/[0O1lI]/);
      expect(tempPasswordValid(password)).toBe(true);
    }
  });

  it('never goes below the minimum, and redraws values that would bias the alphabet', () => {
    expect(generateTempPassword(4)).toHaveLength(8);

    // The first draw is above the unbiased limit and must be thrown away.
    const draws = [0xffff_ffff, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83];
    let i = 0;
    const words = (count: number) => Uint32Array.from({ length: count }, () => draws[i++ % draws.length] as number);
    expect(generateTempPassword(12, words)).toHaveLength(12);
  });
});
