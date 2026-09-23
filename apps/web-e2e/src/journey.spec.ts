import { expect, test, type Page } from '@playwright/test';

import { installFakeApi, PRODUCT } from './support/fake-api';
import { useEnglish } from './support/locale';

/**
 * The customer journey, end to end through the real Angular app.
 *
 * This is the path the whole product exists to serve — find a store, pick
 * a drink, choose when to collect it, place the order — and until now
 * nothing tested it. The smoke suite only proved individual screens
 * rendered; it could not have caught two screens failing to talk to each
 * other, which is where the interesting bugs live.
 *
 * The API is a stateful fake (see support/fake-api.ts) so the suite runs
 * in CI without Postgres, and so a test can assert on what checkout
 * actually sent rather than only on what it drew.
 *
 * Card payment is out of scope here: the fake API leaves
 * `/config/features` empty, so `agroprombankEnabled` stays off and checkout
 * offers only paying at the counter — which is exactly the path this suite
 * walks. Driving a real charge needs the bank's sandbox, which the mock
 * gateway under tools/agroprombank-mock covers instead.
 */

test.beforeEach(async ({ page }) => {
  // The app is Russian-first; pin English so the assertions below read as
  // the copy they are checking.
  await useEnglish(page);
});

/**
 * The submit button, matched on its full label rather than a loose /pay/i,
 * which also catches the payment-method options above it.
 */
function placeOrder(page: Page) {
  return page.getByRole('button', { name: /·\s*ready by/i });
}

/** Signs in by seeding the session the app persists, skipping the OAuth hop. */
async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'takeaway.web.session',
      JSON.stringify({
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        accessTokenExpiresInSeconds: 900,
        refreshTokenExpiresInSeconds: 604800,
        user: {
          id: 'user-1',
          phone: null,
          email: 'sam@example.com',
          name: 'Sam',
          locale: 'EN',
          currency: 'AED',
          role: 'CUSTOMER',
        },
      }),
    );
  });
}

