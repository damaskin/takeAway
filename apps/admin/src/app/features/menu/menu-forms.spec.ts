import { TestBed } from '@angular/core/testing';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AdminCatalogApi, type ProductAdminDto } from '../../core/catalog/admin-catalog.service';
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
};

function setup<T>(component: new (...args: never[]) => T, api: Partial<Record<keyof AdminCatalogApi, jest.Mock>>) {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideTranslateService(), { provide: AdminCatalogApi, useValue: api }],
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
    // The surcharge is in the brand's currency, not "±¢".
    expect(text).toContain('+MDL');
  });
});
