import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of } from 'rxjs';

import { AdminCatalogApi, type CategoryOptionDto, type IngredientDto } from '../../core/catalog/admin-catalog.service';
import { hiddenProductData, joinAllergens, productFieldsFor, splitAllergens } from './category-kind';
import { CategoryOptionsPanelComponent } from './category-options-panel.component';
import { buildPresetPreview, groupOptions, presetPreviewOptions } from './category-preset-preview';

const library = (name: string, priceCents: number, id = `i-${name}`): IngredientDto => ({
  id,
  brandId: 'b1',
  name,
  priceCents,
  isAvailable: true,
  products: [],
});

const setOption = (patch: Partial<CategoryOptionDto>): CategoryOptionDto => ({
  id: 'o1',
  categoryId: 'c1',
  kind: 'MODIFIER',
  variationType: null,
  name: '',
  priceDeltaCents: 0,
  group: null,
  isDefault: false,
  maxCount: 1,
  sortOrder: 0,
  ingredientId: null,
  ingredient: null,
  ...patch,
});

describe('product fields by kind', () => {
  it('gives drinks caffeine and every choice group, food and bakery sizes only', () => {
    expect(productFieldsFor('HOT_DRINKS')).toMatchObject({
      caffeine: true,
      variationTypes: ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'],
    });
    expect(productFieldsFor('FOOD')).toEqual({
      caffeine: false,
      dietTags: ['VEGAN', 'VEGETARIAN', 'GLUTEN_FREE', 'LACTOSE_FREE'],
      variationTypes: ['SIZE'],
    });
    expect(productFieldsFor('BAKERY').caffeine).toBe(false);
    expect(productFieldsFor('COLD_DRINKS').dietTags).toEqual(['VEGAN', 'LACTOSE_FREE', 'SUGAR_FREE', 'DECAF']);
  });

  it('keeps everything for OTHER and for a category from an older API', () => {
    for (const kind of ['OTHER', undefined, null] as const) {
      expect(productFieldsFor(kind).dietTags).toHaveLength(6);
      expect(productFieldsFor(kind).caffeine).toBe(true);
    }
  });

  it('names the values a kind hides', () => {
    expect(hiddenProductData('FOOD', { caffeineLevel: '2', dietTags: ['DECAF', 'VEGAN'] })).toEqual({
      caffeine: true,
      dietTags: ['DECAF'],
    });
    expect(hiddenProductData('FOOD', { caffeineLevel: '', dietTags: [] })).toEqual({ caffeine: false, dietTags: [] });
    expect(hiddenProductData('HOT_DRINKS', { caffeineLevel: 3, dietTags: ['VEGETARIAN'] })).toEqual({
      caffeine: false,
      dietTags: ['VEGETARIAN'],
    });
  });
});

describe('allergen checklist', () => {
  it('reads codes, free text naming an allergen, and the rest', () => {
    expect(splitAllergens(['MILK', 'орехи', 'следы горчицы', 'Milk', 'Eggs', 'лактоза'])).toEqual({
      codes: ['MILK', 'NUTS', 'EGGS', 'LACTOSE'],
      legacy: { NUTS: ['орехи'], MILK: ['Milk'], EGGS: ['Eggs'], LACTOSE: ['лактоза'] },
      other: ['следы горчицы'],
    });
  });

  it('writes ticked allergens in checklist order — typed ones as typed — then the rest, once each', () => {
    expect(
      joinAllergens({ codes: ['NUTS', 'GLUTEN', 'MILK'], legacy: { NUTS: ['орехи'] } }, ['соль', 'Орехи']),
    ).toEqual(['GLUTEN', 'MILK', 'орехи', 'соль']);
  });
});

