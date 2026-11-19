import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type {
  BrandOptionCatalog,
  CatalogGroup,
  CatalogOption,
  CategoryKind,
  ProductOptionGroupsConfig,
} from '@takeaway/shared-types';
import { of } from 'rxjs';

import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { ProductOptionGroupsComponent } from './product-option-groups.component';

function option(groupId: string, id: string, name: string, extra: Partial<CatalogOption> = {}): CatalogOption {
  return {
    id,
    groupId,
    name,
    note: null,
    isDefault: false,
    minQty: null,
    maxQty: null,
    defaultQty: null,
    sortOrder: 0,
    ...extra,
  };
}

const SIZE: CatalogGroup = {
  id: 'g-size',
  kind: 'VARIANT',
  type: 'A',
  name: 'Размер (кофе)',
  minSelect: 1,
  maxSelect: 1,
  showIfOptionId: null,
  scope: 'DRINKS',
  sortOrder: 0,
  options: [
    option('g-size', 'opt-m', 'M', { isDefault: true }),
    option('g-size', 'opt-l', 'L', { sortOrder: 1 }),
    option('g-size', 'opt-xl', 'XL', { sortOrder: 2 }),
  ],
};
const BASE: CatalogGroup = {
  ...SIZE,
  id: 'g-base',
  name: 'Основа',
  scope: 'FOOD',
  sortOrder: 3,
  options: [
    option('g-base', 'opt-lavash', 'Лаваш', { isDefault: true }),
    option('g-base', 'opt-bun', 'Булка', { sortOrder: 1 }),
    option('g-base', 'opt-pita', 'Пита', { sortOrder: 2 }),
  ],
};
const SAUCE: CatalogGroup = {
  ...SIZE,
  id: 'g-sauce',
  kind: 'ADDON',
  name: 'Соус в блюдо',
  scope: 'BOTH',
  minSelect: 0,
  maxSelect: 2,
  sortOrder: 1,
  options: [option('g-sauce', 'opt-garlic', 'Чесночный'), option('g-sauce', 'opt-cheese', 'Сырный', { sortOrder: 1 })],
};
const ONION: CatalogGroup = {
  ...SIZE,
  id: 'g-remove',
  kind: 'ADDON',
  type: 'B',
  name: 'Убрать ингредиент',
  scope: 'FOOD',
  minSelect: null,
  maxSelect: null,
  sortOrder: 2,
  options: [option('g-remove', 'opt-onion', 'Без лука')],
};
const CATALOG: BrandOptionCatalog = {
  groups: [SIZE, SAUCE, ONION, BASE],
  settings: [
    // XL is not sold by the brand; the whole «Убрать» group is off.
    { optionId: 'opt-xl', priceCents: 0, enabled: false, stoppedStoreIds: [] },
    { optionId: 'opt-onion', priceCents: 0, enabled: false, stoppedStoreIds: [] },
    { optionId: 'opt-cheese', priceCents: 500, enabled: true, stoppedStoreIds: [] },
  ],
};

