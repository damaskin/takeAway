import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * One inactivity threshold everywhere (Maxim's list of 2026-11-18, item 5):
 * the dashboard card «Неактивные клиенты», «Аналитика → Возврат клиентов»
 * and «Клиенты → Неактивные» offer the same picker — 7 / 14 / 30 / 90 days
 * or a custom number — carry the choice to each other in their links, and
 * with the same days show the same people. The fake API answers all three
 * from one list of regulars, as the real one answers them from one query.
 */
test.beforeEach(async ({ context }) => {
  await signIn(context);
  await installFakeApi(context);
});

test('the dashboard card picks the threshold and opens the same people in «Клиенты»', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const asked: string[] = [];
  page.on('request', (r) => r.url().includes('/admin/analytics/inactive') && asked.push(r.url()));

  await page.goto('/dashboard');
  const card = page.locator('app-churn-widget');
  await expect(card.getByRole('heading', { name: 'Неактивные клиенты' })).toBeVisible();
  const picker = card.getByRole('group', { name: 'Не заказывали' });
  await expect(picker.getByRole('button')).toHaveText(['7 дн.', '14 дн.', '30 дн.', '90 дн.', 'Свой…']);
  // 14 days by default: five regulars right now, 90 MDL missed.
  await expect(picker.getByRole('button', { name: '14 дн.' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByTestId('churn-count')).toHaveText('5');
  await expect(card.locator('.churn-money')).toContainText('90 MDL');
  await expect(card).toContainText('сейчас неактивны');

  await picker.getByRole('button', { name: '30 дн.' }).click();
  await expect(card.getByTestId('churn-count')).toHaveText('3');
  await expect(card.locator('.dash-muted').first()).toContainText('последние 30 дн.');
  await expect.poll(() => asked.at(-1) ?? '').toContain('inactiveDays=30');
  await page.screenshot({ path: test.info().outputPath('inactive-card.png') });

  await card.getByRole('link', { name: 'Все неактивные →' }).click();
  await expect(page).toHaveURL(/\/customers\?/);
  expect(new URL(page.url()).searchParams.get('inactiveDays')).toBe('30');
  expect(new URL(page.url()).searchParams.get('segment')).toBe('inactive');
  await expect(
    page.getByRole('group', { name: 'Не заказывали' }).getByRole('button', { name: '30 дн.' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // The same three people as the card counted.
  await expect(page.locator('.cu-table a.cu-name')).toHaveText(['Анна', 'Борис', 'Вера']);
});

test('«Возврат клиентов» keeps the card’s threshold and picks its own, a custom one too', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  const card = page.locator('app-churn-widget');
  await card.getByRole('group', { name: 'Не заказывали' }).getByRole('button', { name: '90 дн.' }).click();
  await expect(card.getByTestId('churn-count')).toHaveText('1');

  await card.getByRole('link', { name: 'Возврат клиентов' }).click();
  await expect(page).toHaveURL(/\/analytics\?/);
  expect(new URL(page.url()).searchParams.get('tab')).toBe('retention');
  expect(new URL(page.url()).searchParams.get('inactiveDays')).toBe('90');

  const definition = page.locator('.rt-definition');
  const picker = definition.getByRole('group', { name: 'Не заказывали' });
  // The lower picker is back, next to the definition, on the card's 90 days.
  await expect(picker.getByRole('button', { name: '90 дн.' })).toHaveAttribute('aria-pressed', 'true');
  await expect(definition).toContainText('последние 90 дн.');
  await expect(page.locator('.rt-now')).toContainText('Сейчас неактивны: 1');

  // «Свой…»: 45 days.
  await picker.getByRole('button', { name: 'Свой…' }).click();
  const field = picker.getByRole('spinbutton', { name: 'Дней без заказа, от 1 до 365' });
  await field.fill('45');
  await field.press('Enter');
  await expect(picker.getByRole('button', { name: '45 дн.' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.rt-now')).toContainText('Сейчас неактивны: 2');
  await expect.poll(() => new URL(page.url()).searchParams.get('inactiveDays')).toBe('45');
  await page.screenshot({ path: test.info().outputPath('inactive-retention.png') });

  await page.getByRole('link', { name: 'Все неактивные клиенты →' }).click();
  await expect(page).toHaveURL(/\/customers\?/);
  expect(new URL(page.url()).searchParams.get('inactiveDays')).toBe('45');
  await expect(
    page.getByRole('group', { name: 'Не заказывали' }).getByRole('button', { name: '45 дн.' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cu-table a.cu-name')).toHaveText(['Анна', 'Борис']);
});

test('older links with `window=` and `days=` still open on their threshold', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/analytics?tab=retention&window=3');
  const definition = page.locator('.rt-definition');
  await expect(definition.getByRole('button', { name: '3 дн.' })).toHaveAttribute('aria-pressed', 'true');
  await expect(definition).toContainText('последние 3 дн.');

  await page.goto('/customers?segment=inactive&days=7');
  await expect(
    page.getByRole('group', { name: 'Не заказывали' }).getByRole('button', { name: '7 дн.' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cu-table a.cu-name')).toHaveCount(7);
});

test('on a phone the card’s picker wraps inside the card', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/dashboard');
  const card = page.locator('app-churn-widget');
  await expect(card.getByTestId('churn-count')).toHaveText('5');
  const overflow = await page.locator('main.admin-main').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const cardBox = await card.boundingBox();
  const customBox = await card.getByRole('button', { name: 'Свой…' }).boundingBox();
  expect((customBox?.x ?? 0) + (customBox?.width ?? 0)).toBeLessThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0));
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: test.info().outputPath('inactive-card-phone.png') });
});
