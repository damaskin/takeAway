import { expect, test, type Page } from '@playwright/test';

import { installFakeApi, PRODUCT, type FakeTakeawayPromo } from './support/fake-api';
import { useEnglish } from './support/locale';
import { signIn } from './support/session';

/**
 * «Акции takeAway» on the website (docs/takeaway-promos.md §5): the welcome
 * bonus in the profile and put on at checkout by itself, «Remove» keeping it
 * off the cart, a takeAway code turning «Pay with points» off, and the order
 * page's «takeAway promo −10%» line.
 */

const WELCOME = {
  id: 'bonus-1',
  kind: 'WELCOME',
  promoId: 'tp-1',
  code: 'WELCOME10',
  name: 'Welcome bonus',
  percent: 10,
  currency: 'AED',
  expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
};

const PROMOS: Record<string, FakeTakeawayPromo> = {
  WELCOME10: { percent: 10, isWelcome: true },
  AUTUMN15: { percent: 15 },
};

test.beforeEach(async ({ page }) => {
  await useEnglish(page);
  await signIn(page);
});

async function fillCart(page: Page): Promise<void> {
  await page.goto('/products/flat-white');
  await page.getByRole('button', { name: /add to cart/i }).click();
  await page.goto('/checkout?store=dubai-marina');
  await expect(page.getByText(PRODUCT.name).first()).toBeVisible();
}

/** The submit button, by its full label: «Pay … · ready by …». */
function placeOrder(page: Page) {
  return page.getByRole('button', { name: /·\s*ready by/i });
}

test.describe('takeAway promos', () => {
  test('the profile shows the welcome bonus and leads to ordering', async ({ page }) => {
    await installFakeApi(page, { bonuses: [WELCOME] });

    await page.goto('/profile');

    // The bonus's last day on the customer's calendar, the month spelled out.
    const until = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(new Date(WELCOME.expiresAt));
    await expect(page.getByTestId('bonus-banner')).toContainText('My bonuses');
    await expect(page.getByTestId('bonus-title')).toHaveText('Welcome bonus −10%');
    await expect(page.getByTestId('bonus-terms')).toHaveText(`On an order at any venue · until ${until}`);
    await page.screenshot({ path: test.info().outputPath('profile-bonus.png'), fullPage: true });

    await page.getByTestId('bonus').click();
    await expect(page).toHaveURL(/\/menu$/);
  });

  test('no bonus, no banner', async ({ page }) => {
    await installFakeApi(page);
    await page.goto('/profile');
    await expect(page.getByText('Sam').first()).toBeVisible();
    await expect(page.getByTestId('bonus-banner')).toHaveCount(0);
  });

  test('checkout puts the welcome bonus on by itself, and «Remove» keeps it off the cart', async ({ page }) => {
    const api = await installFakeApi(page, { bonuses: [WELCOME], takeawayPromos: PROMOS });
    await fillCart(page);

    await expect(page.getByTestId('promo-input')).toHaveValue('WELCOME10');
    await expect(page.getByTestId('promo-status')).toHaveText('Welcome bonus −10%');
    await expect(page.getByTestId('promo-line')).toContainText('1.80 AED');
    // 18 AED less 10 %.
    await expect(placeOrder(page)).toContainText('16.20 AED');
    expect(api.promoValidations).toEqual([
      { code: 'WELCOME10', brandId: 'brand-1', subtotalCents: 1800, storeId: 'store-1' },
    ]);
    await page.screenshot({ path: test.info().outputPath('checkout-bonus.png'), fullPage: true });

    await page.getByTestId('promo-apply').click();
    await expect(page.getByTestId('promo-input')).toHaveValue('');
    await expect(page.getByTestId('promo-line')).toHaveCount(0);
    await expect(placeOrder(page)).toContainText('18 AED');

    // Off for this cart, even after a reload.
    await page.reload();
    await expect(page.getByText(PRODUCT.name).first()).toBeVisible();
    await expect(placeOrder(page)).toContainText('18 AED');
    await expect(page.getByTestId('promo-input')).toHaveValue('');
    expect(api.promoValidations).toHaveLength(1);

    await placeOrder(page).click();
    await page.waitForURL(/\/orders\/order-1/);
    const sent = api.orders[0]?.['_request'] as Record<string, unknown>;
    expect(sent['couponCode']).toBeUndefined();
  });

  test('a takeAway code turns «Pay with points» off, and the order goes without points', async ({ page }) => {
    const api = await installFakeApi(page, { pointsBalance: 500, takeawayPromos: PROMOS });
    await fillCart(page);

    await page.getByTestId('points-input').fill('500');
    await page.getByTestId('points-apply').click();
    await expect(page.getByText(/500 points applied/i)).toBeVisible();

    await page.getByTestId('promo-input').fill('AUTUMN15');
    await page.getByTestId('promo-apply').click();

    await expect(page.getByTestId('promo-status')).toHaveText('takeAway promo −15%');
    await expect(page.getByTestId('points-apply')).toBeDisabled();
    await expect(page.getByTestId('points-input')).toBeDisabled();
    await expect(page.getByTestId('points-blocked')).toHaveText("Points can't be combined with a promo code");
    // The points came off: 18 AED less 15 % only.
    await expect(placeOrder(page)).toContainText('15.30 AED');
    await page.screenshot({ path: test.info().outputPath('checkout-takeaway-promo.png'), fullPage: true });

    await placeOrder(page).click();
    await page.waitForURL(/\/orders\/order-1/);
    const sent = api.orders[0]?.['_request'] as Record<string, unknown>;
    expect(sent['couponCode']).toBe('AUTUMN15');
    expect(sent['pointsToSpend']).toBe(0);

    // The order page reads the promo beside its code.
    await expect(page.getByTestId('takeaway-promo-line')).toContainText('takeAway promo −15% · AUTUMN15');
    await expect(page.getByTestId('takeaway-promo-line')).toContainText('2.70 AED');
  });

  test('a takeAway promo in another currency does not work at this venue', async ({ page }) => {
    await installFakeApi(page, { takeawayPromos: { MDL10: { percent: 10, currency: 'MDL' } } });
    await fillCart(page);

    await page.getByTestId('promo-input').fill('MDL10');
    await page.getByTestId('promo-apply').click();
    await expect(page.getByTestId('promo-status')).toHaveText("This promo doesn't work at this venue");
    await expect(page.getByTestId('promo-line')).toHaveCount(0);
  });
});
