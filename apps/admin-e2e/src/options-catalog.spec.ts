import { expect, test, type Request } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * The options catalog («Добавки и варианты», docs/option-groups.md): the
 * platform team keeps one catalog of groups in «Каталог добавок»; a brand
 * marks in «Добавки» what it has, prices its add-ons and stops them in a
 * store; a product gets catalog groups in its editor, a variant priced on
 * the product.
 */

const pathOf = (req: Request) => new URL(req.url()).pathname;

test.describe('the platform team', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context);
    await installFakeApi(context);
  });

  test('creates a group with a condition and adds its options', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('link', { name: 'Каталог добавок' }).click();
    await expect(page).toHaveURL(/\/option-catalog$/);
    await expect(page.getByRole('heading', { name: 'Каталог добавок', level: 1 })).toBeVisible();
    await expect(page.getByTestId('option-group').filter({ hasText: 'Сиропы' })).toContainText('Ваниль');

    await page.getByTestId('option-group-new').click();
    const form = page.getByTestId('option-group-form');
    await expect(form.getByTestId('group-type-C')).toBeEnabled();
    await form.getByRole('radio', { name: /^Вариант/ }).check();
    // A variant is never a counter.
    await expect(form.getByTestId('group-type-C')).toBeDisabled();
    await form.getByRole('radio', { name: /^Добавка/ }).check();
    await form.getByTestId('group-name').fill('Топинг-соус');
    await form.getByTestId('group-max').fill('1');
    await form.getByTestId('group-show-if').selectOption({ label: 'Холодный' });

    const created = page.waitForRequest((req) => req.method() === 'POST' && pathOf(req) === '/api/admin/option-groups');
    await form.getByTestId('group-submit').click();
    expect((await created).postDataJSON()).toEqual({
      kind: 'ADDON',
      type: 'A',
      name: 'Топинг-соус',
      minSelect: 0,
      maxSelect: 1,
      showIfOptionId: 'opt-cold',
      sortOrder: 6,
    });

    const group = page.getByTestId('option-group').filter({ hasText: 'Топинг-соус' });
    await expect(group.getByTestId('option-group-meta')).toContainText('только если выбрано: Холодный (Подача)');

    // The new group opens its first option's form; it stays open for the next one.
    for (const [i, name] of ['Карамельный', 'Шоколадный'].entries()) {
      const added = page.waitForRequest(
        (req) => req.method() === 'POST' && /\/admin\/option-groups\/[^/]+\/options$/.test(pathOf(req)),
      );
      await group.getByTestId('option-name').fill(name);
      await group.getByTestId('option-submit').click();
      expect((await added).postDataJSON()).toMatchObject({ name, note: null, isDefault: false, sortOrder: i });
      await expect(group.getByTestId('option-row')).toHaveCount(i + 1);
    }
    await expect(group.getByTestId('option-row')).toHaveText([/Карамельный/, /Шоколадный/]);
  });
});

test.describe('a brand', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'BRAND_ADMIN');
    await installFakeApi(context, 'BRAND_ADMIN');
  });

  test('switches an option off, prices an add-on and stops one in a store', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('link', { name: 'Добавки' }).click();
    await expect(page).toHaveURL(/\/ingredients$/);
    await expect(page.getByTestId('brand-option-catalog')).toBeVisible();
    // The old library is still there while the brand has entries in it.
    await expect(page.getByRole('tab', { name: 'Старые добавки · 1' })).toBeVisible();

    const syrups = page.getByTestId('brand-option-group').filter({ hasText: 'Сиропы' });
    await syrups.locator('summary').click();

    const caramel = syrups.getByTestId('brand-option-row').filter({ hasText: 'Карамель' });
    const switched = page.waitForRequest(
      (req) => req.method() === 'PATCH' && pathOf(req).endsWith('/admin/brands/brand-1/options/opt-caramel'),
    );
    await caramel.getByRole('switch', { name: 'Карамель' }).click();
    expect((await switched).postDataJSON()).toEqual({ enabled: false });
    await expect(caramel.getByRole('switch', { name: 'Карамель' })).toHaveText(/Нет у нас/);

    const vanilla = syrups.getByTestId('brand-option-row').filter({ hasText: 'Ваниль' });
    const priced = page.waitForRequest(
      (req) => req.method() === 'PATCH' && pathOf(req).endsWith('/admin/brands/brand-1/options/opt-vanilla'),
    );
    await vanilla.getByTestId('brand-option-price').fill('8');
    await vanilla.getByTestId('brand-option-price').press('Enter');
    expect((await priced).postDataJSON()).toEqual({ priceCents: 800 });

    const stopped = page.waitForRequest(
      (req) => req.method() === 'PUT' && pathOf(req).endsWith('/admin/stores/store-1/option-stops/opt-vanilla'),
    );
    await vanilla.getByTestId('brand-option-stop').click();
    expect((await stopped).postDataJSON()).toEqual({ expiresAt: null });
    await expect(vanilla.getByTestId('brand-option-stop')).toHaveText('test: в стопе');

    await page.getByRole('tab', { name: /Старые добавки/ }).click();
    await expect(page.getByTestId('ingredient-row').filter({ hasText: 'Овсяное молоко' })).toBeVisible();
  });

  test('attaches a size to a product and prices its large one', async ({ page }) => {
    await page.goto('/menu/products/product-1');
    const section = page.getByTestId('product-option-groups');
    await expect(section).toContainText('Группы не подключены.');

    await section.getByTestId('option-group-attach').selectOption({ label: 'Размер (кофе)' });
    await expect(section.getByTestId('product-option-groups-base')).toContainText('25 MDL');
    const group = section.getByTestId('product-option-group').filter({ hasText: 'Размер (кофе)' });
    const large = group.getByTestId('product-option-row').filter({ hasText: '400–450 мл' });
    await large.getByTestId('variant-price').fill('35');
    await large.getByTestId('variant-price').press('Enter');
    await expect(large.getByTestId('variant-delta')).toHaveText('+10 MDL к базовой');

    const saved = page.waitForRequest(
      (req) => req.method() === 'PUT' && pathOf(req).endsWith('/admin/products/product-1/option-groups'),
    );
    await section.getByTestId('product-option-groups-save').click();
    expect((await saved).postDataJSON()).toEqual({
      groups: [{ groupId: 'g-size', sortOrder: 0 }],
      overrides: [{ optionId: 'opt-l', priceCents: 1000, isDefault: null }],
    });
    await expect(page.getByTestId('legacy-options-note')).toHaveText(
      'Старые опции не действуют: товар продаётся с группами из каталога.',
    );
  });
});
