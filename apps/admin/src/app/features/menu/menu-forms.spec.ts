import { type Provider, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { of } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type CategoryAdminDto, type ProductAdminDto } from '../../core/catalog/admin-catalog.service';
import { OnboardingFlowService } from '../../core/onboarding/onboarding-flow.service';
import { CategoryFormPage } from './category-form.page';
import { ProductFormComponent } from './product-form.component';

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
  calories: null,
  proteinsGrams: null,
  fatsGrams: null,
  carbsGrams: null,
  storeIds: ['s1'],
};

const TWO_STORES = [
  { id: 's1', name: 'Бургерная', status: 'OPEN' },
  { id: 's2', name: 'Пиццерия', status: 'OPEN' },
];

/** What a checkbox change event looks like to the component. */
const tick = (checked: boolean) => ({ target: { checked } }) as unknown as Event;

function setup<T>(
  component: new (...args: never[]) => T,
  api: Partial<Record<keyof AdminCatalogApi, jest.Mock>>,
  providers: Provider[] = [],
) {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      ...providers,
      provideTranslateService(),
      provideRouter([]),
      {
        provide: AdminCatalogApi,
        useValue: {
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

    component.form.patchValue({ name: ' Флэт уайт ', price: '35,50', prepMinutes: '2,5' });
    component.submit();

    expect(createProduct).toHaveBeenCalledWith({
      brandId: 'b1',
      categoryId: 'coffee',
      name: 'Флэт уайт',
      basePriceCents: 3550,
      prepTimeSeconds: 150,
      visible: true,
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

  describe('fields by category kind', () => {
    const KINDS = [
      { id: 'coffee', brandId: 'b1', slug: 'coffee', name: 'Кофе', kind: 'HOT_DRINKS' },
      {
        id: 'shawarma',
        brandId: 'b1',
        slug: 'shawarma',
        name: 'Шаурма',
        kind: 'FOOD',
        defaultPrepTimeSeconds: 900,
        _count: { products: 3 },
      },
    ] as CategoryAdminDto[];

    function kindForm(product: ProductAdminDto | null, categoryId: string, api = {}) {
      const fixture = setup(ProductFormComponent, api);
      fixture.componentRef.setInput('product', product);
      fixture.componentRef.setInput('categoryId', categoryId);
      fixture.componentRef.setInput('categories', KINDS);
      fixture.componentRef.setInput('brandId', 'b1');
      fixture.detectChanges();
      return fixture;
    }

    const text = (fixture: { nativeElement: unknown }) => (fixture.nativeElement as HTMLElement).textContent ?? '';

    // Caffeine, «Особенности» and allergens left the menu on 2026-11-05;
    // since 2026-11-06 «Для покупателя» (energy and nutrition) is a meal's only.
    it('asks a shawarma for energy and nutrition, and a coffee for neither', () => {
      for (const categoryId of ['coffee', 'shawarma']) {
        TestBed.resetTestingModule();
        const el = kindForm(null, categoryId).nativeElement as HTMLElement;
        const details = el.querySelector('[data-testid="product-details"]')?.textContent ?? '';
        if (categoryId === 'shawarma') {
          expect(details).toContain('Для покупателя');
          expect(details).toContain('Калорийность, ккал');
          expect(details).toContain('Углеводы, г');
          expect(el.querySelector('[data-testid="product-details-hint"]')).not.toBeNull();
        } else {
          expect(el.querySelector('[data-testid="product-details"]')).toBeNull();
          expect(el.textContent).not.toContain('Для покупателя');
          expect(el.textContent).not.toContain('Калорийность');
        }
        expect(el.textContent).not.toContain('Кофеин');
        expect(el.textContent).not.toContain('Особенности');
        expect(el.textContent).not.toContain('Аллергены');
        expect(el.querySelector('[data-testid="product-caffeine"]')).toBeNull();
        expect(el.querySelector('[data-testid="product-diet-tags"]')).toBeNull();
        expect(el.querySelector('[data-testid="product-allergens"]')).toBeNull();
      }

      TestBed.resetTestingModule();
      const food = kindForm(null, 'shawarma');
      const foodEl = food.nativeElement as HTMLElement;
      // The illustration the website and Telegram show until there is a
      // photo; the app shows a text row, and the hint says both.
      expect(foodEl.querySelector('[data-testid="product-placeholder"] img')?.getAttribute('src')).toBe(
        '/ui-kit/product-placeholders/food.svg',
      );
      const hint = foodEl.querySelector('[data-testid="product-placeholder"]')?.textContent ?? '';
      expect(hint).toContain('строкой без картинки');
      expect(hint).toContain('продаются лучше');
    });

    it("starts a new shawarma at the category's 15 minutes", () => {
      const createProduct = jest.fn().mockReturnValue(of(LATTE));
      const component = kindForm(null, 'shawarma', { createProduct }).componentInstance;

      expect(component.form.controls.prepMinutes.value).toBe('15');
      component.form.patchValue({ name: 'Шаурма классическая', price: '90' });
      component.submit();
      expect(createProduct.mock.calls[0][0]).toMatchObject({ prepTimeSeconds: 900 });
      expect(createProduct.mock.calls[0][0]).not.toHaveProperty('applyCategoryOptions');
    });

    it('clears an emptied nutrition value of a meal on edit instead of leaving the old one', () => {
      const updateProduct = jest.fn().mockReturnValue(of(LATTE));
      const shawarma = { ...LATTE, categoryId: 'shawarma', calories: 120, carbsGrams: 12.5 };
      const component = kindForm(shawarma, 'shawarma', { updateProduct }).componentInstance;

      expect(component.form.getRawValue()).toMatchObject({
        price: '35',
        prepMinutes: '3',
        calories: '120',
        carbs: '12,5',
      });
      component.form.patchValue({ calories: '' });
      component.submit();

      expect(updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ calories: null, carbsGrams: 12.5 }));
      expect(updateProduct.mock.calls[0][1]).not.toHaveProperty('categoryId');
    });

    // The block follows the category picked in the form, and a product that
    // is not a meal is saved without figures — even ones it had, or a typo
    // nobody can see any more.
    it('hides energy and nutrition as soon as the product moves out of a meal category, and saves them empty', () => {
      const updateProduct = jest.fn().mockReturnValue(of(LATTE));
      const shawarma = { ...LATTE, categoryId: 'shawarma', calories: 540, proteinsGrams: 20 };
      const fixture = kindForm(shawarma, 'shawarma', { updateProduct });
      const component = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="product-details"]')).not.toBeNull();

      component.form.patchValue({ fats: 'много' });
      component.form.controls.categoryId.setValue('coffee');
      fixture.detectChanges();
      expect(component.hasNutrition()).toBe(false);
      expect(el.querySelector('[data-testid="product-details"]')).toBeNull();

      component.submit();
      expect(updateProduct).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          categoryId: 'coffee',
          calories: null,
          proteinsGrams: null,
          fatsGrams: null,
          carbsGrams: null,
        }),
      );

      component.form.controls.categoryId.setValue('shawarma');
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="product-details"]')).not.toBeNull();
      expect(component.form.controls.calories.value).toBe('540');
    });

    it('creates a coffee without energy or nutrition', () => {
      const createProduct = jest.fn().mockReturnValue(of(LATTE));
      const component = kindForm(null, 'coffee', { createProduct }).componentInstance;

      component.form.patchValue({ name: 'Латте', price: '35', calories: '120' });
      component.submit();

      const sent = createProduct.mock.calls[0][0];
      for (const field of ['calories', 'proteinsGrams', 'fatsGrams', 'carbsGrams'])
        expect(sent).not.toHaveProperty(field);
    });

    // What a product had in the retired fields stays in the database: the
    // form neither shows it nor sends it, so a save cannot overwrite it.
    it('never sends caffeine, diet tags or allergens, even for a product that still has them', () => {
      const updateProduct = jest.fn().mockReturnValue(of(LATTE));
      const latte = {
        ...LATTE,
        categoryId: 'coffee',
        caffeineLevel: 2,
        dietTags: ['DECAF', 'VEGAN'],
        allergens: ['MILK'],
      } as ProductAdminDto;
      const fixture = kindForm(latte, 'coffee', { updateProduct });
      const component = fixture.componentInstance;

      component.form.controls.categoryId.setValue('shawarma');
      fixture.detectChanges();
      expect(component.kind()).toBe('FOOD');
      expect(text(fixture)).not.toContain('Кофеин');

      component.submit();
      const sent = updateProduct.mock.calls[0][1];
      expect(sent).toMatchObject({ categoryId: 'shawarma' });
      expect(sent).not.toHaveProperty('caffeineLevel');
      expect(sent).not.toHaveProperty('dietTags');
      expect(sent).not.toHaveProperty('allergens');
    });
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

