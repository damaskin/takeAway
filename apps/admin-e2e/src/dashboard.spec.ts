import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * A business's home: KPIs against the period before, stores side by side,
 * statuses, load by hour and weekday, and a stores table that sorts and
 * narrows the whole page to one store.
 */
test.beforeEach(async ({ context }) => {
  await signIn(context);
  await installFakeApi(context);
});

test('the dashboard shows its blocks and the stores table sorts and filters', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests: string[] = [];
  page.on('request', (r) => r.url().includes('/admin/analytics/overview') && requests.push(r.url()));

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Главная', level: 1 })).toBeVisible();
  await expect(page.getByText('сравнение с предыдущими 7 днями')).toBeVisible();
  await expect(page.locator('app-kpi-card')).toHaveCount(9);
  await expect(page.getByRole('heading', { name: 'Выручка по точкам' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Статусы заказов' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Загрузка по часам' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'По дням недели' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сейчас в работе' })).toBeVisible();

  const table = page.locator('.ov-table');
  const names = table.locator('tbody tr .ov-name');
  // Highest revenue first.
  await expect(names).toHaveText(['Центр', 'Молл', 'Аэропорт']);
  await expect(table.locator('th[aria-sort="descending"]')).toHaveText(/Выручка/);

  await table.getByRole('button', { name: 'Заказы', exact: true }).click();
  await expect(names).toHaveText(['Молл', 'Центр', 'Аэропорт']);
  await table.getByRole('button', { name: /^Заказы/ }).click();
  await expect(names).toHaveText(['Аэропорт', 'Центр', 'Молл']);
  // Center +5, Airport +4, Mall −1 against the week before.
  await table.getByRole('button', { name: 'Δ заказов' }).click();
  await expect(names).toHaveText(['Центр', 'Аэропорт', 'Молл']);

  // A hover card on a KPI chart.
  const bars = page.locator('app-kpi-card app-mini-bars').first();
  await bars.hover({ position: { x: 4, y: 20 } });
  await bars.hover({ position: { x: 150, y: 20 } });
  await expect(page.locator('.chart-tip.is-on')).toContainText('Выручка');
  await page.screenshot({ path: test.info().outputPath('dashboard.png'), fullPage: true });

  // A row narrows the page to that store.
  await table.locator('tbody tr').filter({ hasText: 'Молл' }).click();
  await expect(page.locator('.ov-chip')).toContainText('Молл');
  await expect.poll(() => requests.at(-1) ?? '').toContain('storeId=store-2');
  await page.locator('.ov-chip button').click();
  await expect(page.locator('.ov-chip')).toHaveCount(0);
});

test('on a phone the KPI cards stack and the table scrolls sideways inside its card', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/dashboard');
  await expect(page.locator('app-kpi-card')).toHaveCount(9);
  const first = await page.locator('.ov-kpis app-kpi-card').nth(0).boundingBox();
  const second = await page.locator('.ov-kpis app-kpi-card').nth(1).boundingBox();
  expect(second?.y).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0) - 1);
  // Nothing pushes the page wider than the phone.
  const overflow = await page.locator('main.admin-main').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('dashboard-phone.png'), fullPage: true });
});
