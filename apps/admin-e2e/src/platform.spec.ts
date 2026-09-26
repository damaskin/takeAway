import { expect, test } from '@playwright/test';

import { BRAND, installFakeApi, signIn } from './support/fake-api';

/**
 * The platform admin's "whole project": every business side by side, and a
 * way into any one of them as its owner sees it.
 */
test('the whole-project view opens a business as its owner sees it', async ({ context, page }) => {
  await signIn(context);
  await installFakeApi(context);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/');
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('heading', { name: 'Весь проект' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Новая кофейня' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('platform.png'), fullPage: true });

  await page
    .getByRole('row', { name: new RegExp(BRAND.name) })
    .getByRole('button', { name: 'Открыть кабинет' })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.admin-topbar select')).toHaveValue(BRAND.id);

  // And back through the header picker.
  await page.locator('.admin-topbar select').selectOption({ label: 'Весь проект' });
  await expect(page).toHaveURL(/\/platform$/);
});
