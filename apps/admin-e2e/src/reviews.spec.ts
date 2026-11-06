import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * «Отзывы» (Maxim's list 5.0, item 11): the platform admin reads what
 * customers said about their orders — stars, comment, who and where — and
 * opens the order behind a review.
 */
test('the platform admin reads order reviews and opens the order behind one', async ({ context, page }) => {
  await signIn(context);
  await installFakeApi(context);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/platform');
  await page.getByRole('link', { name: 'Отзывы' }).click();
  await expect(page).toHaveURL(/\/reviews$/);
  await expect(page.getByRole('heading', { name: 'Отзывы' })).toBeVisible();

  // Two reviews of the brand: (2 + 5) / 2.
  await expect(page.getByTestId('reviews-average')).toHaveText('3,5');
  await expect(page.getByTestId('reviews-count')).toHaveText('Отзывов: 2');
  const reviews = page.getByTestId('review');
  await expect(reviews).toHaveCount(2);
  await expect(reviews.first()).toContainText('Латте был холодный');
  await expect(reviews.first().getByRole('img', { name: 'Оценка 2 из 5' })).toBeVisible();
  await expect(reviews.nth(1)).toContainText('Без имени (аккаунт удалён)');
  await page.screenshot({ path: test.info().outputPath('reviews.png'), fullPage: true });

  await page.getByRole('button', { name: '2 ★ · 1' }).click();
  await expect(reviews).toHaveCount(1);

  await page.getByRole('button', { name: 'Открыть заказ #1234' }).click();
  await expect(page.getByRole('dialog')).toContainText('#1234');
});
