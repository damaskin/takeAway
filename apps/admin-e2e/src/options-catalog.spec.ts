import { expect, test, type Request } from '@playwright/test';

import { installFakeApi, signIn } from './support/fake-api';

/**
 * The options catalog («Добавки и варианты», docs/option-groups.md): the
 * platform team keeps one catalog of groups in «Каталог добавок», each for
 * drinks, food or both; a brand marks in «Добавки» what it has, prices its
 * add-ons (one price for a whole group with «Ко всем»), sees the variant
 * prices its product cards set and stops options in a store; a product gets
 * catalog groups in its card — drawers with a switch, a price and «Ко всем»
 * per option — and is shown to customers only with a variant and an add-on.
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
    await form.getByTestId('group-scope').selectOption({ label: 'Напитки' });
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
      scope: 'DRINKS',
      sortOrder: 8,
    });

    const group = page.getByTestId('option-group').filter({ hasText: 'Топинг-соус' });
    await expect(group.getByTestId('option-group-meta')).toContainText('Напитки');
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

  test('filters the catalog by drinks and food', async ({ page }) => {
    await page.goto('/option-catalog');
    const names = page.getByTestId('option-group');
    await page.getByTestId('scope-filter-FOOD').click();
    await expect(names).toHaveCount(2);
    await expect(names.filter({ hasText: 'Основа' })).toHaveCount(1);
    await expect(names.filter({ hasText: 'Сиропы' })).toHaveCount(0);

    await page.getByTestId('scope-filter-DRINKS').click();
    await expect(names.filter({ hasText: 'Основа' })).toHaveCount(0);
    await expect(names.filter({ hasText: 'Соус в блюдо' })).toHaveCount(1);
  });
});

test.describe('a brand', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'BRAND_ADMIN');
    await installFakeApi(context, 'BRAND_ADMIN');
  });

  test('switches an option off, prices an add-on for a whole group and stops one in a store', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('link', { name: 'Добавки' }).click();
    await expect(page).toHaveURL(/\/ingredients$/);
    await expect(page.getByTestId('brand-option-catalog')).toBeVisible();
    // No tab of older add-ins any more (2026-11-18).
    await expect(page.getByRole('tab')).toHaveCount(0);

    // A food business never sees the coffee groups.
    await page.getByTestId('scope-filter-FOOD').click();
    await expect(page.getByTestId('brand-option-group').filter({ hasText: 'Сиропы' })).toHaveCount(0);
    await expect(page.getByTestId('brand-option-group').filter({ hasText: 'Основа' })).toHaveCount(1);
    await page.getByTestId('scope-filter-ALL').click();

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
    await vanilla.getByTestId('brand-option-price').fill('5');
    await vanilla.getByTestId('brand-option-price').press('Enter');
    expect((await priced).postDataJSON()).toEqual({ priceCents: 500 });

    // Maxim: +5 on the first syrup, «Применить ко всем» → +5 on every syrup.
    const applied = page.waitForRequest(
      (req) => req.method() === 'PUT' && pathOf(req).endsWith('/admin/brands/brand-1/option-groups/g-syrup/price'),
    );
    await vanilla.getByTestId('brand-price-apply-all').click();
    expect((await applied).postDataJSON()).toEqual({ priceCents: 500 });
    await expect(caramel.getByTestId('brand-option-price')).toHaveValue('5');
    await expect(page.getByTestId('brand-options-notice')).toContainText('«Сиропы»');

    const stopped = page.waitForRequest(
      (req) => req.method() === 'PUT' && pathOf(req).endsWith('/admin/stores/store-1/option-stops/opt-vanilla'),
    );
    await vanilla.getByTestId('brand-option-stop').click();
    expect((await stopped).postDataJSON()).toEqual({ expiresAt: null });
    await expect(vanilla.getByTestId('brand-option-stop')).toHaveText('test: в стопе');

    // A variant is priced in each product card: shown here, not editable.
    const sizes = page.getByTestId('brand-option-group').filter({ hasText: 'Размер (кофе)' });
    await sizes.locator('summary').click();
    await expect(sizes.getByTestId('brand-option-price')).toHaveCount(0);
    await expect(sizes.getByTestId('brand-option-product-prices').first()).toHaveText('Цена — в карточке товара');
  });

  test('gives a product variants and add-ins in drawers, and shows it to customers once it has both', async ({
    page,
  }) => {
    // Without options the product is not shown to customers: the menu list says so.
    await page.goto('/menu');
    await expect(page.getByTestId('product-hidden-badge')).toHaveText('Не видно покупателям');

    await page.goto('/menu/products/product-1');
    const section = page.getByTestId('product-option-groups');
    await expect(section).toContainText('Группы не подключены.');
    await expect(section.getByTestId('product-hidden-warning')).toHaveText(
      'Не видно покупателям: добавьте хотя бы один вариант и одну добавку',
    );
    // A drink is offered the drink groups and the shared ones, not a shawarma's base.
    const attach = section.getByTestId('option-group-attach');
    await expect(attach.locator('option', { hasText: 'Основа' })).toHaveCount(0);

    await attach.selectOption({ label: 'Размер (кофе)' });
    await expect(section.getByTestId('product-option-groups-base')).toContainText('25 MDL');
    const sizes = section.getByTestId('product-option-group').filter({ hasText: 'Размер (кофе)' });
    const large = sizes.getByTestId('product-option-row').filter({ hasText: '400–450 мл' });
    // Empty to start with: no surcharge, the base price.
    await expect(large.getByTestId('variant-price')).toHaveValue('');
    await large.getByTestId('variant-price').fill('10');
    await large.getByTestId('variant-price').press('Enter');
    await expect(large.getByTestId('option-price-hint')).toHaveText(/итого 35\sMDL/);
    // No S on this product.
    await sizes.getByTestId('product-option-row').filter({ hasText: '150–250 мл' }).getByTestId('option-on').uncheck();

    await attach.selectOption({ label: 'Сиропы' });
    const syrups = section.getByTestId('product-option-group').filter({ hasText: 'Сиропы' });
    const vanilla = syrups.getByTestId('product-option-row').filter({ hasText: 'Ваниль' });
    await vanilla.getByTestId('addon-price').fill('7');
    await vanilla.getByTestId('addon-price').press('Enter');
    await vanilla.getByTestId('price-apply-all').click();
    await expect(
      syrups.getByTestId('product-option-row').filter({ hasText: 'Карамель' }).getByTestId('addon-price'),
    ).toHaveValue('7');

    const saved = page.waitForRequest(
      (req) => req.method() === 'PUT' && pathOf(req).endsWith('/admin/products/product-1/option-groups'),
    );
    await section.getByTestId('product-option-groups-save').click();
    expect((await saved).postDataJSON()).toEqual({
      groups: [
        { groupId: 'g-size', sortOrder: 0 },
        { groupId: 'g-syrup', sortOrder: 1 },
      ],
      overrides: [
        { optionId: 'opt-caramel', priceCents: 700, isDefault: null, enabled: null },
        { optionId: 'opt-l', priceCents: 1000, isDefault: null, enabled: null },
        { optionId: 'opt-s', priceCents: null, isDefault: null, enabled: false },
        { optionId: 'opt-vanilla', priceCents: 700, isDefault: null, enabled: null },
      ],
    });
    await expect(section.getByTestId('product-hidden-warning')).toHaveCount(0);

    await page.goto('/menu');
    await expect(page.getByText('Flat White').first()).toBeVisible();
    await expect(page.getByTestId('product-hidden-badge')).toHaveCount(0);

    // «Добавки» shows what the card set, read-only.
    await page.goto('/ingredients');
    const sizesThere = page.getByTestId('brand-option-group').filter({ hasText: 'Размер (кофе)' });
    await sizesThere.locator('summary').click();
    await expect(
      sizesThere
        .getByTestId('brand-option-row')
        .filter({ hasText: '400–450 мл' })
        .getByTestId('brand-option-product-prices'),
    ).toHaveText(/Flat White \+10\sMDL · меняется в карточке товара/);
  });
});
