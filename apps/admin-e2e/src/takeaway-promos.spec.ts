import { expect, test } from '@playwright/test';

import { STORE, TAKEAWAY_PROMO_ORDER, installFakeApi, signIn } from './support/fake-api';

/**
 * «Акции takeAway» (Maxim's list 5.0, item 20; docs/takeaway-promos.md):
 * the platform admin runs percent promos takeAway pays for, the brand sees
 * what takeAway owes it in «Расчёты», and staff see on the order that the
 * guest owes nothing more.
 */
test.describe('takeAway promos', () => {
  test('the platform admin creates a promo and sees it in the list', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/platform');
    await page.getByRole('link', { name: 'Акции takeAway' }).click();
    await expect(page).toHaveURL(/\/takeaway-promos$/);
    await expect(page.getByRole('heading', { name: 'Акции takeAway' })).toBeVisible();

    const rows = page.getByTestId('takeaway-promo-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('AUTUMN15');
    await expect(rows.first()).toContainText('Бюджет исчерпан');
    await expect(rows.first().getByRole('button', { name: 'Включить' })).toBeDisabled();

    await page.getByTestId('takeaway-promo-new').click();
    await expect(page).toHaveURL(/\/takeaway-promos\/new$/);
    await expect(page.getByRole('heading', { name: 'Новая акция takeAway' })).toBeVisible();
    await page.getByTestId('takeaway-promo-name').fill('Приветственный бонус');
    // A brand promo already has this code: one field for customers, so codes never repeat.
    await page.getByTestId('takeaway-promo-code').fill('noname10');
    await page.getByTestId('takeaway-promo-percent').fill('10');
    await page.getByTestId('takeaway-promo-budget').fill('5000');
    await page.getByTestId('takeaway-promo-welcome').check();
    await page.getByRole('button', { name: 'Создать акцию' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Этот код уже занят — другой акцией takeAway или промокодом бренда. Придумайте другой.',
    );

    await page.getByTestId('takeaway-promo-code').fill('hello10');
    const created = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/admin/takeaway-promos',
    );
    await page.getByRole('button', { name: 'Создать акцию' }).click();
    expect((await created).postDataJSON()).toMatchObject({
      name: 'Приветственный бонус',
      code: 'HELLO10',
      percent: 10,
      currency: 'RUP',
      budgetCents: 500_000,
      isWelcome: true,
    });

    await expect(page).toHaveURL(/\/takeaway-promos$/);
    await expect(rows).toHaveCount(2);
    const fresh = rows.first();
    await expect(fresh).toContainText('Приветственный бонус');
    await expect(fresh).toContainText('Приветственная');
    await expect(fresh).toContainText('HELLO10');
    await expect(fresh).toContainText('−10%');
    await expect(fresh).toContainText('Активна');
    await page.screenshot({ path: test.info().outputPath('takeaway-promos.png'), fullPage: true });

    // Switching off happens in the row.
    await fresh.getByRole('button', { name: 'Выключить' }).click();
    await expect(fresh).toContainText('Выключена');

    // «Долг takeAway»: what takeAway owes the brands, now.
    await page.getByRole('link', { name: 'Долг takeAway' }).click();
    await expect(page).toHaveURL(/\/takeaway-promos\/debt$/);
    await expect(page.getByTestId('takeaway-debt-table')).toContainText('NoName Coffee');
    await expect(page.getByTestId('takeaway-debt-totals')).toContainText('Долг takeAway · RUP');
  });

  test('the brand owner sees the compensation in settlements and the promo orders', async ({ context, page }) => {
    await signIn(context, 'BRAND_ADMIN');
    await installFakeApi(context, 'BRAND_ADMIN');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/settlements');
    await expect(page.getByRole('heading', { name: 'Расчёты', exact: true })).toBeVisible();
    // The platform admin's section is not for a brand.
    await expect(page.getByRole('link', { name: 'Акции takeAway' })).toHaveCount(0);

    // «Компенсация takeAway», split into promos and points (since 2026-11-14).
    await expect(page.getByTestId('figure-compensation')).toContainText('Компенсация takeAway');
    await expect(page.getByTestId('figure-compensation-promo')).toContainText('по акциям');
    await expect(page.getByTestId('figure-compensation-promo')).toContainText('10');
    await expect(page.getByTestId('settlement-days').locator('thead')).toContainText('Компенсация по акциям');
    await page.screenshot({ path: test.info().outputPath('settlements-compensation.png') });

    const block = page.getByTestId('settlement-takeaway-promos');
    await expect(block.getByRole('heading', { name: 'Акции takeAway' })).toBeVisible();
    await expect(block.getByTestId('stp-orders')).toHaveText('1');
    await expect(block.getByTestId('stp-debt')).toContainText('10');
    const row = block.getByRole('row', { name: new RegExp(TAKEAWAY_PROMO_ORDER.orderCode) });
    await expect(row).toContainText('Приветственный −10%');
    await expect(row).toContainText('начислена');
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('settlements-takeaway-promos.png'), fullPage: true });
  });

  test('the order detail says the guest paid and takeAway covers the rest', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    // The orders list with the promo order in it (the fake answers [] otherwise).
    await context.route(/\/api\/admin\/orders(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: TAKEAWAY_PROMO_ORDER.id,
            orderCode: TAKEAWAY_PROMO_ORDER.orderCode,
            status: 'ACCEPTED',
            pickupMode: 'ASAP',
            pickupAt: '2026-11-06T09:15:00.000Z',
            totalCents: 9_000,
            currency: 'MDL',
            storeId: STORE.id,
            storeName: STORE.name,
            storeTimezone: STORE.timezone,
            itemCount: 1,
            createdAt: '2026-11-06T09:00:00.000Z',
            takeawayFundedCents: 1_000,
          },
        ]),
      }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/orders');
    // The business sees the full amount: takeAway compensates the discount and takes commission on all of it.
    await expect(page.getByTestId('order-amount')).toContainText('100 MDL');
    await page.getByRole('cell', { name: TAKEAWAY_PROMO_ORDER.orderCode, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`#${TAKEAWAY_PROMO_ORDER.orderCode}`);
    await expect(dialog.getByTestId('order-takeaway-promo')).toHaveText(
      'Акция takeAway −10%: гость оплатил 90 MDL, ещё 10 MDL компенсирует takeAway',
    );
    await expect(dialog).toContainText('Акция takeAway −10% HELLO10');
    await expect(dialog.getByTestId('order-business-total')).toContainText('100 MDL');
  });
});
