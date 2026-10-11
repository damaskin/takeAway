import type { ConfigService } from '@nestjs/config';

type SecretKey = 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET';

const DEV_FALLBACK: Record<SecretKey, string> = {
  JWT_ACCESS_SECRET: 'change-me-in-prod-access',
  JWT_REFRESH_SECRET: 'change-me-in-prod-refresh',
};

/** Values that only ever mean "nobody filled this in". */
const PLACEHOLDERS = new Set(['CHANGE_ME', ...Object.values(DEV_FALLBACK)]);

/**
 * The secret that signs (or verifies) access or refresh tokens.
 *
 * Local development and tests get a fixed fallback so the API starts with an
 * empty `.env`. Production does not: a missing secret used to fall back to the
 * same string that is in this repository, so anyone who read the source could
 * mint a token for any account. With `NODE_ENV=production` a missing, empty
 * or placeholder secret now stops the API at startup instead.
 */
export function jwtSecret(config: ConfigService, key: SecretKey): string {
  const value = config.get<string>(key)?.trim() ?? '';
  const usable = value !== '' && !PLACEHOLDERS.has(value);
  if (usable) return value;
  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error(
      `${key} is ${value === '' ? 'not set' : 'still a placeholder'} — refusing to start in production. ` +
        'Generate one with `openssl rand -hex 32` and put it in deploy/.env.production.',
    );
  }
  return value || DEV_FALLBACK[key];
}

export function jwtAccessSecret(config: ConfigService): string {
  return jwtSecret(config, 'JWT_ACCESS_SECRET');
}

export function jwtRefreshSecret(config: ConfigService): string {
  return jwtSecret(config, 'JWT_REFRESH_SECRET');
}
