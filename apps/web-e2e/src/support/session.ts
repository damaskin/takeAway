import type { Page } from '@playwright/test';

/** Signs in by seeding the session the app persists, skipping the OAuth hop. */
export async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'takeaway.web.session',
      JSON.stringify({
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        accessTokenExpiresInSeconds: 900,
        refreshTokenExpiresInSeconds: 604800,
        user: {
          id: 'user-1',
          phone: null,
          email: 'sam@example.com',
          name: 'Sam',
          locale: 'EN',
          currency: 'AED',
          role: 'CUSTOMER',
        },
      }),
    );
  });
}
