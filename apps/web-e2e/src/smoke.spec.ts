import { expect, test } from '@playwright/test';

import { useEnglish } from './support/locale';

/**
 * Smoke tests for the web app. These only touch UI that renders without a
 * live API: chrome (nav, hero copy), empty-state fallbacks, and the
 * navigation skeleton. Anything that hits /api/* is stubbed via page.route
 * so the suite stays CI-deterministic.
 */

test.describe('takeAway web — smoke', () => {
  test.beforeEach(async ({ page }) => {
    await useEnglish(page);
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
    // Businesses find their way in from the header, not only the footer.
    await expect(page.locator('header').getByRole('link', { name: 'For business' })).toHaveAttribute(
      'href',
      '/business/signup',
    );
    // Sign in pill + Order pill.
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Order' }).first()).toBeVisible();
  });

  test('login page offers the configured sign-in providers', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByText(/choose how you would like to sign in/i)).toBeVisible();
    // Telegram is the one provider configured in a default build (Google
    // and Apple client ids are blank in index.html), so its widget host is
    // what must be here. This is the guard against the provider block
    // vanishing entirely — the state that leaves customers with no way in.
    // Attached, not visible: the widget's own iframe comes from
    // telegram.org and never loads in an offline test run, so the host
    // element has no size. Its presence is the thing worth asserting.
    await expect(page.locator('lib-telegram-login-button')).toBeAttached();
    await expect(page.getByText(/by continuing you agree to our/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });

  test('home footer links the legal pages', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
    await expect(footer.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    await expect(footer.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });

  // App Store review opens these without an account: they must render for a
  // signed-out visitor instead of falling back to the home page.
  for (const { path, heading } of [
    { path: '/privacy', heading: 'Privacy Policy' },
    { path: '/terms', heading: 'Terms of Service' },
    { path: '/support', heading: 'Support' },
  ]) {
    test(`${path} is public and names the support contacts`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('link', { name: 'help@takeaway.md' }).first()).toHaveAttribute(
        'href',
        'mailto:help@takeaway.md',
      );
      await expect(page).toHaveTitle(`${heading} — takeAway`);
    });
  }

  test('legal pages follow the language switcher', async ({ page }) => {
    await page.goto('/privacy');
    await page.getByRole('button', { name: /switch language to русский/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Политика конфиденциальности' })).toBeVisible();
  });

  // The site is a marketplace: «Меню» must not drop the visitor into one café.
  test('the menu link opens the choice of places', async ({ page }) => {
    await page.goto('/');
    await page.locator('header').getByRole('link', { name: 'Menu' }).first().click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByRole('heading', { name: 'Choose a place' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'What they sell' })).toBeVisible();
  });

  test('stores page renders the map chrome + nearby sidebar', async ({ page }) => {
    await page.goto('/stores');
    await expect(page.getByRole('heading', { name: 'Nearby stores' })).toBeVisible();
    await expect(page.getByPlaceholder(/district, store, landmark/i)).toBeVisible();
    await expect(page.getByText(/no stores match this filter/i)).toBeVisible();
  });
});
