import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { of } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type IngredientDto, type ProductAdminDto } from '../../core/catalog/admin-catalog.service';
import { OnboardingFlowService } from '../../core/onboarding/onboarding-flow.service';
import { CategoryFormPage } from './category-form.page';
import { ProductFormComponent } from './product-form.component';
import { ProductOptionsPanelComponent } from './product-options-panel.component';

const LATTE: ProductAdminDto = {
  id: 'p1',
  brandId: 'b1',
  categoryId: 'coffee',
  slug: 'latte',
  name: 'Латте',
  description: null,
  basePriceCents: 3500,
  prepTimeSeconds: 180,
  visible: true,
  sortOrder: 0,
  imageUrls: [],
  caffeineLevel: null,
  calories: null,
  proteinsGrams: null,
  fatsGrams: null,
  carbsGrams: null,
  allergens: [],
  dietTags: [],
  storeIds: ['s1'],
};

const TWO_STORES = [
  { id: 's1', name: 'Бургерная', status: 'OPEN' },
  { id: 's2', name: 'Пиццерия', status: 'OPEN' },
];

/** What a checkbox change event looks like to the component. */
const tick = (checked: boolean) => ({ target: { checked } }) as unknown as Event;

function setup<T>(component: new (...args: never[]) => T, api: Partial<Record<keyof AdminCatalogApi, jest.Mock>>) {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      {
        provide: AdminCatalogApi,
        useValue: {
          listIngredients: jest.fn().mockReturnValue(of([])),
          listProductStores: jest.fn().mockReturnValue(of([])),
          ...api,
        },
      },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
  return TestBed.createComponent(component);
}

describe('ProductFormComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function form(product: ProductAdminDto | null, api: Partial<Record<keyof AdminCatalogApi, jest.Mock>>) {
    const fixture = setup(ProductFormComponent, api);
    fixture.componentRef.setInput('product', product);
    fixture.componentRef.setInput('categoryId', 'coffee');
    fixture.componentRef.setInput('categories', [{ id: 'coffee', brandId: 'b1', slug: 'coffee', name: 'Кофе' }]);
    fixture.componentRef.setInput('brandId', 'b1');
    fixture.componentRef.setInput('currency', 'MDL');
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('sends the price in cents and the time in seconds, and no slug unless one was typed', () => {
    const createProduct = jest.fn().mockReturnValue(of(LATTE));
    const component = form(null, { createProduct });

    component.form.patchValue({ name: ' Флэт уайт ', price: '35,50', prepMinutes: '2,5', allergens: 'молоко' });
    component.submit();

    expect(createProduct).toHaveBeenCalledWith({
      brandId: 'b1',
      categoryId: 'coffee',
      name: 'Флэт уайт',
      basePriceCents: 3550,
      prepTimeSeconds: 150,
      visible: true,
      allergens: ['молоко'],
      dietTags: [],
    });
  });

  it('does not send a price it cannot read', () => {
    const createProduct = jest.fn();
    const component = form(null, { createProduct });

    component.form.patchValue({ name: 'Латте', price: '35 лей' });
    component.submit();

    expect(createProduct).not.toHaveBeenCalled();
    expect(component.showError('price')).toBe(true);
  });

  it('clears an emptied nutrition value on edit instead of leaving the old one', () => {
    const updateProduct = jest.fn().mockReturnValue(of(LATTE));
    const component = form({ ...LATTE, calories: 120, caffeineLevel: 2 }, { updateProduct });

    expect(component.form.getRawValue()).toMatchObject({ price: '35', prepMinutes: '3', calories: '120' });
    component.form.patchValue({ calories: '', caffeineLevel: '' });
    component.submit();

    expect(updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ calories: null, caffeineLevel: null }));
    expect(updateProduct.mock.calls[0][1]).not.toHaveProperty('categoryId');
  });

  // A burger bar and a pizzeria of one brand: the burger is sold only in one.
  it('offers the stores of a brand with several, and sends only the ones left ticked', () => {
    const createProduct = jest.fn().mockReturnValue(of(LATTE));
    const listProductStores = jest.fn().mockReturnValue(of(TWO_STORES));
    const component = form(null, { createProduct, listProductStores });

    expect(component.pickStores()).toBe(true);
    // A new product starts ticked everywhere.
    expect(component.sellsIn('s1') && component.sellsIn('s2')).toBe(true);

    component.toggleStore('s2', tick(false));
    component.form.patchValue({ name: 'Чизбургер', price: '90' });
    component.submit();

    expect(listProductStores).toHaveBeenCalledWith('b1');
    expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({ storeIds: ['s1'] }));
  });

  it('leaves the choice to the server when nothing was unticked', () => {
    const createProduct = jest.fn().mockReturnValue(of(LATTE));
    const component = form(null, { createProduct, listProductStores: jest.fn().mockReturnValue(of(TWO_STORES)) });

    component.form.patchValue({ name: 'Чизбургер', price: '90' });
    component.submit();

    expect(createProduct.mock.calls[0][0]).not.toHaveProperty('storeIds');
  });

  it('shows where an existing product is sold, and warns when nothing is ticked', () => {
    const updateProduct = jest.fn().mockReturnValue(of(LATTE));
    const component = form(LATTE, { updateProduct, listProductStores: jest.fn().mockReturnValue(of(TWO_STORES)) });

    expect(component.sellsIn('s1')).toBe(true);
    expect(component.sellsIn('s2')).toBe(false);

    component.toggleStore('s1', tick(false));
    expect(component.soldNowhere()).toBe(true);
    component.toggleStore('s2', tick(true));
    component.submit();

    expect(updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ storeIds: ['s2'] }));
  });

  it('hides the picker for a one-store brand and never sends a listing', () => {
    const updateProduct = jest.fn().mockReturnValue(of(LATTE));
    const component = form(LATTE, {
      updateProduct,
      listProductStores: jest.fn().mockReturnValue(of([TWO_STORES[0]])),
    });

    expect(component.pickStores()).toBe(false);
    component.submit();

    expect(updateProduct.mock.calls[0][1]).not.toHaveProperty('storeIds');
  });
});

