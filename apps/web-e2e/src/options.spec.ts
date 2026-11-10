import { expect, test, type Page } from '@playwright/test';

import { CATALOG_LATTE, installFakeApi } from './support/fake-api';
import { useEnglish } from './support/locale';
import { signIn } from './support/session';

/**
 * The options catalog («Добавки и варианты», Maxim's list 5.0 item 17) on
 * the product page: a coffee with a size to pick, a serving, a milk, up to
 * two syrups, sugar and — for an iced one only — ice. The fake API prices
 * and checks the choice with the same rules the page uses, as the real one
 * does, so the price on the button has to be the price in the cart.
 */

test.beforeEach(async ({ page }) => {
  await useEnglish(page);
});

async function openLatte(page: Page) {
  const api = await installFakeApi(page, { product: CATALOG_LATTE });
  await signIn(page);
  await page.goto('/products/latte?store=dubai-marina');
  await expect(page.getByRole('heading', { name: 'Latte' })).toBeVisible();
  return api;
}

const addToCart = (page: Page) => page.getByRole('button', { name: /add to cart/i });

/** A folded add-on group's row, which opens it. */
const groupHead = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });

test.describe('options catalog on the product page', () => {
  test('the coffee does not go in the cart until a size is picked', async ({ page }) => {
    await openLatte(page);

    await expect(addToCart(page)).toBeDisabled();
    await expect(page.getByTestId('option-hint')).toHaveText('Choose: Размер (кофе)');

    // Each size with its volume and what it changes in the price.
    const sizes = page.getByRole('radiogroup', { name: 'Размер (кофе)' });
    await expect(sizes.getByRole('radio')).toHaveCount(3);
    await expect(sizes).toContainText('150–250 мл');
    await expect(sizes).toContainText(/−5\sAED/);
    await expect(sizes).toContainText(/\+7\sAED/);

    await page.getByRole('radio', { name: /^M\b/ }).check();
    await expect(addToCart(page)).toBeEnabled();
    await expect(page.getByTestId('option-hint')).toHaveCount(0);
    // The defaults are already in: served hot, cow's milk.
    await expect(page.getByTestId('choice-summary')).toHaveText('M, Горячий · Коровье');
  });

  test('the milk the store has run out of cannot be picked', async ({ page }) => {
    await openLatte(page);

    await groupHead(page, 'Молоко').click();
    const coconut = page.getByRole('radio', { name: /^Кокосовое/ });
    await expect(coconut).toBeDisabled();
    await expect(page.getByRole('radiogroup', { name: 'Молоко' })).toContainText('Out of stock');
  });

  test('a third syrup is refused', async ({ page }) => {
    await openLatte(page);

    await expect(groupHead(page, 'Сиропы')).toContainText('up to 2');
    await groupHead(page, 'Сиропы').click();
    await page.getByRole('checkbox', { name: /^Ваниль/ }).check();
    await page.getByRole('checkbox', { name: /^Карамель/ }).check();
    await expect(page.getByRole('checkbox', { name: /^Солёная карамель/ })).toBeDisabled();
    await expect(groupHead(page, 'Сиропы')).toContainText('Ваниль, Карамель');

    // Taking one back frees the third.
    await page.getByRole('checkbox', { name: /^Карамель/ }).uncheck();
    await expect(page.getByRole('checkbox', { name: /^Солёная карамель/ })).toBeEnabled();
  });

  test('ice shows only for an iced coffee, and goes when it is hot again', async ({ page }) => {
    await openLatte(page);
    await page.getByRole('radio', { name: /^M\b/ }).check();

    const ice = page.getByRole('group', { name: 'Лёд' });
    await expect(ice).toHaveCount(0);

    await page.getByRole('radio', { name: 'Холодный' }).check();
    await expect(ice).toBeVisible();
    await page.getByRole('button', { name: 'More: Лёд' }).click();
    await page.getByRole('button', { name: 'More: Лёд' }).click();
    await expect(page.getByTestId('choice-summary')).toHaveText('M, Холодный · Коровье · Лёд ×2');

    await page.getByRole('radio', { name: 'Горячий' }).check();
    await expect(ice).toHaveCount(0);
    await expect(page.getByTestId('choice-summary')).toHaveText('M, Горячий · Коровье');
  });

  test('the button carries the price, and the cart and the order spell the choice out', async ({ page }) => {
    const api = await openLatte(page);

    await page.getByRole('radio', { name: /^L\b/ }).check();
    await groupHead(page, 'Молоко').click();
    await page.getByRole('radio', { name: /^Овсяное/ }).check();
    await groupHead(page, 'Сиропы').click();
    await page.getByRole('checkbox', { name: /^Ваниль/ }).check();
    await page.getByRole('button', { name: 'More: Сахар' }).click();
    await page.getByRole('button', { name: 'More: Сахар' }).click();

    // 30 + 7 (L) + 10 (oat) + 8 (vanilla); sugar is free.
    await expect(addToCart(page)).toHaveText(/Add to cart — 55\sAED/);
    await addToCart(page).click();
    await expect(page.getByRole('link', { name: /go to checkout · 1 in cart/i })).toBeVisible();

    expect(api.cartAdds).toEqual([
      {
        storeId: 'store-1',
        productId: CATALOG_LATTE.id,
        quantity: 1,
        options: [
          { optionId: 'opt-hot', qty: 1 },
          { optionId: 'opt-l', qty: 1 },
          { optionId: 'opt-oat', qty: 1 },
          { optionId: 'opt-sugar', qty: 2 },
          { optionId: 'opt-vanilla', qty: 1 },
        ],
      },
    ]);

    await page.goto('/checkout?store=dubai-marina');
    await expect(page.getByTestId('cart-line-options')).toHaveText('L, Горячий · Овсяное · Ваниль · Сахар ×2');

    // More of the same line keeps its choice.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByTestId('cart-line-options')).toHaveText('L, Горячий · Овсяное · Ваниль · Сахар ×2');
    await expect(page.getByText(/110\sAED/).first()).toBeVisible();

    await page.getByRole('button', { name: /·\s*ready by/i }).click();
    await page.waitForURL(/\/orders\/order-1/);
    await expect(page.getByText('L, Горячий · Овсяное · Ваниль · Сахар ×2')).toBeVisible();
  });
});
