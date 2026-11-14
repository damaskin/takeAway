import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * «Расчёты» since 2026-11-14 (docs/settlements.md): guests pay the brand
 * directly, the brand owes takeAway its commission, takeAway owes the brand
 * compensation for its promos and points, and a period closes with one
 * netted settlement. The platform admin fixes it, the payer marks it paid,
 * the receiver confirms «Получено» or answers «Не получено».
 *
 * The fake week: commission 22,50 − compensation 10 (promos) − 20 (points)
 * = takeAway owes the brand 7,50. An earlier settlement — takeAway paid the
 * brand 12,00 for 26.10–01.11 — waits for the brand's confirmation.
 */
test.describe('settlements', () => {
  test('the platform admin fixes a settlement and marks what takeAway paid', async ({ context, page }) => {
    await signIn(context);
    await installFakeApi(context);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/settlements');
    await expect(page.getByRole('heading', { name: 'Расчёты с брендами' })).toBeVisible();

    // Maxim's three figures and the result.
    await expect(page.getByTestId('figure-card')).toContainText('Всего оплачено картами');
    await expect(page.getByTestId('figure-card')).toContainText('120');
    await expect(page.getByTestId('figure-compensation')).toContainText('30');
    await expect(page.getByTestId('figure-compensation-promo')).toContainText('по акциям');
    await expect(page.getByTestId('figure-compensation-promo')).toContainText('10');
    await expect(page.getByTestId('figure-compensation-points')).toContainText('по баллам');
    await expect(page.getByTestId('figure-compensation-points')).toContainText('20');
    await expect(page.getByTestId('figure-commission')).toContainText('22,50');
    await expect(page.getByTestId('figure-commission')).toContainText('с полной цены заказа');
    await expect(page.getByTestId('figure-net')).toContainText('takeAway должен бренду 7,50');

    // takeAway paid the earlier one: it waits on the brand, not on the platform.
    await expect(page.getByTestId('settlement-waiting')).toHaveCount(0);
    const rows = page.getByTestId('settlement-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Оплачено — ждёт подтверждения');

    const card = page.getByTestId('settlement-payout');
    await expect(card.getByTestId('payout-summary')).toHaveText('takeAway платит бренду 7,50 руб.');
    await expect(card.getByTestId('payout-breakdown')).toContainText(
      'комиссия 22,50 руб. − компенсация по акциям 10 руб. − компенсация по баллам 20 руб. = −7,50 руб.',
    );
    await page.screenshot({ path: test.info().outputPath('settlements-platform.png'), fullPage: true });

    await card.getByRole('textbox', { name: 'Номер платёжки' }).fill('ПП-42');
    const created = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/admin/settlements/payouts',
    );
    await card.getByRole('button', { name: 'Зафиксировать взаиморасчёт' }).click();
    expect((await created).postDataJSON()).toMatchObject({ currency: 'RUP', reference: 'ПП-42' });

    // The new one is takeAway's to pay; the card now says the days are closed.
    await expect(rows).toHaveCount(2);
    const fresh = rows.first();
    await expect(fresh).toContainText('takeAway → бренду');
    await expect(fresh).toContainText('7,50');
    await expect(fresh).toContainText('Ждёт оплаты');
    await expect(fresh).toContainText('ПП-42');
    await expect(page.getByTestId('settlement-waiting')).toContainText('Ждёт вашей оплаты: перечислите бренду 7,50');
    await expect(card.getByTestId('payout-blocked')).toContainText('уже закрыты взаиморасчётом');

    await fresh.getByRole('button', { name: 'Отметить оплату' }).click();
    await fresh.getByRole('textbox', { name: 'Номер платёжки' }).fill('ПП-43');
    await fresh.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(fresh).toContainText('Оплачено — ждёт подтверждения');
    await expect(fresh).toContainText('ПП-43');
    await expect(page.getByTestId('settlement-waiting')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('settlements-platform-paid.png'), fullPage: true });
  });

  test('the brand says the money did not arrive, then confirms it', async ({ context, page }) => {
    await signIn(context, 'BRAND_ADMIN');
    await installFakeApi(context, 'BRAND_ADMIN');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/settlements');
    await expect(page.getByRole('heading', { name: 'Расчёты', exact: true })).toBeVisible();

    await expect(page.getByTestId('settlement-waiting')).toContainText(
      'Ждёт вашего подтверждения: takeAway перечислил 12 руб. за 26 окт. – 1 нояб.',
    );
    await expect(page.getByTestId('figure-net')).toContainText('takeAway должен вам 7,50');
    await expect(page.getByTestId('balance-opening')).toContainText('takeAway должен вам 12');
    // takeAway fixes settlements: the owner sees the same one read-only.
    await expect(page.getByTestId('payout-summary')).toHaveText('takeAway платит вам 7,50 руб.');
    await expect(page.getByTestId('payout-owner-hint')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Зафиксировать взаиморасчёт' })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('settlements-brand.png'), fullPage: true });

    const row = page.getByTestId('settlement-row').first();
    await expect(row).toContainText('takeAway → бренду');
    await expect(row).toContainText('Оплачено — ждёт подтверждения');

    await row.getByRole('button', { name: 'Не получено' }).click();
    await row.getByRole('textbox').fill('на счёт не пришло');
    await row.getByRole('button', { name: 'Отправить' }).click();
    await expect(row.getByTestId('settlement-status')).toHaveText('Не получено');
    await expect(row.getByTestId('settlement-dispute')).toHaveText('“на счёт не пришло”');
    await expect(page.getByTestId('settlement-waiting')).toHaveCount(0);

    // It arrived after all: «Получено» is final, so it asks once.
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Получено' }).click();
    await expect(row.getByTestId('settlement-status')).toHaveText(/^Получено \d{2}\.\d{2}$/);
    await expect(row.getByRole('button')).toHaveCount(0);
    // A confirmed settlement closes the brand's balance.
    await expect(page.getByTestId('balance-opening')).toContainText('В расчёте');
    await page.screenshot({ path: test.info().outputPath('settlements-brand-confirmed.png'), fullPage: true });
  });
});
