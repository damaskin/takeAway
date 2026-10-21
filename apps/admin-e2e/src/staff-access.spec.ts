import { type BrowserContext, type Route, expect, test } from '@playwright/test';

import { BRAND, STAFF_MEMBER, STORE, installFakeApi, signIn } from './support/fake-api';

/**
 * Who gets into the kitchen and how: one PIN per person for all their
 * stores, typed before the store is picked; kitchen staff invited with a PIN
 * only; the «Доступ на кухню» tab of a store; Telegram for order
 * notifications linked through the bot — from the tablet too; and the
 * password resets and changes around it.
 */

const MALL = { ...STORE, id: 'store-2', name: 'Молл' };

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** A kitchen PIN session on a NoName tablet, of a barista who works at both stores. */
async function signInWithPin(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ({ store, brand }) => {
      localStorage.setItem(
        'takeaway.admin.session',
        JSON.stringify({
          accessToken: 'staff-token',
          refreshToken: 'staff-refresh',
          accessTokenExpiresInSeconds: 900,
          refreshTokenExpiresInSeconds: 86_400,
          user: { id: 'staff-1', name: 'Ion', role: 'STAFF', email: null, phone: null, locale: 'RU' },
          kdsStoreId: store,
          kdsBrandId: brand,
        }),
      );
    },
    { store: STORE.id, brand: BRAND.id },
  );
}