function setup(saved: ProductOptionGroupsConfig = { groups: [], overrides: [] }, kind: CategoryKind | null = null) {
  const api = {
    brandCatalog: jest.fn().mockReturnValue(of(CATALOG)),
    productGroups: jest.fn().mockReturnValue(of(saved)),
    saveProductGroups: jest.fn((_id: string, config: ProductOptionGroupsConfig) => of(config)),
  };
  TestBed.configureTestingModule({
    imports: [ProductOptionGroupsComponent],
    providers: [provideTranslateService(), { provide: OptionCatalogApi, useValue: api }],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
  const fixture = TestBed.createComponent(ProductOptionGroupsComponent);
  fixture.componentRef.setInput('productId', 'p1');
  fixture.componentRef.setInput('brandId', 'b1');
  fixture.componentRef.setInput('basePriceCents', 2500);
  fixture.componentRef.setInput('currency', 'MDL');
  fixture.componentRef.setInput('categoryKind', kind);
  const saves: boolean[] = [];
  fixture.componentInstance.saved.subscribe((shown) => saves.push(shown));
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, api, el: fixture.nativeElement as HTMLElement, saves };
}

function attach(el: HTMLElement, groupId: string): void {
  const select = el.querySelector<HTMLSelectElement>('[data-testid="option-group-attach"]');
  if (!select) throw new Error('no attach select');
  select.value = groupId;
  select.dispatchEvent(new Event('change'));
}

function type(field: HTMLInputElement | null | undefined, value: string): void {
  if (!field) throw new Error('no field');
  field.value = value;
  field.dispatchEvent(new Event('change'));
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="product-option-row"]')];
const row = (el: HTMLElement, name: string) => rows(el).find((r) => text(r.querySelector('.opt-name')) === name);

describe('ProductOptionGroupsComponent («Варианты и добавки»)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('offers the groups the brand has something in, grouped by kind', () => {
    const { cmp } = setup();
    expect(cmp.attachable().VARIANT.map((g) => g.id)).toEqual(['g-size', 'g-base']);
    expect(cmp.attachable().ADDON.map((g) => g.id)).toEqual(['g-sauce']);
  });

  // Maxim, 2026-11-18: a shawarma is never offered the coffee groups.
  it('offers a food product only food and shared groups, a drink only drink and shared ones', () => {
    const food = setup(undefined, 'FOOD');
    expect(food.cmp.attachable().VARIANT.map((g) => g.id)).toEqual(['g-base']);
    expect(food.cmp.attachable().ADDON.map((g) => g.id)).toEqual(['g-sauce']);

    TestBed.resetTestingModule();
    const drink = setup(undefined, 'HOT_DRINKS');
    expect(drink.cmp.attachable().VARIANT.map((g) => g.id)).toEqual(['g-size']);
  });

  it('keeps a group of the other kind attached before, and marks it', () => {
    const { fixture, el } = setup({ groups: [{ groupId: 'g-size', sortOrder: 0 }], overrides: [] }, 'FOOD');
    fixture.detectChanges();
    const group = el.querySelector('[data-testid="product-option-group"]');
    expect(group?.getAttribute('data-group')).toBe('Размер (кофе)');
    expect(text(group?.querySelector('summary'))).toContain('не для этой категории');
  });

  it('opens a group as a drawer: the options slide out of its summary', () => {
    const { fixture, cmp, el } = setup({ groups: [{ groupId: 'g-size', sortOrder: 0 }], overrides: [] });
    const drawer = el.querySelector<HTMLDetailsElement>('[data-testid="product-option-group"]');
    expect(drawer?.open).toBe(false);
    expect(text(drawer?.querySelector('summary'))).toContain('2 из 2');

    attach(el, 'g-sauce');
    fixture.detectChanges();
    const drawers = [...el.querySelectorAll<HTMLDetailsElement>('[data-testid="product-option-group"]')];
    // A group attached now opens at once.
    expect(drawers.map((d) => [d.getAttribute('data-group'), d.open])).toEqual([
      ['Размер (кофе)', false],
      ['Соус в блюдо', true],
    ]);
    expect(cmp.opened().has('g-sauce')).toBe(true);
  });

  // Maxim, 2026-11-18: empty = no surcharge; a sum is added to the order.
  it('starts a variant surcharge empty and saves only what is typed', () => {
    const { fixture, cmp, api, el } = setup();
    attach(el, 'g-size');
    fixture.detectChanges();

    // XL is switched off by the brand: not offered on the product.
    expect(rows(el).map((r) => text(r.querySelector('.opt-name')))).toEqual(['M', 'L']);
    expect(text(el.querySelector('[data-testid="product-option-groups-base"]'))).toContain('25');
    const large = row(el, 'L')?.querySelector<HTMLInputElement>('[data-testid="variant-price"]');
    expect(large?.value).toBe('');
    expect(large?.placeholder).toBe('0');

    type(large, '7,50');
    fixture.detectChanges();
    expect(text(row(el, 'L')?.querySelector('[data-testid="option-price-hint"]'))).toMatch(/^итого 32,50\s?MDL$/);
    type(row(el, 'M')?.querySelector<HTMLInputElement>('[data-testid="variant-price"]'), '0');

    cmp.save();
    expect(api.saveProductGroups).toHaveBeenCalledWith('p1', {
      groups: [{ groupId: 'g-size', sortOrder: 0 }],
      overrides: [{ optionId: 'opt-l', priceCents: 750, isDefault: null, enabled: null }],
    });
    expect(cmp.dirty()).toBe(false);
  });

  it("shows an add-on's brand price under an empty field, and keeps a price of the product's own", () => {
    const { fixture, cmp, api, el } = setup({ groups: [{ groupId: 'g-sauce', sortOrder: 0 }], overrides: [] });
    fixture.detectChanges();
    const cheese = row(el, 'Сырный')?.querySelector<HTMLInputElement>('[data-testid="addon-price"]');
    expect(cheese?.value).toBe('');
    expect(cheese?.placeholder).toBe('5');
    expect(text(row(el, 'Сырный')?.querySelector('[data-testid="option-price-hint"]'))).toMatch(/^бренд: \+5\s?MDL$/);

    type(cheese, '0');
    fixture.detectChanges();
    expect(text(row(el, 'Сырный')?.querySelector('[data-testid="option-price-hint"]'))).toContain('своя цена');
    cmp.save();
    expect(api.saveProductGroups).toHaveBeenCalledWith('p1', {
      groups: [{ groupId: 'g-sauce', sortOrder: 0 }],
      overrides: [{ optionId: 'opt-cheese', priceCents: 0, isDefault: null, enabled: null }],
    });
  });

  // Maxim: syrups +5 on the first, «Применить ко всем» → +5 on every syrup.
  it('applies a price to every option of the group', () => {
    const { fixture, cmp, el } = setup({ groups: [{ groupId: 'g-sauce', sortOrder: 0 }], overrides: [] });
    fixture.detectChanges();
    type(row(el, 'Чесночный')?.querySelector<HTMLInputElement>('[data-testid="addon-price"]'), '3');
    fixture.detectChanges();
    row(el, 'Чесночный')?.querySelector<HTMLButtonElement>('[data-testid="price-apply-all"]')?.click();
    fixture.detectChanges();
    expect(cmp.draft().prices).toEqual({ 'opt-garlic': 300, 'opt-cheese': 300 });
    expect(row(el, 'Сырный')?.querySelector<HTMLInputElement>('[data-testid="addon-price"]')?.value).toBe('3');
  });

  // Maxim: a shawarma's «Основа» without «Булка» and «Пита».
  it('switches single options off on the product', () => {
    const { fixture, cmp, api, el } = setup({ groups: [{ groupId: 'g-base', sortOrder: 0 }], overrides: [] }, 'FOOD');
    fixture.detectChanges();
    for (const name of ['Булка', 'Пита']) {
      const box = row(el, name)?.querySelector<HTMLInputElement>('[data-testid="option-on"]');
      if (!box) throw new Error('no switch');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
    }
    fixture.detectChanges();
    expect(row(el, 'Булка')?.classList.contains('off')).toBe(true);
    expect(row(el, 'Булка')?.querySelector('[data-testid="variant-price"]')).toBeNull();
    expect(text(el.querySelector('summary'))).toContain('1 из 3');

    cmp.save();
    expect(api.saveProductGroups).toHaveBeenCalledWith('p1', {
      groups: [{ groupId: 'g-base', sortOrder: 0 }],
      overrides: [
        { optionId: 'opt-bun', priceCents: null, isDefault: null, enabled: false },
        { optionId: 'opt-pita', priceCents: null, isDefault: null, enabled: false },
      ],
    });
  });

  it("sets a dish's own default sauce", () => {
    const { cmp } = setup({ groups: [{ groupId: 'g-sauce', sortOrder: 0 }], overrides: [] });
    cmp.setDefault(SAUCE, SAUCE.options[1] as CatalogOption, true);
    expect(cmp.dirty()).toBe(true);
    cmp.save();
    expect(cmp.savedNotice()).toBe(true);
  });

  it('detaches a group and saves nothing of it', () => {
    const saved = {
      groups: [{ groupId: 'g-size', sortOrder: 0 }],
      overrides: [{ optionId: 'opt-l', priceCents: 500, isDefault: null, enabled: null }],
    };
    const { cmp, api } = setup(saved);
    cmp.detach(SIZE);
    cmp.save();
    expect(api.saveProductGroups).toHaveBeenCalledWith('p1', { groups: [], overrides: [] });
  });
});

