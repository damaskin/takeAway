import { expect, test } from '@playwright/test';

import { installFakeApi } from './support/fake-api';
import { useEnglish } from './support/locale';
import { signIn } from './support/session';

/**
 * The order page on its own: what the customer reads while the order is
 * made, and when they may still cancel it. Orders are put on file in the
 * fake API directly (`seedOrder`), in the states the kitchen moves them to.
 */

test.beforeEach(async ({ page }) => {
  await useEnglish(page);
  await signIn(page);
});

const minutesFromNow = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

/** 09:15 tomorrow on the store's clock (Dubai, UTC+4, no DST). */
function tomorrowAt0915InDubai(): string {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' })
    .format(new Date())
    .split('-')
    .map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1, 5, 15)).toISOString();
}

test.describe('order page', () => {
  test('shows the pickup code to say at the counter, and no QR placeholder', async ({ page }) => {
    const api = await installFakeApi(page);
    api.seedOrder();

    await page.goto('/orders/order-1');
    const code = page.getByTestId('pickup-code');
    await expect(code).toContainText('Your code');
    await expect(code).toContainText('4832');
    await expect(code).toContainText('Say it at the counter');
    await expect(page.getByLabel('QR code placeholder')).toHaveCount(0);
  });

  test('a pre-order for tomorrow morning names the time, not hours of countdown', async ({ page }) => {
    const api = await installFakeApi(page);
    api.seedOrder({ pickupMode: 'SCHEDULED', pickupAt: tomorrowAt0915InDubai() });

    await page.goto('/orders/order-1');
    const clock = page.getByTestId('order-clock');
    await expect(clock).toContainText('Ready by');
    await expect(clock).toContainText(/9:15\sAM/);
    await expect(clock).toContainText('Tomorrow');
    await expect(page.getByTestId('order-countdown')).toHaveCount(0);
    await expect(page.getByTestId('pickup-when')).toHaveText(/Pickup at 9:15\sAM tomorrow/);
  });

  test('an order due soon counts down until pickup', async ({ page }) => {
    const api = await installFakeApi(page);
    api.seedOrder({ pickupAt: minutesFromNow(12) });

    await page.goto('/orders/order-1');
    await expect(page.getByTestId('order-countdown')).toHaveText(/^\s*1[12]:\d\d\s*$/);
    await expect(page.getByText('until pickup')).toBeVisible();
    await expect(page.getByTestId('pickup-when')).toHaveText(/Pickup in ~1[12] min/);
  });

  test("taken late, it counts down to the kitchen's new time instead of apologising", async ({ page }) => {
    const api = await installFakeApi(page);
    api.seedOrder({
      status: 'IN_PROGRESS',
      canCancel: false,
      pickupAt: minutesFromNow(-3),
      readyEstimateAt: minutesFromNow(8),
    });

    await page.goto('/orders/order-1');
    await expect(page.getByTestId('order-subtitle')).toHaveText(/Preparing · ready in [78] min/);
    await expect(page.getByTestId('order-late')).toHaveCount(0);
    await expect(page.getByTestId('order-countdown')).toBeVisible();
  });

  test('the customer cancels a new order after confirming', async ({ page }) => {
    const api = await installFakeApi(page);
    api.seedOrder();

    await page.goto('/orders/order-1');
    await page.getByRole('button', { name: 'Cancel order' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel order #4832?' });
    await expect(dialog).toBeVisible();
    // Escape keeps the order.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(api.cancels).toEqual([]);

    await page.getByRole('button', { name: 'Cancel order' }).click();
    await page.getByRole('button', { name: 'Yes, cancel' }).click();
    await expect(page.getByTestId('order-subtitle')).toHaveText('Cancelled');
    expect(api.cancels).toEqual(['order-1']);
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  });

  test('once the kitchen accepted, there is no cancel — call the store', async ({ page }) => {
    const api = await installFakeApi(page, { store: { phone: '+971 4 123 4567' } });
    api.seedOrder({ status: 'ACCEPTED', canCancel: false });

    await page.goto('/orders/order-1');
    await expect(page.getByTestId('cancel-note')).toContainText(
      'The order is already being made — call the store to cancel it',
    );
    await expect(page.getByTestId('cancel-call-store')).toHaveAttribute('href', 'tel:+97141234567');
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  });

  test('accepted a moment before the tap: the refusal turns into the call-the-store note', async ({ page }) => {
    const api = await installFakeApi(page, { cancelRefusal: 'ACCEPTED' });
    api.seedOrder();

    await page.goto('/orders/order-1');
    await page.getByRole('button', { name: 'Cancel order' }).click();
    await page.getByRole('button', { name: 'Yes, cancel' }).click();

    await expect(page.getByTestId('cancel-note')).toContainText('The order is already being made');
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
    expect(api.cancels).toEqual(['order-1']);
  });
});