test.describe('the kitchen tablet', () => {
  test('takes the PIN first, asks for the store, and switches stores without the PIN', async ({ context, page }) => {
    await installFakeApi(context);
    await context.route('**/api/auth/kds/device/pair', (route) =>
      json(route, { deviceToken: 'tablet-token', brandId: BRAND.id, brandName: BRAND.name }),
    );
    await context.route('**/api/auth/kds/device', (route) =>
      json(route, {
        brandId: BRAND.id,
        brandName: BRAND.name,
        stores: [
          { id: STORE.id, name: STORE.name, city: STORE.city },
          { id: MALL.id, name: MALL.name, city: MALL.city },
        ],
      }),
    );
    const pins: unknown[] = [];
    await context.route('**/api/auth/kds/pin', async (route) => {
      pins.push(route.request().postDataJSON());
      return json(route, {
        accessToken: 'staff-token',
        refreshToken: 'staff-refresh',
        accessTokenExpiresInSeconds: 900,
        refreshTokenExpiresInSeconds: 86_400,
        user: { id: 'staff-1', name: 'Ion', role: 'STAFF', email: null, phone: null, locale: 'RU' },
        kdsBrandId: BRAND.id,
        kdsStoreId: STORE.id,
        kdsStores: [
          { id: MALL.id, name: MALL.name, city: MALL.city },
          { id: STORE.id, name: STORE.name, city: STORE.city },
        ],
      });
    });
    // The PIN session sees exactly the barista's stores of the brand.
    await context.route(
      (url) => url.pathname === '/api/admin/stores',
      (route) => json(route, [STORE, MALL]),
    );
    const boards: string[] = [];
    await context.route('**/api/kds/orders**', (route) => {
      boards.push(new URL(route.request().url()).searchParams.get('storeId') ?? '');
      return json(route, []);
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login/pin?pair=one-time-code');
    await expect(page.getByTestId('pin-brand')).toHaveText(BRAND.name);
    // No store to pick before the PIN.
    await expect(page.locator('select')).toHaveCount(0);

    for (const digit of '258047') await page.getByRole('button', { name: digit, exact: true }).click();
    await page.getByTestId('pin-submit').click();
    expect(pins).toEqual([{ pin: '258047', deviceToken: 'tablet-token' }]);

    const choose = page.getByTestId('pin-choose');
    await expect(choose.getByRole('heading', { name: 'Где вы сегодня работаете?' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('pin-choose-store.png') });
    await choose.getByRole('button', { name: /Молл/ }).click();

    await expect(page).toHaveURL(/\/kitchen\?store=store-2$/);
    await expect.poll(() => boards).toContain('store-2');

    // The board offers the other store, and opens it without the PIN again.
    const picker = page.locator('select.kitchen-select');
    await expect(picker.locator('option')).toHaveCount(2);
    await picker.selectOption(STORE.id);
    await expect.poll(() => boards).toContain(STORE.id);
    expect(pins).toHaveLength(1);
  });

  test('sends an old PIN two people share again with the store it was set for', async ({ context, page }) => {
    await installFakeApi(context);
    await context.addInitScript(() => localStorage.setItem('takeaway.admin.kitchenDevice', 'tablet-token'));
    await context.route('**/api/auth/kds/device', (route) =>
      json(route, {
        brandId: BRAND.id,
        brandName: BRAND.name,
        stores: [
          { id: STORE.id, name: STORE.name, city: STORE.city },
          { id: MALL.id, name: MALL.name, city: MALL.city },
        ],
      }),
    );
    const pins: Array<Record<string, unknown>> = [];
    await context.route('**/api/auth/kds/pin', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      pins.push(body);
      if (!body['storeId']) {
        return json(route, { statusCode: 409, code: 'KDS_PIN_STORE_REQUIRED', message: 'Pick the store' }, 409);
      }
      return json(route, {
        accessToken: 'staff-token',
        refreshToken: 'staff-refresh',
        accessTokenExpiresInSeconds: 900,
        refreshTokenExpiresInSeconds: 86_400,
        user: { id: 'staff-1', name: 'Ion', role: 'STAFF', email: null, phone: null, locale: 'RU' },
        kdsBrandId: BRAND.id,
        kdsStoreId: MALL.id,
        kdsStores: [{ id: MALL.id, name: MALL.name, city: MALL.city }],
      });
    });
    await context.route('**/api/kds/orders**', (route) => json(route, []));

    await page.goto('/login/pin');
    for (const digit of '4821') await page.getByRole('button', { name: digit, exact: true }).click();
    await page.getByTestId('pin-submit').click();

    await expect(page.getByTestId('pin-store-required')).toBeVisible();
    await expect(page.getByTestId('pin-submit')).toBeDisabled();
    await page.locator('select').selectOption(MALL.id);
    await page.getByTestId('pin-submit').click();

    await expect(page).toHaveURL(/\/kitchen\?store=store-2$/);
    expect(pins).toEqual([
      { pin: '4821', deviceToken: 'tablet-token' },
      { pin: '4821', deviceToken: 'tablet-token', storeId: MALL.id },
    ]);
  });

  test('a PIN session links Telegram from the tablet with a QR code, and unlinks it', async ({ context, page }) => {
    await signInWithPin(context);
    await installFakeApi(context);
    let linked = false;
    const calls: string[] = [];
    await context.route('**/api/auth/telegram/notify-link', (route) => {
      const method = route.request().method();
      calls.push(method);
      if (method === 'POST') {
        return json(route, {
          url: 'https://t.me/takaway_tgbot?start=link_AbCdEfGhIjKlMnOpQrStUv',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
      if (method === 'DELETE') linked = false;
      return json(route, { linked, botLinkAvailable: true });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/telegram-link');
    const sidebar = page.locator('app-admin-sidebar');
    await expect(sidebar.locator('a.admin-nav')).toHaveText([/Кухня/, /Стоп-лист/, /Telegram/]);
    // A shared tablet does not write to support, and has no password to change.
    await expect(sidebar.getByRole('button', { name: /поддержку/ })).toHaveCount(0);
    await expect(page.getByTestId('change-password-link')).toHaveCount(0);

    await page.getByTestId('tg-make-link').click();
    const pending = page.getByTestId('tg-pending');
    await expect(pending.locator('svg path')).toHaveAttribute('d', /^M\d+ \d+h1v1h-1z/);
    await expect(page.getByTestId('tg-open')).toHaveAttribute('href', /start=link_/);
    await page.screenshot({ path: test.info().outputPath('telegram-qr.png') });

    // The employee taps «Старт» on their phone; the page notices.
    linked = true;
    await expect(page.getByTestId('tg-linked')).toBeVisible({ timeout: 10_000 });

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('tg-unlink').click();
    await expect(page.getByTestId('tg-not-linked')).toBeVisible();
    expect(calls).toContain('DELETE');
  });
});

test.describe('the staff pages', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context);
    await installFakeApi(context);
  });

  test('sets one PIN for all the person’s stores on their card', async ({ context, page }) => {
    const puts: Array<{ url: string; body: unknown }> = [];
    await context.route('**/api/admin/staff/*/kds-pin**', async (route) => {
      puts.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
      return json(route, { ...STAFF_MEMBER, hasKdsPin: true, kdsPinStoreId: null });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/staff');
    await page.getByRole('link', { name: /Ion/ }).click();
    await expect(page).toHaveURL(/\/staff\/user-2$/);

    const pins = page.getByRole('region', { name: 'PIN для кухни' });
    await expect(pins.getByText('PIN не задан')).toBeVisible();
    // No store to choose: the PIN is the person's, not a store's.
    await expect(pins.getByRole('combobox')).toHaveCount(0);
    const pinInput = pins.getByRole('textbox', { name: 'PIN' });
    const setPin = pins.getByRole('button', { name: 'Задать PIN' });

    await pinInput.fill('4321');
    await expect(pins.getByText('Новый PIN — ровно 6 цифр.')).toBeVisible();
    await expect(setPin).toBeDisabled();
    await pinInput.fill('123456');
    await expect(pins.getByText(/Слишком простой PIN/)).toBeVisible();
    await expect(setPin).toBeDisabled();

    await pinInput.fill('402917');
    await setPin.click();

    await expect.poll(() => puts).toEqual([{ url: '/api/admin/staff/user-2/kds-pin', body: { pin: '402917' } }]);
    await expect(pins.getByText('PIN открывает планшет кухни во всех точках сотрудника.')).toBeVisible();
    await expect(pins.getByRole('button', { name: 'Сменить PIN' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('staff-member-pin.png'), fullPage: true });
  });

  test('invites kitchen staff with a name and a PIN only', async ({ context, page }) => {
    const invites: unknown[] = [];
    await context.route(
      (url) => url.pathname === '/api/admin/staff',
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        invites.push(route.request().postDataJSON());
        return json(
          route,
          {
            ...STAFF_MEMBER,
            userId: 'user-9',
            email: null,
            login: null,
            name: 'Ира',
            hasKdsPin: true,
            inviteEmail: 'NO_EMAIL',
            accountCreated: true,
          },
          201,
        );
      },
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/staff/add');
    await page.getByTestId('sign-in-pin-only').check();
    await expect(page.locator('#staff-identifier')).toHaveCount(0);
    await expect(page.locator('#staff-temp-password')).toHaveCount(0);
    await page.locator('#staff-name').fill('Ира');
    await page.getByTestId('invite-pin-input').fill('480317');
    await page.screenshot({ path: test.info().outputPath('invite-pin-only.png'), fullPage: true });
    await page.getByRole('button', { name: 'Пригласить' }).click();

    await expect(page.getByTestId('invite-pin-only')).toBeVisible();
    expect(invites).toEqual([{ role: 'STAFF', name: 'Ира', pin: '480317', storeIds: [STORE.id] }]);
  });

  test('the store’s «Доступ на кухню» lists who can enter, links to their cards, and makes a tablet link', async ({
    context,
    page,
  }) => {
    await context.route(`**/api/admin/stores/${STORE.id}/staff`, (route) =>
      json(route, [
        {
          userId: 'user-2',
          email: 'ion@takeaway.md',
          login: null,
          name: 'Ion',
          role: 'STAFF',
          blocked: false,
          addedAt: '2026-01-01T00:00:00.000Z',
          hasKdsPin: true,
        },
        {
          userId: 'user-3',
          email: null,
          login: 'ana',
          name: 'Ana',
          role: 'STAFF',
          blocked: false,
          addedAt: '2026-01-01T00:00:00.000Z',
          hasKdsPin: false,
        },
      ]),
    );
    await context.route('**/api/admin/kitchen-devices/pairing-code**', (route) =>
      json(route, { code: 'one-time-code-0123456789', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/stores/${STORE.id}`);
    await page.getByRole('tab', { name: 'Доступ на кухню' }).click();

    const list = page.getByTestId('kitchen-access-list');
    await expect(list.getByRole('link', { name: 'Ion' })).toHaveAttribute('href', '/staff/user-2');
    await expect(page.getByText('Входят по PIN: 1')).toBeVisible();
    await page.getByTestId('tablet-link').click();
    await expect(page.getByTestId('tablet-link-box')).toContainText('/login/pin?pair=one-time-code-0123456789');
    await page.screenshot({ path: test.info().outputPath('store-kitchen-access.png'), fullPage: true });
  });

  test('the platform team resets the brand owner’s password, shown once', async ({ context, page }) => {
    await context.route(`**/api/admin/brands/${BRAND.id}/owner`, (route) =>
      json(route, { id: 'owner-1', email: 'boss@noname.md', name: 'Иван' }),
    );
    const resets: string[] = [];
    await context.route(`**/api/admin/brands/${BRAND.id}/owner/reset-password`, (route) => {
      resets.push(route.request().method());
      return json(route, { tempPassword: 'Kx7mPq2wRt9z', resetEmail: 'NOT_CONFIGURED' });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/staff/owner');
    const current = page.getByTestId('owner-current');
    await expect(current).toContainText('boss@noname.md');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('owner-reset-password').click();

    await expect(page.getByTestId('owner-temp-password')).toHaveText('Kx7mPq2wRt9z');
    expect(resets).toEqual(['POST']);
  });

  test('changes one’s own password from the top bar, with a way back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/staff');
    await page.getByTestId('change-password-link').click();
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole('heading', { name: 'Сменить пароль' })).toBeVisible();
    await page.getByTestId('change-password-back').click();
    await expect(page).not.toHaveURL(/change-password/);
  });
});
