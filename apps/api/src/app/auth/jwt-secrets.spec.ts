import type { ConfigService } from '@nestjs/config';

import { jwtAccessSecret, jwtRefreshSecret } from './jwt-secrets';

const config = (env: Record<string, string>) => ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('JWT secrets', () => {
  it('uses the configured secret', () => {
    const env = { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'r'.repeat(64) };
    expect(jwtAccessSecret(config(env))).toBe('a'.repeat(64));
    expect(jwtRefreshSecret(config(env))).toBe('r'.repeat(64));
  });

  it.each([
    ['missing', {}],
    ['empty', { JWT_ACCESS_SECRET: '  ' }],
    ['the example placeholder', { JWT_ACCESS_SECRET: 'CHANGE_ME' }],
    ['the old in-code fallback', { JWT_ACCESS_SECRET: 'change-me-in-prod-access' }],
  ])('refuses to start in production when the secret is %s', (_label, env: Record<string, string>) => {
    expect(() => jwtAccessSecret(config({ NODE_ENV: 'production', ...env }))).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses a missing refresh secret in production too', () => {
    expect(() => jwtRefreshSecret(config({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(64) }))).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('keeps a fixed fallback for local development and tests', () => {
    expect(jwtAccessSecret(config({}))).toBe('change-me-in-prod-access');
    expect(jwtRefreshSecret(config({ NODE_ENV: 'test' }))).toBe('change-me-in-prod-refresh');
  });
});