describe('ProductOptionsPanelComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('creates «Ванильный сироп» without inventing a slug in the browser', () => {
    const createModifier = jest.fn().mockReturnValue(of({}));
    const getProduct = jest.fn().mockReturnValue(of({ ...LATTE, variations: [], modifiers: [] }));
    const fixture = setup(ProductOptionsPanelComponent, { createModifier, getProduct });
    fixture.componentRef.setInput('productId', 'p1');
    fixture.componentRef.setInput('currency', 'MDL');
    fixture.detectChanges();

    fixture.componentInstance.modifierAdd.setValue({ name: 'Ванильный сироп', price: '5', maxCount: '3' });
    fixture.componentInstance.addModifier();

    expect(createModifier).toHaveBeenCalledWith('p1', { name: 'Ванильный сироп', priceDeltaCents: 500, maxCount: 3 });
  });

  it('refuses a negative surcharge before sending it, and says why', () => {
    const createVariation = jest.fn();
    const getProduct = jest.fn().mockReturnValue(of({ ...LATTE, variations: [], modifiers: [] }));
    const fixture = setup(ProductOptionsPanelComponent, { createVariation, getProduct });
    fixture.componentRef.setInput('productId', 'p1');
    fixture.detectChanges();

    fixture.componentInstance.variationAdd.patchValue({ name: 'Маленький', price: '-5' });
    fixture.componentInstance.addVariation();
    fixture.detectChanges();

    expect(createVariation).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Доплата — число не меньше нуля');
  });

  it('shows variation groups by their Russian names, not enum values', () => {
    const getProduct = jest.fn().mockReturnValue(
      of({
        ...LATTE,
        variations: [
          {
            id: 'v1',
            type: 'MILK',
            name: 'Овсяное',
            priceDeltaCents: 500,
            prepTimeDeltaSeconds: 0,
            sortOrder: 0,
            isDefault: false,
            ingredientId: null,
            ingredient: null,
          },
        ],
        modifiers: [],
      }),
    );
    const fixture = setup(ProductOptionsPanelComponent, { getProduct });
    fixture.componentRef.setInput('productId', 'p1');
    fixture.componentRef.setInput('currency', 'MDL');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Молоко');
    expect(text).toContain('Овсяное');
    expect(text).not.toContain('MILK');
    // The surcharge is in the brand's currency, not "±¢", written the Russian way.
    expect(text).toContain('+5\u00a0MDL');
  });

  it('marks an extra whose add-in ran out, and can stop tracking it', () => {
    const syrup = {
      id: 'm1',
      slug: 'vanilla',
      name: 'Ванильный сироп',
      priceDeltaCents: 500,
      prepTimeDeltaSeconds: 0,
      minCount: 0,
      maxCount: 3,
      sortOrder: 0,
      ingredientId: 'i1',
      ingredient: { id: 'i1', name: 'Ванильный сироп', isAvailable: false },
    };
    const getProduct = jest.fn().mockReturnValue(of({ ...LATTE, variations: [], modifiers: [syrup] }));
    const listIngredients = jest
      .fn()
      .mockReturnValue(of([{ id: 'i1', brandId: 'b1', name: 'Ванильный сироп', isAvailable: false, products: [] }]));
    const updateModifier = jest.fn().mockReturnValue(of({}));
    const fixture = setup(ProductOptionsPanelComponent, { getProduct, listIngredients, updateModifier });
    fixture.componentRef.setInput('productId', 'p1');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(listIngredients).toHaveBeenCalledWith('b1');
    expect(el.querySelector('[data-testid="option-out-of-stock"]')?.textContent).toContain('Нет в наличии');

    const panel = fixture.componentInstance;
    panel.editModifier(syrup);
    expect(panel.modifierEdit.controls.ingredientId.value).toBe('i1');
    panel.modifierEdit.controls.ingredientId.setValue('');
    panel.saveModifier(syrup);

    expect(updateModifier).toHaveBeenCalledWith('m1', expect.objectContaining({ ingredientId: null }));
  });

  describe('add-ons from the library («Добавки»)', () => {
    const library: IngredientDto[] = [
      { id: 'i-vanilla', brandId: 'b1', name: 'Ванильный сироп', priceCents: 500, isAvailable: true, products: [] },
      { id: 'i-shot', brandId: 'b1', name: 'Шот эспрессо', priceCents: 1000, isAvailable: true, products: [] },
    ];
    const vanillaOnLatte = {
      id: 'm1',
      slug: 'vanilla',
      name: 'Ванильный сироп',
      priceDeltaCents: 500,
      prepTimeDeltaSeconds: 0,
      minCount: 0,
      maxCount: 3,
      sortOrder: 0,
      ingredientId: 'i-vanilla',
      ingredient: { id: 'i-vanilla', name: 'Ванильный сироп', isAvailable: true },
    };

    function panel(api: Partial<Record<keyof AdminCatalogApi, jest.Mock>> = {}) {
      const fixture = setup(ProductOptionsPanelComponent, {
        getProduct: jest.fn().mockReturnValue(of({ ...LATTE, variations: [], modifiers: [vanillaOnLatte] })),
        listIngredients: jest.fn().mockReturnValue(of(library)),
        createModifier: jest.fn().mockReturnValue(of({})),
        createVariation: jest.fn().mockReturnValue(of({})),
        deleteModifier: jest.fn().mockReturnValue(of(undefined)),
        ...api,
      });
      fixture.componentRef.setInput('productId', 'p1');
      fixture.componentRef.setInput('currency', 'MDL');
      fixture.detectChanges();
      return fixture;
    }

    afterEach(() => jest.restoreAllMocks());

    it('offers the add-ons the product does not have yet, with their usual price', () => {
      const fixture = panel();

      const picker = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="option-library-pick"]');
      const options = [...(picker?.querySelectorAll('option') ?? [])].map((o) => o.textContent?.trim());
      expect(options).toEqual(['Выберите добавку', 'Шот эспрессо · +10\u00a0MDL']);
    });

    it('puts a picked add-on on the product by its library id alone', () => {
      const createModifier = jest.fn().mockReturnValue(of({}));
      const fixture = panel({ createModifier });
      const component = fixture.componentInstance;

      component.libraryPick.setValue({ ingredientId: 'i-shot' });
      component.addFromLibrary();

      expect(createModifier).toHaveBeenCalledWith('p1', { ingredientId: 'i-shot', maxCount: 1 });
      expect(component.libraryPick.controls.ingredientId.value).toBe('');
    });

    it('fills the usual price when a typed name is in the library', () => {
      const createModifier = jest.fn().mockReturnValue(of({}));
      const component = panel({ createModifier }).componentInstance;

      component.modifierAdd.controls.name.setValue('шот эспрессо');
      expect(component.modifierAdd.controls.price.value).toBe('10');

      component.addModifier();
      expect(createModifier).toHaveBeenCalledWith('p1', { name: 'шот эспрессо', priceDeltaCents: 1000, maxCount: 1 });
    });

    it('leaves an empty price to the server instead of sending zero', () => {
      const createModifier = jest.fn().mockReturnValue(of({}));
      const component = panel({ createModifier }).componentInstance;

      component.modifierAdd.setValue({ name: 'Корица', price: '', maxCount: '1' });
      component.addModifier();

      expect(createModifier).toHaveBeenCalledWith('p1', { name: 'Корица', maxCount: 1 });
    });

    it('says that taking a library add-on off the product keeps it in the library', () => {
      const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      const deleteModifier = jest.fn().mockReturnValue(of(undefined));
      const component = panel({ deleteModifier }).componentInstance;

      component.deleteModifier(vanillaOnLatte);

      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('В справочнике «Добавки» она останется'));
      expect(deleteModifier).toHaveBeenCalledWith('m1');
    });
  });
});

