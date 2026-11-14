import { expect, test } from '@playwright/test';

import { POINTS_ORDER, STORE, TAKEAWAY_PROMO_ORDER, installFakeApi, signIn } from './support/fake-api';

/**
 * Maxim's list (2026-11-14), item 4: takeAway compensates its promos and the
 * loyalty points and takes its commission on the full amount, so the business
 * sees the full amount of such an order, with what the guest paid under it.
 */
test.describe('orders', () => {
  test('the list and the order show the full amount takeAway compensates part of', async ({ context, page }) => {
    await signIn(context, 'BRAND_ADMIN');
    await installFakeApi(context, 'BRAND_ADMIN');
    const summary = (id: string, orderCode: string, totalCents: number, takeawayFundedCents: number) => ({
      id,
      orderCode,
      status: 'ACCEPTED',
      pickupMode: 'ASAP',
      pickupAt: '2026-11-06T09:15:00.000Z',
      totalCents,
      currency: 'MDL',
      storeId: STORE.id,
      storeName: STORE.name,
      storeTimezone: STORE.timezone,
      itemCount: 1,
      createdAt: '2026-11-06T09:00:00.000Z',
      takeawayFundedCents,
    });
    await context.route(/\/api\/admin\/orders(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          summary(POINTS_ORDER.id, POINTS_ORDER.orderCode, POINTS_ORDER.totalCents, POINTS_ORDER.pointsCents),
          summary(TAKEAWAY_PROMO_ORDER.id, TAKEAWAY_PROMO_ORDER.orderCode, 9_000, 1_000),
          summary('order-plain', '1060', 2_500, 0),
        ]),
      }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/orders');
    const amounts = page.getByTestId('order-amount');
    await expect(amounts).toHaveCount(3);
    await expect(amounts.nth(0)).toContainText('50 MDL');
    await expect(amounts.nth(0).getByTestId('order-funded')).toHaveText(
      'гость оплатил 30 MDL · 20 MDL компенсирует takeAway',
    );
    await expect(amounts.nth(1)).toContainText('100 MDL');
    await expect(amounts.nth(1).getByTestId('order-funded')).toHaveText(
      'гость оплатил 90 MDL · 10 MDL компенсирует takeAway',
    );
    await expect(amounts.nth(2)).toHaveText('25 MDL');
    await page.screenshot({ path: test.info().outputPath('orders-full-amount.png') });

    await page.getByRole('cell', { name: POINTS_ORDER.orderCode, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`#${POINTS_ORDER.orderCode}`);
    await expect(dialog.getByTestId('order-points')).toContainText('Баллы — компенсирует takeAway');
    await expect(dialog.getByTestId('order-points')).toContainText('20 MDL');
    await expect(dialog.getByTestId('order-business-total')).toContainText('Сумма для бизнеса');
    await expect(dialog.getByTestId('order-business-total')).toContainText('50 MDL');
    await page.screenshot({ path: test.info().outputPath('order-points.png') });
  });
});
