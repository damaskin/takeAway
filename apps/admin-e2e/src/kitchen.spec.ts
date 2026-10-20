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

test.describe('kitchen policy on the board', () => {
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  const line = (name: string) => [{ quantity: 1, productSnapshot: { name } }];
  const row = (patch: Record<string, unknown>) => ({
    pickupMode: 'ASAP',
    createdAt: at(-10),
    customerName: null,
    notes: null,
    awaitingSince: at(-5),
    acceptAlertAt: null,
    acceptDeadlineAt: null,
    ...patch,
  });

  const BOARD = [
    // Nobody accepted it for 5 minutes: it pulses, and is called off in 3.
    row({
      id: 'o-wait',
      orderCode: 'W31',
      status: 'PAID',
      pickupAt: at(5),
      startBy: at(0),
      acceptAlertAt: at(-2),
      acceptDeadlineAt: at(3),
      items: line('Капучино'),
    }),
    // Accepted and seven minutes past its time.
    row({
      id: 'o-late',
      orderCode: 'L07',
      status: 'ACCEPTED',
      pickupAt: at(-7.5),
      startBy: at(-12),
      items: line('Латте'),
    }),
    // A pre-order for tomorrow morning: waits in «Предзаказы», counted down in hours.
    row({
      id: 'o-pre',
      orderCode: 'P15',
      status: 'PAID',
      pickupMode: 'SCHEDULED',
      pickupAt: at(12 * 60),
      startBy: at(12 * 60 - 5),
      acceptAlertAt: at(12 * 60 - 10),
      acceptDeadlineAt: at(12 * 60 - 10),
      items: line('Флэт уайт'),
    }),
  ];

  const SHIFT = {
    storeId: STORE.id,
    open: true,
    openedAt: at(-300),
    openedByName: null,
    closedAt: null,
    closedByName: null,
    busy: false,
    extendedUntil: null,
    closesAt: at(10),
    opensAt: null,
    asapOpen: true,
    asapBlockedReason: null,
    closedAutomatically: false,
    // Since 2026-10-20 the working hours open the shift; the kitchen only extends and pauses.
    openedAutomatically: true,
    canExtend: true,
    pausedUntil: null,
    pauseReason: null,
    pauseComment: null,
    pausedByName: null,
  };

  test('groups pre-orders, flags overdue and late tickets, follows the schedule, extends and pauses', async ({
    context,
    page,
  }) => {
    await signIn(context);
    await installFakeApi(context);
    const extended: unknown[] = [];
    const paused: Array<{ method: string; body: unknown }> = [];
    await context.route('**/api/kds/orders**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOARD) }),
    );
    await context.route('**/api/kds/shift**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/extend')) {
        extended.push(route.request().postDataJSON());
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...SHIFT, closesAt: at(10), extendedUntil: at(40) }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHIFT) });
    });
    await context.route('**/api/kds/pause**', async (route) => {
      const method = route.request().method();
      paused.push({ method, body: method === 'PUT' ? route.request().postDataJSON() : null });
      const body =
        method === 'PUT'
          ? {
              ...SHIFT,
              pausedUntil: at(30),
              pauseReason: 'EQUIPMENT',
              pauseComment: 'кофемашина',
              pausedByName: 'Анна',
              asapOpen: false,
              asapBlockedReason: 'PAUSED',
            }
          : SHIFT;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/kitchen');

    const preorders = page.getByRole('region', { name: 'Предзаказы' });
    await expect(preorders.getByText('P15')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Новые' }).getByText('P15')).toHaveCount(0);

    // Not accepted yet: the acceptance pill is the card's only countdown.
    const waiting = page.getByTestId('ticket-W31');
    await expect(waiting.getByTestId('ticket-overdue')).toContainText('Ждёт принятия 5 мин');
    await expect(waiting.getByTestId('ticket-overdue')).toContainText('автоотмена через');
    await expect(waiting.getByTestId('ticket-due')).toHaveCount(0);
    await expect(preorders.getByTestId('ticket-P15').getByTestId('ticket-awaiting')).toHaveText('Ждёт принятия');
    // Accepted: the pickup countdown is back.
    await expect(page.getByTestId('ticket-L07').getByTestId('ticket-late')).toHaveText('Опаздываем 7 мин');
    await expect(page.getByTestId('ticket-L07').getByTestId('ticket-due')).toBeVisible();

    // No «Начать / Закончить работу»: the schedule runs the shift.
    await expect(page.getByTestId('schedule-status')).toContainText('Работаем по графику до');
    await expect(page.getByRole('button', { name: 'Закончить работу' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Начать работу' })).toHaveCount(0);

    const banner = page.getByTestId('shift-banner-closingSoon');
    await expect(banner).toContainText('по графику конец работы');
    await page.screenshot({ path: test.info().outputPath('kitchen-policy.png'), fullPage: true });

    await banner.getByTestId('shift-extend-30').click();
    await expect.poll(() => extended).toEqual([{ minutes: 30 }]);
    await expect(page.getByTestId('schedule-status')).toContainText('Продлено до');

    // «Пауза»: the coffee machine broke.
    await page.getByTestId('kitchen-pause').click();
    const dialog = page.getByRole('dialog', { name: 'Поставить точку на паузу?' });
    const confirm = dialog.getByRole('button', { name: 'Поставить на паузу' });
    await expect(confirm).toBeDisabled();
    await dialog.getByText('Сломалось оборудование').click();
    await dialog.getByText('30 мин').click();
    await dialog.getByTestId('pause-comment').fill('кофемашина');
    await page.screenshot({ path: test.info().outputPath('kitchen-pause-dialog.png'), fullPage: true });
    await confirm.click();
    await expect
      .poll(() => paused)
      .toEqual([{ method: 'PUT', body: { minutes: 30, reason: 'EQUIPMENT', comment: 'кофемашина' } }]);
    const pause = page.getByTestId('schedule-pause');
    await expect(pause).toContainText('Пауза до');
    await expect(pause).toContainText('Сломалось оборудование — кофемашина (Анна)');
    await page.screenshot({ path: test.info().outputPath('kitchen-paused.png'), fullPage: true });

    await pause.getByTestId('pause-resume').click();
    await expect.poll(() => paused.map((p) => p.method)).toEqual(['PUT', 'DELETE']);
    await expect(page.getByTestId('schedule-pause')).toHaveCount(0);
  });
});

test.describe('stores follow their schedule', () => {
  test('the «Точки» card says when the store opens, with no «Начать работу»', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    const tomorrowMorning = new Date(Date.now() + 24 * 60 * 60_000);
    await context.route('**/api/kds/shift**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          storeId: STORE.id,
          open: false,
          openedAt: null,
          openedByName: null,
          closedAt: null,
          closedByName: null,
          busy: false,
          extendedUntil: null,
          closesAt: null,
          opensAt: tomorrowMorning.toISOString(),
          asapOpen: false,
          asapBlockedReason: 'OUTSIDE_HOURS',
          closedAutomatically: true,
          openedAutomatically: true,
          canExtend: false,
          pausedUntil: null,
          pauseReason: null,
          pauseComment: null,
          pausedByName: null,
        }),
      }),
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/stores');

    const line = page.getByTestId(`store-schedule-${STORE.id}`);
    await expect(line).toContainText('По графику закрыто · откроется');
    await expect(line).toContainText('предзаказы приходят');
    await expect(page.getByRole('button', { name: 'Начать работу' })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('stores-schedule.png'), fullPage: true });
  });
});
