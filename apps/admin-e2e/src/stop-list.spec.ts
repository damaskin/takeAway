import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * The stop-list: from the kitchen board a cook opens the store's stop-list,
 * puts a dish in the stop, and does the same for an option of the catalog.
 */

test.beforeEach(async ({ context }) => {
  await signIn(context);
  await installFakeApi(context);
});

test('puts a dish and a catalog option in the stop from the kitchen', async ({ page }) => {
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

  await page.getByRole('button', { name: /Добавки · \d+/ }).click();
  // The options of the catalog the brand has, under their groups; the older add-ins are gone (2026-11-18).
  await expect(page.getByText('Овсяное молоко')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Сиропы' })).toBeVisible();
  const vanilla = page.getByTestId('stop-row').filter({ hasText: 'Ваниль' });
  const optionStopped = page.waitForRequest(
    (req) =>
      req.method() === 'PUT' && new URL(req.url()).pathname.endsWith('/admin/stores/store-1/option-stops/opt-vanilla'),
  );
  await vanilla.getByRole('switch', { name: 'Ваниль' }).click();
  expect((await optionStopped).postDataJSON()).toEqual({ expiresAt: null });
  await expect(vanilla.getByRole('switch')).toHaveText(/В стопе/);
});
