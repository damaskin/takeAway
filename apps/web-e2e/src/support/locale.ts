import type { Page } from '@playwright/test';

/**
 * Pins the UI language for a test run.
 *
 * The app is Russian-first — Russian regardless of browser locale, unless
 * the customer has picked otherwise. Assertions written against English
 * copy therefore passed only by accident before the i18n work and have
 * been failing quietly ever since, because CI runs lint/test/build and
 * never `e2e`.
 *
 * Setting the stored choice makes the suite deterministic and independent
 * of whatever the default becomes later.
 */
export async function useEnglish(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('takeaway.locale', 'en'));
}
