import { expect, test } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * The old add-ons library — since 2026-11-09 the «Старые добавки» tab of
 * «Добавки», there while the brand still has entries (the options catalog
 * is the first tab, see options-catalog.spec.ts): each add-on with its
 * usual price and the products it is in. Oat milk marked as run out in one
 * place hides every product's oat-milk option for customers.
 *
 * The platform team adds, renames and deletes add-ins; since 2026-11-06 a
 * brand's menu roles open the page too, to switch add-ins on and off and set
 * their prices — nothing else.
 */

test.describe('the platform team', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context);
    await installFakeApi(context);
  });

  test('marks an add-in as run out from the sidebar', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('link', { name: 'Добавки' }).click();

    await expect(page).toHaveURL(/\/ingredients$/);
    await expect(page.getByRole('heading', { name: 'Добавки', level: 1 })).toBeVisible();
    await page.getByRole('tab', { name: /Старые добавки/ }).click();
    const row = page.getByTestId('ingredient-row').filter({ hasText: 'Овсяное молоко' });
    await expect(row.getByTestId('ingredient-price')).toHaveText('+5 MDL');
    await expect(row.getByTestId('ingredient-usage')).toHaveText('В товарах (1): Flat White');

    const saved = page.waitForRequest(
      (req) => req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith('/admin/ingredients/ing-oat'),
    );
    await row.getByRole('switch', { name: 'Овсяное молоко' }).click();

    expect((await saved).postDataJSON()).toEqual({ isAvailable: false });
    await expect(row.getByRole('switch')).toHaveText(/Нет в наличии/);
    await expect(page.getByRole('button', { name: /Нет в наличии · 1/ })).toBeVisible();
  });

  test('can add and delete add-ins', async ({ page }) => {
    await page.goto('/ingredients?tab=legacy');
    await expect(page.getByTestId('ingredient-add')).toBeVisible();
    await expect(page.getByTestId('ingredient-delete')).toBeVisible();
  });
});

test.describe('a brand', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'BRAND_ADMIN');
    await installFakeApi(context, 'BRAND_ADMIN');
  });

  test('switches an add-in off and changes its price, but cannot add, rename or delete one', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('link', { name: 'Добавки' }).click();
    await expect(page).toHaveURL(/\/ingredients$/);
    await page.getByRole('tab', { name: /Старые добавки/ }).click();

    await expect(page.getByTestId('ingredients-hint')).toContainText('команды takeAway');
    await expect(page.getByTestId('ingredient-add')).toHaveCount(0);
    const row = page.getByTestId('ingredient-row').filter({ hasText: 'Овсяное молоко' });
    await expect(row.getByTestId('ingredient-delete')).toHaveCount(0);

    const switched = page.waitForRequest(
      (req) => req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith('/admin/ingredients/ing-oat'),
    );
    await row.getByRole('switch', { name: 'Овсяное молоко' }).click();
    expect((await switched).postDataJSON()).toEqual({ isAvailable: false });

    await row.getByRole('button', { name: 'Изменить цену' }).click();
    const edit = row.getByTestId('ingredient-edit');
    await expect(edit.locator('input[formcontrolname="name"]')).toHaveCount(0);
    await expect(edit.locator('input[formcontrolname="group"]')).toHaveCount(0);
    const priced = page.waitForRequest(
      (req) => req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith('/admin/ingredients/ing-oat'),
    );
    await edit.locator('input[formcontrolname="price"]').fill('6');
    await edit.getByRole('button', { name: 'Сохранить' }).click();
    expect((await priced).postDataJSON()).toEqual({ priceCents: 600 });
  });
});
