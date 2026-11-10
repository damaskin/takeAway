import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type {
  BrandOptionCatalog,
  CatalogGroup,
  CatalogOption,
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
  sortOrder: 0,
  options: [
    option('g-size', 'opt-m', 'M', { isDefault: true }),
    option('g-size', 'opt-l', 'L', { sortOrder: 1 }),
    option('g-size', 'opt-xl', 'XL', { sortOrder: 2 }),
  ],
};
const SAUCE: CatalogGroup = {
  ...SIZE,
  id: 'g-sauce',
  kind: 'ADDON',
  name: 'Соус в блюдо',
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
  minSelect: null,
  maxSelect: null,
  sortOrder: 2,
  options: [option('g-remove', 'opt-onion', 'Без лука')],
};
const CATALOG: BrandOptionCatalog = {
  groups: [SIZE, SAUCE, ONION],
  settings: [
    // XL is not sold by the brand; the whole «Убрать» group is off.
    { optionId: 'opt-xl', priceCents: 0, enabled: false, stoppedStoreIds: [] },
    { optionId: 'opt-onion', priceCents: 0, enabled: false, stoppedStoreIds: [] },
    { optionId: 'opt-cheese', priceCents: 500, enabled: true, stoppedStoreIds: [] },
  ],
};

function setup(saved: ProductOptionGroupsConfig = { groups: [], overrides: [] }, hasLegacyOptions = false) {
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
  fixture.componentRef.setInput('hasLegacyOptions', hasLegacyOptions);
  const counts: number[] = [];
  fixture.componentInstance.attachedCount.subscribe((n) => counts.push(n));
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, api, el: fixture.nativeElement as HTMLElement, counts };
}

function attach(el: HTMLElement, groupId: string): void {
  const select = el.querySelector<HTMLSelectElement>('[data-testid="option-group-attach"]');
  if (!select) throw new Error('no attach select');
  select.value = groupId;
  select.dispatchEvent(new Event('change'));
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ProductOptionGroupsComponent («Варианты и добавки»)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('offers the groups the brand has something in, grouped by kind', () => {
    const { cmp, counts } = setup();
    expect(cmp.attachable().VARIANT.map((g) => g.id)).toEqual(['g-size']);
    expect(cmp.attachable().ADDON.map((g) => g.id)).toEqual(['g-sauce']);
    expect(counts).toEqual([0]);
  });

  it('prices a variant as the whole price and saves what it adds to the base', () => {
    const { fixture, cmp, api, el, counts } = setup();
    attach(el, 'g-size');
    fixture.detectChanges();

    const rows = [...el.querySelectorAll('[data-testid="product-option-row"]')];
    // XL is switched off by the brand: not offered on the product.
    expect(rows.map((r) => text(r.querySelector('span span')))).toEqual(['M', 'L']);
    expect(text(el.querySelector('[data-testid="product-option-groups-base"]'))).toContain('25');

    const large = rows[1]?.querySelector<HTMLInputElement>('[data-testid="variant-price"]');
    if (!large) throw new Error('no price field');
    expect(large.value).toBe('25');
    large.value = '32,50';
    large.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(text(rows[1]?.querySelector('[data-testid="variant-delta"]'))).toMatch(/^\+7,50\s?MDL к базовой$/);

    expect(cmp.dirty()).toBe(true);
    cmp.save();
    expect(api.saveProductGroups).toHaveBeenCalledWith('p1', {
      groups: [{ groupId: 'g-size', sortOrder: 0 }],
      overrides: [{ optionId: 'opt-l', priceCents: 750, isDefault: null }],
    });
    expect(cmp.dirty()).toBe(false);
    expect(counts).toEqual([0, 1]);
  });

  it("sets a dish's own default sauce and shows the brand's add-on price", () => {
    const { fixture, cmp, el } = setup({ groups: [{ groupId: 'g-sauce', sortOrder: 0 }], overrides: [] });
    fixture.detectChanges();
    const cheese = [...el.querySelectorAll('[data-testid="product-option-row"]')].find((r) =>
      text(r).startsWith('Сырный'),
    );
    expect(text(cheese)).toContain('+5');
    cmp.setDefault(SAUCE, SAUCE.options[1] as CatalogOption, true);
    expect(cmp.dirty()).toBe(true);
    cmp.save();
    expect(cmp.savedNotice()).toBe(true);
  });

  it('asks to switch a product with old options over, until it has catalog groups', () => {
    const { el } = setup(undefined, true);
    expect(el.querySelector('[data-testid="product-option-groups-legacy-hint"]')).not.toBeNull();
    TestBed.resetTestingModule();
    const saved = setup({ groups: [{ groupId: 'g-size', sortOrder: 0 }], overrides: [] }, true);
    expect(saved.el.querySelector('[data-testid="product-option-groups-legacy-hint"]')).toBeNull();
    expect(saved.counts).toEqual([1]);
  });

  it('detaches a group and saves nothing of it', () => {
    const saved = {
      groups: [{ groupId: 'g-size', sortOrder: 0 }],
      overrides: [{ optionId: 'opt-l', priceCents: 500, isDefault: null }],
    };
    const { cmp, api } = setup(saved);
    cmp.detach(SIZE);
    cmp.save();
    expect(api.saveProductGroups).toHaveBeenCalledWith('p1', { groups: [], overrides: [] });
  });
});