describe('preset preview', () => {
  it('lists the preset of a kind in the cabinet language, reusing library add-ons at their price', () => {
    const rows = buildPresetPreview(
      'HOT_DRINKS',
      'ru',
      [library('Ванильный сироп', 500, 'i-vanilla'), library('Овсяное молоко', 800, 'i-oat'), library('Большой', 99)],
      [],
      ',',
    );

    const vanilla = rows.find((r) => r.key === 'syrup.vanilla');
    expect(vanilla).toMatchObject({
      name: 'Ванильный сироп',
      ingredientId: 'i-vanilla',
      price: '5',
      groupName: 'Сиропы',
    });
    expect(rows.find((r) => r.key === 'milk.oat')).toMatchObject({ ingredientId: 'i-oat', price: '8' });
    // A size is never taken from the library, even with the same name.
    expect(rows.find((r) => r.key === 'size.large')).toMatchObject({ name: 'Большой', ingredientId: null, price: '0' });
    expect(rows.find((r) => r.key === 'size.small')?.isDefault).toBe(true);
    expect(rows.every((r) => r.include)).toBe(true);
  });

  it('shows what the set already has without sending it again', () => {
    const rows = buildPresetPreview('FOOD', 'en', [], [setOption({ name: 'Garlic sauce', group: 'Sauces' })], '.');
    const garlic = rows.find((r) => r.key === 'sauce.garlic');
    expect(garlic).toMatchObject({ inSet: true, include: false });

    const options = presetPreviewOptions(rows);
    expect(options?.some((o) => o.name === 'Garlic sauce')).toBe(false);
    expect(options?.find((o) => o.name === 'No onion')).toEqual({
      kind: 'MODIFIER',
      name: 'No onion',
      priceDeltaCents: 0,
      group: 'Remove',
      maxCount: 1,
    });
  });

  it('sends ticked rows with the prices typed, a reused add-on by its id, and refuses a price it cannot read', () => {
    const rows = buildPresetPreview('HOT_DRINKS', 'ru', [library('Ваниль', 500, 'i-vanilla')], [], ',').map((r) => ({
      ...r,
      include: ['size.small', 'size.large', 'syrup.vanilla', 'extra.shot'].includes(r.key),
      price: r.key === 'size.large' ? '10' : r.key === 'extra.shot' ? '12,50' : r.price,
    }));

    expect(presetPreviewOptions(rows)).toEqual([
      { kind: 'VARIATION', variationType: 'SIZE', name: 'Маленький', priceDeltaCents: 0, isDefault: true },
      { kind: 'VARIATION', variationType: 'SIZE', name: 'Большой', priceDeltaCents: 1000, isDefault: false },
      { kind: 'MODIFIER', ingredientId: 'i-vanilla', priceDeltaCents: 500, group: 'Сиропы', maxCount: 2 },
      { kind: 'MODIFIER', name: 'Доп. шот эспрессо', priceDeltaCents: 1250, group: 'Дополнительно', maxCount: 3 },
    ]);
    expect(presetPreviewOptions(rows.map((r) => (r.key === 'size.large' ? { ...r, price: 'десять' } : r)))).toBeNull();
  });

  it('groups a set: choice groups in order, then add-on groups as they come, ungrouped as one', () => {
    const groups = groupOptions([
      setOption({ id: 'a', name: 'Ваниль', group: 'Сиропы' }),
      setOption({ id: 'b', kind: 'VARIATION', variationType: 'MILK', name: 'Овсяное' }),
      setOption({ id: 'c', name: 'Корица' }),
      setOption({ id: 'd', kind: 'VARIATION', variationType: 'SIZE', name: 'Большой' }),
      setOption({ id: 'e', name: 'Карамель', group: 'сиропы' }),
    ]);
    expect(groups.map((g) => [g.variationType ?? g.group, g.items.map((o) => o.id)])).toEqual([
      ['SIZE', ['d']],
      ['MILK', ['b']],
      ['Сиропы', ['a', 'e']],
      [null, ['c']],
    ]);
  });
});

