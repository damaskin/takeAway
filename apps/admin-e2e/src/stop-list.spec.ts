import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * The stop-list: from the kitchen board a cook opens the store's stop-list,
 * puts a dish in the stop, and does the same for an add-in.
 */

test.beforeEach(async ({ context }) => {
  await signIn(context);
  await installFakeApi(context);
});

test('puts a dish and an add-in in the stop from the kitchen', async ({ page }) => {
  await page.goto('/kitchen');
  await page.getByTestId('kitchen-stop-list').click();

  await expect(page.getByRole('heading', { name: 'Стоп-лист' })).toBeVisible();
  const dish = page.getByTestId('stop-row').filter({ hasText: 'Flat White' });

  const stopped = page.waitForRequest(
    (req) => req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/admin/stores/store-1/stop-list'),
  );
  await dish.getByRole('switch', { name: 'Flat White' }).click();
  expect((await stopped).postDataJSON()).toEqual({ productId: 'product-1' });
  await expect(dish.getByRole('switch')).toHaveText(/В стопе/);

  await page.getByRole('button', { name: /Добавки · 1/ }).click();
  const addin = page.getByTestId('stop-row').filter({ hasText: 'Овсяное молоко' });
  const addinStopped = page.waitForRequest(
    (req) =>
      req.method() === 'PUT' && new URL(req.url()).pathname.endsWith('/admin/stores/store-1/ingredient-stops/ing-oat'),
  );
  await addin.getByRole('switch', { name: 'Овсяное молоко' }).click();
  await addinStopped;
  await expect(addin.getByRole('switch')).toHaveText(/В стопе/);
});
