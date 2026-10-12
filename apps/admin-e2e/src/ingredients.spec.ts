import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * The add-ons library («Добавки»): each add-on with its usual price and the
 * products it is in. An owner marks oat milk as run out in one place, and
 * every product's oat-milk option hides for customers.
 */

test.beforeEach(async ({ context }) => {
  await signIn(context);
  await installFakeApi(context);
});

test('marks an add-in as run out from the sidebar', async ({ page }) => {
  await page.goto('/menu');
  await page.getByRole('link', { name: 'Добавки' }).click();

  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByRole('heading', { name: 'Добавки', level: 1 })).toBeVisible();
  const row = page.getByTestId('ingredient-row').filter({ hasText: 'Овсяное молоко' });
  await expect(row.getByTestId('ingredient-price')).toHaveText('+5 MDL');
  await expect(row.getByTestId('ingredient-usage')).toHaveText('В товарах (1): Flat White');

  const saved = page.waitForRequest(
    (req) => req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith('/admin/ingredients/ing-oat'),
  );
  await row.getByRole('switch', { name: 'Овсяное молоко' }).click();

  expect((await saved).postDataJSON()).toEqual({ isAvailable: false });
  await expect(row.getByRole('switch')).toHaveText(/Нет в наличии/);
  await expect(page.getByRole('button', { name: /Нет в наличии · 1/ })).toBeVisible();
});
