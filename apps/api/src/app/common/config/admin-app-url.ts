import type { ConfigService } from '@nestjs/config';

/** Where `pnpm nx serve admin` listens — the default outside production. */
export const DEV_ADMIN_APP_URL = 'http://localhost:4202';

/**
 * Base URL of the business cabinet (`ADMIN_APP_URL`, e.g.
 * `https://admin.takeaway.md`), without a trailing slash — what links in
 * emails to staff point at: password reset, invites.
 *
 * Outside production a missing value means the local dev server. In
 * production it means "not configured" and the answer is null: a reset link
 * to `localhost` in a real mailbox looks like it works and never does, so
 * callers refuse to build one instead.
 */
export function adminAppUrl(config: ConfigService): string | null {
  const configured = (config.get<string>('ADMIN_APP_URL') ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return config.get<string>('NODE_ENV') === 'production' ? null : DEV_ADMIN_APP_URL;
}