describe('CategoryFormPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function form(api: Partial<Record<keyof AdminCatalogApi, jest.Mock>>, categoryId?: string) {
    TestBed.configureTestingModule({
      imports: [CategoryFormPage],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        {
          provide: AdminCatalogApi,
          useValue: { ...api },
        },
        { provide: ActiveBrandService, useValue: { activeId: signal('b1'), active: signal(null) } },
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
      kind: 'OTHER',
      defaultPrepTimeSeconds: null,
    });
  });

  it('creates an ordinary category unless the box is ticked', () => {
    const createCategory = jest.fn().mockReturnValue(of({ id: 'c-new' }));
    const page = form({ createCategory, listCategories: jest.fn() }).componentInstance;

    page.form.controls.name.setValue('Новинки');
    page.submit();

    expect(createCategory).toHaveBeenCalledWith({
      brandId: 'b1',
      name: 'Новинки',
      visible: true,
      addOnsOnly: false,
      kind: 'OTHER',
    });
  });

  // A shawarma place adding «Шаурма»: food, 15 minutes — unless the owner says otherwise.
  it('suggests the kind and prep time of a new category from its name until the owner picks', () => {
    const createCategory = jest.fn().mockReturnValue(of({ id: 'c-new' }));
    const fixture = form({ createCategory, listCategories: jest.fn() });
    const page = fixture.componentInstance;

    page.form.controls.name.setValue('Шаурма');
    expect(page.form.controls.kind.value).toBe('FOOD');
    expect(page.form.controls.prepMinutes.value).toBe('15');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Подобрали по названию');

    page.form.controls.name.setValue('Холодный кофе');
    expect(page.form.controls.kind.value).toBe('COLD_DRINKS');
    expect(page.form.controls.prepMinutes.value).toBe('4');

    // The owner picks: the name no longer decides, and a typed time stays.
    page.form.controls.kind.setValue('HOT_DRINKS');
    page.kindPicked({ target: { value: 'HOT_DRINKS' } } as unknown as Event);
    page.form.controls.prepMinutes.setValue('5');
    page.form.controls.prepMinutes.markAsDirty();
    page.form.controls.name.setValue('Шаурма дня');
    expect(page.form.controls.kind.value).toBe('HOT_DRINKS');
    page.submit();

    expect(createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Шаурма дня', kind: 'HOT_DRINKS', defaultPrepTimeSeconds: 300 }),
    );
  });

  it("loads an existing category's kind and time, and applies the time to its products on request", () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const applyCategoryPrepTime = jest.fn().mockReturnValue(of({ products: 4 }));
    const listCategories = jest.fn().mockReturnValue(
      of([
        {
          id: 'c-food',
          brandId: 'b1',
          slug: 'shawarma',
          name: 'Шаурма',
          description: null,
          sortOrder: 0,
          visible: true,
          kind: 'FOOD',
          defaultPrepTimeSeconds: 900,
          _count: { products: 4 },
        },
      ]),
    );
    const fixture = form({ listCategories, applyCategoryPrepTime }, 'c-food');
    const page = fixture.componentInstance;

    expect(page.form.getRawValue()).toMatchObject({ kind: 'FOOD', prepMinutes: '15' });
    // The category option sets are gone (2026-11-18): options come from the catalog, per product.
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="category-options"]')).toBeNull();

    page.applyPrepToProducts();
    expect(applyCategoryPrepTime).toHaveBeenCalledWith('c-food');
    expect(page.prepNotice()).toBe('Время обновлено у товаров: 4.');
    jest.restoreAllMocks();
  });
});
