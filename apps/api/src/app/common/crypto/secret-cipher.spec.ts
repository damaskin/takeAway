import { ConfigService } from '@nestjs/config';

import { SecretCipher } from './secret-cipher';

const FIXED_KEY = 'a'.repeat(64);

const fakeConfig = (env: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('SecretCipher', () => {
  it('round-trips strings and JSON', () => {
    const cipher = new SecretCipher(fakeConfig({ POS_CREDENTIALS_KEY: FIXED_KEY }));
    const original = 'super-secret-token';
    const encrypted = cipher.encrypt(original);
    expect(encrypted).not.toContain(original);
    expect(cipher.decrypt(encrypted)).toBe(original);

    const obj = { kind: 'POSTER', token: 'tk_123', accountName: 'demo' };
    const encJson = cipher.encryptJson(obj);
    expect(cipher.decryptJson(encJson)).toEqual(obj);
  });

  it('produces a different ciphertext for the same plaintext on each call (random IV)', () => {
    const cipher = new SecretCipher(fakeConfig({ POS_CREDENTIALS_KEY: FIXED_KEY }));
    const a = cipher.encrypt('hello');
    const b = cipher.encrypt('hello');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('hello');
    expect(cipher.decrypt(b)).toBe('hello');
  });

  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const cipher = new SecretCipher(fakeConfig({ POS_CREDENTIALS_KEY: FIXED_KEY }));
    const enc = cipher.encrypt('payload');
    const tampered = Buffer.from(enc, 'base64');
    const lastIdx = tampered.length - 1;
    tampered[lastIdx] = (tampered[lastIdx] ?? 0) ^ 0x01;
    expect(() => cipher.decrypt(tampered.toString('base64'))).toThrow();
  });

  it('refuses a malformed key', () => {
    expect(() => new SecretCipher(fakeConfig({ POS_CREDENTIALS_KEY: 'too-short' }))).toThrow(
      /must be 64 hex characters/,
    );
  });

  it('demands a key in production', () => {
    expect(() => new SecretCipher(fakeConfig({ NODE_ENV: 'production' }))).toThrow(/required in production/);
  });
});