describe('CategoryFormPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function form(api: Partial<Record<keyof AdminCatalogApi, jest.Mock>>, categoryId?: string) {
    TestBed.configureTestingModule({
      imports: [CategoryFormPage],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: AdminCatalogApi, useValue: api },
        { provide: ActiveBrandService, useValue: { activeId: signal('b1') } },
        // Not opened from «Запуск бренда»: the form goes back to the menu as always.
        { provide: OnboardingFlowService, useValue: { afterSave: () => Promise.resolve('inactive') } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CategoryFormPage);
    if (categoryId) fixture.componentRef.setInput('categoryId', categoryId);
    fixture.detectChanges();
    return fixture;
  }

  // NoName's «Дополнительные ингредиенты» from Poster: kept, but never on a customer's menu.
  it('loads and saves «only as an add-on» for an existing category', () => {
    const updateCategory = jest.fn().mockReturnValue(of({}));
    const listCategories = jest.fn().mockReturnValue(
      of([
        {
          id: 'c-extra',
          brandId: 'b1',
          slug: 'extra',
          name: 'Дополнительные ингредиенты',
          description: null,
          sortOrder: 9,
          visible: true,
          addOnsOnly: false,
        },
      ]),
    );
    const fixture = form({ listCategories, updateCategory }, 'c-extra');
    const page = fixture.componentInstance;

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Только как добавка — не продаётся отдельно');
    expect(page.form.controls.addOnsOnly.value).toBe(false);
    page.form.controls.addOnsOnly.setValue(true);
    page.submit();

    expect(updateCategory).toHaveBeenCalledWith('c-extra', {
      name: 'Дополнительные ингредиенты',
      visible: true,
      addOnsOnly: true,
    });
  });

  it('creates an ordinary category unless the box is ticked', () => {
    const createCategory = jest.fn().mockReturnValue(of({ id: 'c-new' }));
    const page = form({ createCategory, listCategories: jest.fn() }).componentInstance;

    page.form.controls.name.setValue('Десерты');
    page.submit();

    expect(createCategory).toHaveBeenCalledWith({ brandId: 'b1', name: 'Десерты', visible: true, addOnsOnly: false });
  });
});
