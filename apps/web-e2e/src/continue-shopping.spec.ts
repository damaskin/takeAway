import { expect, test, type Page } from '@playwright/test';

import { installFakeApi } from './support/fake-api';
import { useEnglish } from './support/locale';
import { signIn } from './support/session';

/**
 * «Продолжить покупки» on the product page (Maxim's list 6.0, item 2): once
 * something is in the cart the page offers checkout and, next to it, the way
 * back to the menu — to the category the product sits in, on screen under
 * the sticky bars, wherever the product page was scrolled to.
 */

test.beforeEach(async ({ page }) => {
  await useEnglish(page);
});

/** Where the bakery's heading sits in the window, in CSS pixels from the top. */
function bakeryTop(page: Page): Promise<number> {
  return page.evaluate(() => document.getElementById('cat-cat-2')?.getBoundingClientRect().top ?? Number.NaN);
}

async function addAndContinue(page: Page): Promise<void> {
  // The customer scrolled down to the button on the product page.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', { name: /add to cart/i }).click();

  const checkout = page.getByTestId('product-go-to-checkout');
  const more = page.getByTestId('product-continue-shopping');
  await expect(checkout).toHaveText('Go to checkout · 1 in cart');
  await expect(checkout).toHaveAttribute('href', '/checkout?store=dubai-marina');
  await expect(more).toHaveText('Continue shopping');
  const shots = process.env['E2E_SHOTS'];
  if (shots) {
    await page.getByTestId('product-next').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/product-next-${page.viewportSize()?.width}.png` });
  }

  await more.click();
  await expect(page).toHaveURL(/\/stores\/dubai-marina#cat-cat-2$/);
  await expect(page.locator('#cat-cat-2')).toBeInViewport();
  // On the category, not merely somewhere on the page: its heading is near
  // the top, below the sticky header and chips, not hidden under them.
  await expect.poll(() => bakeryTop(page)).toBeGreaterThan(40);
  await expect.poll(() => bakeryTop(page)).toBeLessThan(260);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}

test.describe('continue shopping from the product page', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('from the menu: back to the product’s category', async ({ page }) => {
    await installFakeApi(page, { menuKinds: true, moreDrinks: 12, morePastries: 8 });
    await signIn(page);

    await page.goto('/stores/dubai-marina');
    await page
      .getByRole('link', { name: /croissant/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/products\/croissant/);
    await addAndContinue(page);
  });

  test('from a direct link to the product: the menu still opens on its category', async ({ page }) => {
    await installFakeApi(page, { menuKinds: true, moreDrinks: 12, morePastries: 8 });
    await signIn(page);

    await page.goto('/products/croissant?store=dubai-marina');
    await addAndContinue(page);
  });
});

test('on a wide screen the two buttons sit side by side', async ({ page }) => {
  await installFakeApi(page, { menuKinds: true });
  await signIn(page);

  await page.goto('/products/croissant?store=dubai-marina');
  await page.getByRole('button', { name: /add to cart/i }).click();
  const checkout = await page.getByTestId('product-go-to-checkout').boundingBox();
  const more = await page.getByTestId('product-continue-shopping').boundingBox();
  if (!checkout || !more) throw new Error('buttons not drawn');
  expect(Math.abs(checkout.y - more.y)).toBeLessThan(2);
  expect(more.x).toBeGreaterThan(checkout.x + checkout.width);
  const shots = process.env['E2E_SHOTS'];
  if (shots) await page.screenshot({ path: `${shots}/product-next-wide.png` });
});
