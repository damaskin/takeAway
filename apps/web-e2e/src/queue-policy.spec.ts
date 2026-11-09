import { expect, test } from '@playwright/test';

import { installFakeApi } from './support/fake-api';
import { useEnglish } from './support/locale';
import { signIn } from './support/session';

/**
 * Checkout and the order page under the order queue policy
 * (docs/queue-policy.md 2.5): the ready time of the cart if ordered now,
 * «as soon as possible» closed when the cart would miss the closing, the
 * free windows in the time picker, and «Ready at 12:11 · ≈ 11 min» on the
 * order page.
 */

test.beforeEach(async ({ page }) => {
  await useEnglish(page);
});

async function fillCart(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/products/flat-white');
  await page.getByRole('button', { name: /add to cart/i }).click();
  await page.goto('/checkout?store=dubai-marina');
}

test.describe('order queue policy', () => {
  test('checkout says when the cart would be ready if ordered now', async ({ page }) => {
    await installFakeApi(page, { queuePolicy: {} });
    await signIn(page);
    await fillCart(page);

    await expect(page.getByTestId('queue-ready')).toHaveText(
      /Order now and it will be ready at \d{1,2}:\d{2}( [AP]M)? · ≈ 1[01] min/,
    );
    await page.screenshot({ path: test.info().outputPath('queue-checkout.png'), fullPage: true });
  });

  test('a cart that would miss the closing is offered the free windows instead', async ({ page }) => {
    await installFakeApi(page, { queuePolicy: { asapBlockedReason: 'CLOSING_SOON' } });
    await signIn(page);
    await fillCart(page);

    await expect(page.getByTestId('asap-blocked')).toHaveText(
      "We won't make it before closing — order for a later time",
    );
    await expect(page.getByRole('button', { name: 'ASAP', exact: true })).toBeDisabled();
    // One window of 12 minutes: its ends and the five-minute marks inside it (4 or 5 times).
    const options = page.getByLabel('Pick up at').locator('optgroup option');
    await expect(options.first()).toBeAttached();
    expect(await options.count()).toBeGreaterThanOrEqual(4);
    expect(await options.count()).toBeLessThanOrEqual(5);
  });

  test('the order page reads «Ready at … · ≈ … min»', async ({ page }) => {
    const api = await installFakeApi(page, { queuePolicy: {} });
    await signIn(page);
    api.seedOrder({ status: 'ACCEPTED', pickupAt: new Date(Date.now() + 9 * 60_000 + 30_000).toISOString() });

    await page.goto('/orders/order-1');

    await expect(page.getByTestId('pickup-when')).toHaveText(/Ready at \d{1,2}:\d{2}( [AP]M)? · ≈ 10 min/);
  });
});
