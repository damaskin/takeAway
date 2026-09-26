import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * The add-ins library: an owner marks oat milk as run out in one place, and
 * every product's oat-milk option hides for customers.
 */

test.beforeEach(async ({ context }) => {
  await signIn(context);
  await installFakeApi(context);
});

test('marks an add-in as run out from the sidebar', async ({ page }) => {
  await page.goto('/menu');
  await page.getByRole('link', { name: 'Добавки' }).click();

  await expect(page.getByRole('heading', { name: 'Добавки и наличие' })).toBeVisible();
  const row = page.getByTestId('ingredient-row').filter({ hasText: 'Овсяное молоко' });
  await expect(row).toContainText('В товарах:');

  const saved = page.waitForRequest(
    (req) => req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith('/admin/ingredients/ing-oat'),
  );
  await row.getByRole('switch', { name: 'Овсяное молоко' }).click();

  expect((await saved).postDataJSON()).toEqual({ isAvailable: false });
  await expect(row.getByRole('switch')).toHaveText(/Нет в наличии/);
  await expect(page.getByRole('button', { name: /Нет в наличии · 1/ })).toBeVisible();
});
