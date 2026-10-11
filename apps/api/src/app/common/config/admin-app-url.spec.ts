import type { ConfigService } from '@nestjs/config';

import { DEV_ADMIN_APP_URL, adminAppUrl } from './admin-app-url';

const config = (env: Record<string, string>) => ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('adminAppUrl', () => {
  it('uses ADMIN_APP_URL without the trailing slash', () => {
    expect(adminAppUrl(config({ ADMIN_APP_URL: ' https://admin.takeaway.md/ ', NODE_ENV: 'production' }))).toBe(
      'https://admin.takeaway.md',
    );
  });

  it('falls back to the local dev server outside production', () => {
    expect(adminAppUrl(config({}))).toBe(DEV_ADMIN_APP_URL);
    expect(adminAppUrl(config({ NODE_ENV: 'development', ADMIN_APP_URL: '' }))).toBe(DEV_ADMIN_APP_URL);
  });

  it('is null in production when nothing is configured — no localhost links in real mailboxes', () => {
    expect(adminAppUrl(config({ NODE_ENV: 'production' }))).toBeNull();
    expect(adminAppUrl(config({ NODE_ENV: 'production', ADMIN_APP_URL: '  ' }))).toBeNull();
  });
});
