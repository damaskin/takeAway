import { expect, test, type Page } from '@playwright/test';

import { installFakeApi } from './support/fake-api';
import { useEnglish } from './support/locale';
import { signIn } from './support/session';

/**
 * Paying by QR in Agroprombank's app (docs/agroprombank-payments.md §12):
 * checkout places the order and issues its invoice, the QR screen shows the
 * code and waits, and the order opens once the money landed. The fake API
 * stands in for the bank; `payQr()` is the customer paying in the bank app.
 */

test.beforeEach(async ({ page }) => {
  await useEnglish(page);
  await signIn(page);
});

/** The submit button, matched on its full label. */
function placeOrder(page: Page) {
  return page.getByRole('button', { name: /·\s*ready by/i });
}

async function basketAtCheckout(page: Page): Promise<void> {
  await page.goto('/products/flat-white');
  await page.getByRole('button', { name: /add to cart/i }).click();
  await page.goto('/checkout?store=dubai-marina');
}

test.describe('paying by QR', () => {
  test('with cards off, the order is paid by QR and opens once the money lands', async ({ page }) => {
    const api = await installFakeApi(page, {
      cardPayments: false,
      qrPayment: { appLink: 'https://bank.example/qr?code=1' },
    });
    await basketAtCheckout(page);

    // No choice to make: QR is the only way, and nothing says cards are missing.
    await expect(page.getByTestId('pay-method')).toHaveCount(0);
    await expect(page.getByTestId('qr-payment-hint')).toContainText('pay it in the Agroprombank app');
    await expect(page.getByText(/card payments are unavailable/i)).toHaveCount(0);

    await placeOrder(page).click();
    await page.waitForURL(/\/orders\/order-1\/qr$/);
    expect(api.qrStarts).toEqual(['order-1']);
    expect(api.payments).toEqual([]);

    await expect(page.getByTestId('qr-code').locator('svg path')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Open the bank app' })).toHaveAttribute(
      'href',
      'https://bank.example/qr?code=1',
    );
    await expect(page.getByTestId('qr-countdown')).toContainText(/valid for (10:00|9:5\d)/);
    await expect(page.getByTestId('qr-order')).toContainText('4832');

    // The customer pays in the bank's app; the next status read brings the order up.
    api.payQr();
    await page.waitForURL(/\/orders\/order-1$/, { timeout: 10_000 });
    await expect(page.getByTestId('payment-line')).toContainText('Paid by QR');
    await expect(page.getByTestId('payment-line')).toContainText("If the store doesn't accept the order");
    expect(api.qrCancels).toEqual([]);
  });

  test('with cards on, the customer picks QR, and may call the invoice off and pay it again', async ({ page }) => {
    const api = await installFakeApi(page, { qrPayment: {} });
    await basketAtCheckout(page);

    const card = page.getByTestId('pay-method-CARD');
    const qr = page.getByTestId('pay-method-QR');
    await expect(card).toHaveAttribute('aria-checked', 'true');
    await qr.click();
    await expect(qr).toHaveAttribute('aria-checked', 'true');

    await placeOrder(page).click();
    await page.waitForURL(/\/orders\/order-1\/qr$/);
    // The bound card was not charged.
    expect(api.payments).toEqual([]);
    // No link into the bank app: the code itself is the way, and a desktop needs no other-device hint.
    await expect(page.getByRole('link', { name: 'Open the bank app' })).toHaveCount(0);
    await expect(page.getByTestId('qr-hint')).toContainText('Scan the code in the Agroprombank app');

    await page.getByTestId('qr-cancel').click();
    await page.waitForURL(/\/orders\/order-1$/);
    expect(api.qrCancels).toHaveLength(1);

    // The order stays, to be paid by QR again from its page.
    await page.getByTestId('pay-by-qr').click();
    await page.waitForURL(/\/orders\/order-1\/qr$/);
    await expect(page.getByTestId('qr-code').locator('svg path')).toHaveCount(1);
    expect(api.qrStarts).toEqual(['order-1', 'order-1']);
  });
});
