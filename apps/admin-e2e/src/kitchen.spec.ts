import { expect, test } from '@playwright/test';

import { STORE, installFakeApi, signIn } from './support/fake-api';

/**
 * The kitchen board inside the cabinet: the three columns of the old KDS
 * app, one button per ticket, and "Accept" going to the kitchen endpoint —
 * the one that charges a card held at checkout.
 */

const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();

const ORDERS = [
  {
    id: 'order-new',
    orderCode: 'A12',
    status: 'PAID',
    pickupMode: 'ASAP',
    pickupAt: soon(),
    createdAt: new Date().toISOString(),
    customerName: 'Ира',
    notes: null,
    items: [
      {
        quantity: 2,
        productSnapshot: {
          name: 'Капучино',
          variations: [{ id: 'v1', name: '300 мл', priceDeltaCents: 0 }],
          modifiers: [],
          notes: 'без сахара',
        },
      },
    ],
  },
  {
    id: 'order-cooking',
    orderCode: 'B07',
    status: 'IN_PROGRESS',
    pickupMode: 'SCHEDULED',
    pickupAt: soon(),
    createdAt: new Date().toISOString(),
    customerName: null,
    notes: 'Позвонить у двери',
    items: [{ quantity: 1, productSnapshot: { name: 'Латте' } }],
  },
];

test.describe('kitchen board', () => {
  test('shows the columns and accepts through the kitchen endpoint', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    const accepted: string[] = [];
    await context.route('**/api/kds/orders**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST') {
        accepted.push(`${url.pathname}?${url.searchParams.toString()}`);
        return route.fulfill({ status: 201, contentType: 'application/json', body: '{"status":"ACCEPTED"}' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDERS) });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/kitchen');

    await expect(page.getByRole('heading', { name: 'Кухня' })).toBeVisible();
    const newColumn = page.getByRole('region', { name: 'Новые' });
    await expect(newColumn.getByText('A12')).toBeVisible();
    await expect(newColumn.getByText('Капучино')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Готовятся' }).getByText('B07')).toBeVisible();

    // The sidebar counts the order nobody has accepted yet.
    await expect(page.locator('.admin-nav-badge-live')).toHaveText('1');

    await page.screenshot({ path: test.info().outputPath('kitchen-board.png'), fullPage: true });

    await newColumn.getByRole('button', { name: 'Принять' }).click();
    await expect.poll(() => accepted).toEqual([`/api/kds/orders/order-new/accept?storeId=${STORE.id}`]);
  });
});

test.describe('kitchen tablet', () => {
  test('a PIN opens the board full-screen, without the cabinet around it', async ({ context, page }) => {
    await installFakeApi(context);
    await context.route('**/api/stores', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([STORE]) }),
    );
    const pins: unknown[] = [];
    await context.route('**/api/auth/kds/pin', async (route) => {
      pins.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'staff-token',
          refreshToken: 'staff-refresh',
          accessTokenExpiresInSeconds: 900,
          refreshTokenExpiresInSeconds: 86_400,
          user: { id: 'staff-1', name: 'Ion', role: 'STAFF', email: null, phone: null, locale: 'RU' },
        }),
      });
    });
    await context.route('**/api/kds/orders**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDERS) }),
    );

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');
    await page.getByRole('link', { name: 'Вход для кухни по PIN' }).click();
    await page.locator('select').selectOption(STORE.id);
    for (const digit of ['1', '2', '3', '4']) await page.getByRole('button', { name: digit, exact: true }).click();

    await expect(page).toHaveURL(/\/kitchen\?store=store-1$/);
    expect(pins).toEqual([{ storeId: STORE.id, pin: '1234' }]);
    await expect(page.getByRole('region', { name: 'Новые' }).getByText('A12')).toBeVisible();
    await expect(page.locator('app-admin-sidebar')).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('kitchen-tablet.png') });

    await page.getByRole('button', { name: 'Выйти из режима планшета' }).click();
    await expect(page.locator('app-admin-sidebar')).toBeVisible();
  });
});

test.describe('kitchen PINs', () => {
  test('the Staff page sets a PIN for the kitchen tablet', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    const puts: Array<{ url: string; body: unknown }> = [];
    await context.route('**/api/admin/stores/*/staff/*/kds-pin', async (route) => {
      puts.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
      return route.fulfill({ status: 204 });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/staff');

    const pins = page.getByRole('region', { name: 'PIN для кухни' });
    await expect(pins).toBeVisible();
    await expect(pins.getByText('/login/pin')).toBeVisible();
    await pins.getByRole('textbox', { name: 'PIN: Ion' }).fill('4321');
    await pins.getByRole('button', { name: 'Задать PIN' }).click();

    await expect
      .poll(() => puts)
      .toEqual([{ url: `/api/admin/stores/${STORE.id}/staff/user-2/kds-pin`, body: { pin: '4321' } }]);
    await expect(pins.getByText('PIN задан')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('staff-kitchen-pins.png'), fullPage: true });
  });
});
