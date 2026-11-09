import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of } from 'rxjs';

import { AdminCatalogApi, type ProductAdminDto } from '../../core/catalog/admin-catalog.service';
import { ProductFormComponent } from './product-form.component';

const COLA: ProductAdminDto = {
  id: 'p1',
  brandId: 'b1',
  categoryId: 'drinks',
  slug: 'cola',
  name: 'Кола',
  description: null,
  basePriceCents: 2500,
  prepTimeSeconds: 30,
  prepParallel: true,
  visible: true,
  sortOrder: 0,
  imageUrls: [],
  calories: null,
  proteinsGrams: null,
  fatsGrams: null,
  carbsGrams: null,
  storeIds: ['s1'],
};

describe('ProductFormComponent — «Готовится параллельно» (queue policy)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function form(product: ProductAdminDto | null, api: Record<string, jest.Mock>) {
    TestBed.configureTestingModule({
      imports: [ProductFormComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        {
          provide: AdminCatalogApi,
          useValue: {
            listIngredients: jest.fn().mockReturnValue(of([])),
            listProductStores: jest.fn().mockReturnValue(of([])),
            listOptionGroups: jest.fn().mockReturnValue(of([])),
            ...api,
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(ProductFormComponent);
    fixture.componentRef.setInput('product', product);
    fixture.componentRef.setInput('categoryId', 'drinks');
    fixture.componentRef.setInput('categories', [{ id: 'drinks', brandId: 'b1', slug: 'drinks', name: 'Напитки' }]);
    fixture.componentRef.setInput('brandId', 'b1');
    fixture.componentRef.setInput('currency', 'MDL');
    fixture.detectChanges();
    return { component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement, fixture };
  }

  it('shows the box with its hint, ticked for a product made alongside', () => {
    const { root } = form(COLA, { updateProduct: jest.fn() });
    const box = root.querySelector<HTMLInputElement>('[data-testid="product-prep-parallel"]');
    expect(box?.checked).toBe(true);
    expect(root.textContent).toContain('Готовится параллельно');
    expect(root.textContent).toContain('Не занимает место на кухне');
  });

  it('sends the flag when the owner changed it, and leaves it alone otherwise', () => {
    const updateProduct = jest.fn().mockReturnValue(of(COLA));
    const { component } = form(COLA, { updateProduct });

    component.submit();
    expect(updateProduct.mock.calls[0]?.[1]).not.toHaveProperty('prepParallel');

    component.form.controls.prepParallel.setValue(false);
    component.form.controls.prepParallel.markAsDirty();
    component.submit();
    expect(updateProduct.mock.calls[1]?.[1]).toMatchObject({ prepParallel: false });
  });
});