test.describe('customer journey', () => {
  test('browse a store, add a drink, schedule a slot, place the order', async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);

    // ── Store → menu ──────────────────────────────────────────────────
    await page.goto('/stores');
    await expect(page.getByText('takeAway Marina').first()).toBeVisible();

    await page.goto('/stores/dubai-marina');
    await expect(page.getByText(PRODUCT.name).first()).toBeVisible();

    // ── Product → cart ────────────────────────────────────────────────
    await page.goto('/products/flat-white');
    const addToCart = page.getByRole('button', { name: /add to cart/i });
    await expect(addToCart).toBeEnabled();
    await addToCart.click();

    // ── Checkout ──────────────────────────────────────────────────────
    await page.goto('/checkout?store=dubai-marina');
    await expect(page.getByText(PRODUCT.name).first()).toBeVisible();

    // The store charges tax inside the price, so the total must equal the
    // subtotal and a separate "incl. tax" line must appear.
    await expect(page.getByText(/incl\. tax/i)).toBeVisible();

    // ── Scheduling: only slots the kitchen can keep ───────────────────
    await page.getByRole('button', { name: /later/i }).click();

    // Slot labels are localized times, so they carry an AM/PM suffix under
    // en-US and none under a 24-hour locale. Match both.
    const slotButtons = page.locator('button', { hasText: /^\s*\d{1,2}:\d{2}(\s*[AP]M)?\s*$/i });
    await expect(slotButtons.first()).toBeVisible();
    // The fake marks the first window full; it must render disabled rather
    // than disappear, so the customer reads "busy" not "broken".
    await expect(slotButtons.nth(0)).toBeDisabled();
    await expect(slotButtons.nth(1)).toBeEnabled();
    await slotButtons.nth(1).click();

    // ── Place ─────────────────────────────────────────────────────────
    await placeOrder(page).click();
    await page.waitForURL(/\/orders\/order-1/);

    // The order screen shows the pickup code the customer will read out.
    await expect(page.getByText('4832')).toBeVisible();

    // And checkout sent a real scheduled slot, not a free-typed time.
    expect(api.orders).toHaveLength(1);
    const sent = api.orders[0]?.['_request'] as Record<string, unknown>;
    expect(sent['pickupMode']).toBe('SCHEDULED');
    expect(typeof sent['pickupAt']).toBe('string');
    expect(new Date(sent['pickupAt'] as string).getTime()).toBeGreaterThan(Date.now());
  });

  test('ASAP checkout sends no pickup time and quotes a live ETA', async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);

    await page.goto('/products/flat-white');
    await page.getByRole('button', { name: /add to cart/i }).click();

    await page.goto('/checkout?store=dubai-marina');
    await placeOrder(page).click();
    await page.waitForURL(/\/orders\/order-1/);

    const sent = api.orders[0]?.['_request'] as Record<string, unknown>;
    expect(sent['pickupMode']).toBe('ASAP');
    // ASAP must not carry a time — the server quotes it from the queue.
    expect(sent['pickupAt']).toBeUndefined();
  });

  test('after hours checkout offers only a scheduled pickup', async ({ page }) => {
    // Switched on, but past closing time: the API reports openNow = false.
    const api = await installFakeApi(page, { storeOpenNow: false });
    await signIn(page);

    await page.goto('/products/flat-white');
    await page.getByRole('button', { name: /add to cart/i }).click();
    await page.goto('/checkout?store=dubai-marina');

    await expect(page.getByText(/closed right now/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^\s*asap\s*$/i })).toBeDisabled();

    // Checkout opens on the slots with the first free window already picked.
    const slotButtons = page.locator('button', { hasText: /^\s*\d{1,2}:\d{2}(\s*[AP]M)?\s*$/i });
    await expect(slotButtons.nth(1)).toBeEnabled();

    await placeOrder(page).click();
    await page.waitForURL(/\/orders\/order-1/);

    const sent = api.orders[0]?.['_request'] as Record<string, unknown>;
    expect(sent['pickupMode']).toBe('SCHEDULED');
    expect(typeof sent['pickupAt']).toBe('string');
  });

  test('a customer with points can spend them, and the total falls', async ({ page }) => {
    const api = await installFakeApi(page, { pointsBalance: 500 });
    await signIn(page);

    await page.goto('/products/flat-white');
    await page.getByRole('button', { name: /add to cart/i }).click();
    await page.goto('/checkout?store=dubai-marina');

    // 18.00 subtotal, so the total starts there (tax is inside the price).
    // The amount and its code are separated by a no-break space.
    await expect(page.getByText(/18\s*AED/).first()).toBeVisible();

    await expect(page.getByText(/500 points available/i)).toBeVisible();
    await page.getByRole('spinbutton').first().fill('500');
    // A test id rather than copy: promo and gift card have Apply buttons
    // of their own, and every ancestor section contains the heading text.
    await page.getByTestId('points-apply').click();

    await expect(page.getByText(/500 points applied/i)).toBeVisible();
    // 500 points at a cent each is 5.00 off.
    await expect(page.getByText(/13\s*AED/).first()).toBeVisible();

    await placeOrder(page).click();
    await page.waitForURL(/\/orders\/order-1/);

    const sent = api.orders[0]?.['_request'] as Record<string, unknown>;
    expect(sent['pointsToSpend']).toBe(500);
  });

  test('a customer with no points never sees the points control', async ({ page }) => {
    await installFakeApi(page, { pointsBalance: 0 });
    await signIn(page);

    await page.goto('/products/flat-white');
    await page.getByRole('button', { name: /add to cart/i }).click();
    await page.goto('/checkout?store=dubai-marina');

    await expect(page.getByText(PRODUCT.name).first()).toBeVisible();
    // An empty points section is worse than none at all.
    await expect(page.getByTestId('points-section')).toHaveCount(0);
  });

  test('signed out, the product page will not let you add to the cart', async ({ page }) => {
    await installFakeApi(page);

    await page.goto('/products/flat-white');
    await expect(page.getByRole('button', { name: /add to cart/i })).toBeDisabled();
  });
});