describe('CategoryOptionsPanelComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => jest.restoreAllMocks());

  function panel(api: Partial<Record<keyof AdminCatalogApi, jest.Mock>>, kind = 'COLD_DRINKS') {
    TestBed.configureTestingModule({
      imports: [CategoryOptionsPanelComponent],
      providers: [
        provideTranslateService(),
        {
          provide: AdminCatalogApi,
          useValue: {
            listCategoryOptions: jest.fn().mockReturnValue(of([])),
            listIngredients: jest.fn().mockReturnValue(of([library('Овсяное молоко', 800, 'i-oat')])),
            ...api,
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(CategoryOptionsPanelComponent);
    fixture.componentRef.setInput('categoryId', 'c-cold');
    fixture.componentRef.setInput('categoryName', 'Холодные напитки');
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('brandId', 'b1');
    fixture.componentRef.setInput('currency', 'MDL');
    fixture.componentRef.setInput('productCount', 5);
    fixture.detectChanges();
    return fixture;
  }

  it('previews the set of the kind, and saves what stays ticked with the prices typed', () => {
    const saved = [setOption({ id: 'n1', name: 'Без льда', group: 'Лёд' })];
    const addCategoryOptions = jest.fn().mockReturnValue(of(saved));
    const fixture = panel({ addCategoryOptions });
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('Добавить набор для «Холодные напитки»');
    component.startPreview();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="category-preset-preview"]')?.textContent).toContain('Лёд');

    for (const row of component.preview() ?? []) {
      if (row.key !== 'ice.none' && row.key !== 'milk.oat') {
        component.toggleRow(row.key, { target: { checked: false } } as unknown as Event);
      }
    }
    component.priceRow('milk.oat', { target: { value: '9' } } as unknown as Event);
    expect(component.picked()).toBe(2);
    component.savePreview();

    expect(addCategoryOptions).toHaveBeenCalledWith('c-cold', [
      { kind: 'VARIATION', variationType: 'MILK', ingredientId: 'i-oat', priceDeltaCents: 900, isDefault: false },
      { kind: 'MODIFIER', name: 'Без льда', priceDeltaCents: 0, group: 'Лёд', maxCount: 1 },
    ]);
    expect(component.preview()).toBeNull();
    expect(component.options()).toEqual(saved);
  });

  it('lets an OTHER category borrow another kind’s set', () => {
    const component = panel({}, 'OTHER').componentInstance;
    component.borrowKind.set('BAKERY');
    component.startPreview();
    expect(component.preview()?.map((r) => r.groupName)).toContain('Подача');
  });

  it('applies the set to the products after a confirm and says what it added', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const applyCategoryOptions = jest
      .fn()
      .mockReturnValueOnce(of({ total: 5, products: 3, variations: 6, modifiers: 9 }))
      .mockReturnValueOnce(of({ total: 5, products: 0, variations: 0, modifiers: 0 }));
    const fixture = panel({
      listCategoryOptions: jest.fn().mockReturnValue(of([setOption({ name: 'Ваниль', group: 'Сиропы' })])),
      applyCategoryOptions,
    });
    const component = fixture.componentInstance;

    component.apply();
    expect(applyCategoryOptions).toHaveBeenCalledWith('c-cold');
    expect(component.notice()).toBe('Добавлено в товаров: 3 из 5 — вариантов: 6, добавок: 9.');

    component.apply();
    expect(component.notice()).toBe('Все товары категории уже с этими опциями.');
  });

  it('edits the price and group of an add-on in the set', () => {
    const vanilla = setOption({ id: 'o-vanilla', name: 'Ваниль', group: 'Сиропы', priceDeltaCents: 500 });
    const updateCategoryOption = jest.fn().mockReturnValue(of([{ ...vanilla, priceDeltaCents: 700, group: null }]));
    const component = panel({
      listCategoryOptions: jest.fn().mockReturnValue(of([vanilla])),
      updateCategoryOption,
    }).componentInstance;

    component.startEdit(vanilla);
    expect(component.edit.getRawValue()).toEqual({ price: '5', group: 'Сиропы', isDefault: false });
    component.edit.patchValue({ price: '7', group: ' ' });
    component.saveEdit(vanilla);

    expect(updateCategoryOption).toHaveBeenCalledWith('c-cold', 'o-vanilla', { priceDeltaCents: 700, group: null });
    expect(component.editingId()).toBeNull();
  });
});
