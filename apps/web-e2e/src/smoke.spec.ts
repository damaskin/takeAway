import { expect, test } from '@playwright/test';

/**
 * Smoke tests for the web app. These only touch UI that renders without a
 * live API: chrome (nav, hero copy), empty-state fallbacks, and the
 * navigation skeleton. Anything that hits /api/* is stubbed via page.route
 * so the suite stays CI-deterministic.
 */

test.describe('takeAway web — smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Return an empty stores list so Home renders its own layout without
    // tripping over connection errors against a missing API.
    await page.route('**/api/stores*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      }),
    );
  });

  test('home renders brand chrome and hero CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'takeAway' }).first()).toBeVisible();
    // Nav links.
    await expect(page.getByRole('link', { name: 'Menu' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stores' }).first()).toBeVisible();
    // Sign in pill + Order pill.
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Order' }).first()).toBeVisible();
  });

  test('login page renders the phone form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByPlaceholder(/50 123 4567/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  });

  test('stores page renders the map chrome + nearby sidebar', async ({ page }) => {
    await page.goto('/stores');
    await expect(page.getByRole('heading', { name: 'Nearby stores' })).toBeVisible();
    await expect(page.getByPlaceholder(/district, store, landmark/i)).toBeVisible();
    await expect(page.getByText(/no stores match this filter/i)).toBeVisible();
  });
});
