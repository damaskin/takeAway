import { expect, test } from '@playwright/test';

import { BRAND, STORE, installFakeApi, signIn } from './support/fake-api';

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
  /** What a tablet bound to NoName Coffee may offer: that brand's stores with a PIN holder. */
  const DEVICE_STORES = {
    brandId: BRAND.id,
    brandName: BRAND.name,
    stores: [
      { id: STORE.id, name: STORE.name, city: STORE.city },
      { id: 'store-2', name: 'Молл', city: STORE.city },
    ],
  };

  test('a PIN opens the board full-screen, without the cabinet around it', async ({ context, page }) => {
    await installFakeApi(context);
    const paired: unknown[] = [];
    await context.route('**/api/auth/kds/device/pair', async (route) => {
      paired.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deviceToken: 'tablet-token', brandId: BRAND.id, brandName: BRAND.name }),
      });
    });
    const deviceTokens: Array<string | undefined> = [];
    await context.route('**/api/auth/kds/device', async (route) => {
      deviceTokens.push(route.request().headers()['x-kitchen-device']);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEVICE_STORES) });
    });
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
          kdsStoreId: STORE.id,
        }),
      });
    });
    await context.route('**/api/kds/orders**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDERS) }),
    );

    await page.setViewportSize({ width: 1280, height: 800 });

    // A tablet nobody has bound yet has no keypad, only the way to bind it.
    await page.goto('/login');
    await page.getByRole('link', { name: 'Вход для кухни по PIN' }).click();
    await expect(page.getByRole('heading', { name: 'Планшет не привязан к заведению' })).toBeVisible();
    await expect(page.getByTestId('pin-submit')).toHaveCount(0);

    // The owner's one-time link from «Сотрудники» → «Планшеты кухни» binds it.
    await page.goto('/login/pin?pair=one-time-code');
    await expect(page).toHaveURL(/\/login\/pin$/);
    expect(paired).toEqual([{ code: 'one-time-code' }]);
    await expect(page.getByTestId('pin-brand')).toHaveText(BRAND.name);
    expect(deviceTokens).toEqual(['tablet-token']);

    await page.locator('select').selectOption(STORE.id);
    const enter = page.getByTestId('pin-submit');
    await expect(enter).toBeDisabled();
    for (const digit of ['2', '5', '8', '0']) await page.getByRole('button', { name: digit, exact: true }).click();
    // Four digits may be a PIN, but nothing is sent until «Войти»: six-digit PINs need the room.
    await expect(enter).toBeEnabled();
    expect(pins).toEqual([]);
    for (const digit of ['4', '7']) await page.getByRole('button', { name: digit, exact: true }).click();
    await enter.click();

    await expect(page).toHaveURL(/\/kitchen\?store=store-1$/);
    expect(pins).toEqual([{ storeId: STORE.id, pin: '258047', deviceToken: 'tablet-token' }]);
    await expect(page.getByRole('region', { name: 'Новые' }).getByText('A12')).toBeVisible();
    await expect(page.locator('app-admin-sidebar')).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('kitchen-tablet.png') });

    await page.getByRole('button', { name: 'Выйти из режима планшета' }).click();
    const sidebar = page.locator('app-admin-sidebar');
    await expect(sidebar).toBeVisible();
    // A PIN session reaches the board and the stop-list of its store, nothing else.
    await expect(sidebar.locator('a.admin-nav')).toHaveText([/Кухня/, /Стоп-лист/]);
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

    // The Staff page lists people; the PIN lives on the person's own page.
    await page.getByRole('link', { name: /Ion/ }).click();
    await expect(page).toHaveURL(/\/staff\/user-2$/);

    const pins = page.getByRole('region', { name: 'PIN для кухни' });
    await expect(pins).toBeVisible();
    await expect(pins.getByText('PIN не задан')).toBeVisible();
    await expect(pins.getByRole('combobox', { name: 'Точка для PIN' })).toHaveValue(STORE.id);
    const pinInput = pins.getByRole('textbox', { name: 'PIN' });
    const setPin = pins.getByRole('button', { name: 'Задать PIN' });

    // A new PIN is exactly six digits, and not one a stranger guesses first.
    await pinInput.fill('4321');
    await expect(pins.getByText('Новый PIN — ровно 6 цифр.')).toBeVisible();
    await expect(setPin).toBeDisabled();
    await pinInput.fill('123456');
    await expect(pins.getByText(/Слишком простой PIN/)).toBeVisible();
    await expect(setPin).toBeDisabled();

    await pinInput.fill('402917');
    await setPin.click();

    await expect
      .poll(() => puts)
      .toEqual([{ url: `/api/admin/stores/${STORE.id}/staff/user-2/kds-pin`, body: { pin: '402917' } }]);
    await expect(pins.getByText(`PIN открывает планшет кухни точки «${STORE.name}».`)).toBeVisible();
    await expect(pins.getByRole('button', { name: 'Сменить PIN' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('staff-kitchen-pins.png'), fullPage: true });
  });
});