/** Owner, 2026-11-18: customers see a product only with a variant and an add-on. */
describe('ProductOptionGroupsComponent — not visible to customers', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const warning = (el: HTMLElement) => el.querySelector('[data-testid="product-hidden-warning"]');

  it('warns about a product saved without options, or with variants only', () => {
    expect(text(warning(setup().el))).toBe('Не видно покупателям: добавьте хотя бы один вариант и одну добавку');
    TestBed.resetTestingModule();
    expect(warning(setup({ groups: [{ groupId: 'g-size', sortOrder: 0 }], overrides: [] }).el)).not.toBeNull();
  });

  it('warns when the only add-on is switched off on the product or by the brand', () => {
    const offHere = setup({
      groups: [
        { groupId: 'g-size', sortOrder: 0 },
        { groupId: 'g-sauce', sortOrder: 1 },
      ],
      overrides: [
        { optionId: 'opt-garlic', priceCents: null, isDefault: null, enabled: false },
        { optionId: 'opt-cheese', priceCents: null, isDefault: null, enabled: false },
      ],
    });
    expect(warning(offHere.el)).not.toBeNull();

    TestBed.resetTestingModule();
    const brandOff = setup({
      groups: [
        { groupId: 'g-size', sortOrder: 0 },
        { groupId: 'g-remove', sortOrder: 1 },
      ],
      overrides: [],
    });
    expect(warning(brandOff.el)).not.toBeNull();
  });

  it('is quiet with a variant and an add-on, and says so after saving', () => {
    const { fixture, cmp, el, saves } = setup({ groups: [{ groupId: 'g-size', sortOrder: 0 }], overrides: [] });
    attach(el, 'g-sauce');
    cmp.save();
    fixture.detectChanges();
    expect(warning(el)).toBeNull();
    expect(saves).toEqual([true]);
  });
});
