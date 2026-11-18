import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { ProductDetail, ProductSummary } from '@takeaway/shared-types';
import type { ProductSuggestion } from '@takeaway/utils';

import { API_CONFIG } from '../core/api/api.config';
import { catalogGroup, catalogOption, COFFEE_GROUPS, READY_GROUPS } from '../features/product/option-groups.testing';
import { FoodSuggestionsComponent } from './food-suggestions.component';

function summary(id: string, name: string): ProductSummary {
  return {
    id,
    categoryId: 'pastry',
    slug: id,
    name,
    description: null,
    basePriceCents: 2500,
    prepTimeSeconds: 60,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    imageUrls: [],
    sortOrder: 0,
  };
}

function detail(base: ProductSummary, over: Partial<ProductDetail> = {}): ProductDetail {
  return { ...base, brandId: 'brand-1', optionGroups: READY_GROUPS, ...over };
}

describe('FoodSuggestionsComponent', () => {
  let fixture: ComponentFixture<FoodSuggestionsComponent>;
  let http: HttpTestingController;

  const croissant = summary('croissant', 'Круассан');
  const sandwich = summary('sandwich', 'Сэндвич');
  const suggestions: ProductSuggestion[] = [
    { product: croissant, kind: 'BAKERY' },
    { product: sandwich, kind: 'FOOD' },
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [FoodSuggestionsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(FoodSuggestionsComponent);
    fixture.componentRef.setInput('suggestions', suggestions);
    fixture.componentRef.setInput('store', { id: 'store-1', slug: 'centre', currency: 'RUP' });
    fixture.componentRef.setInput('canAdd', true);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const plus = (name: string) => el().querySelector<HTMLButtonElement>(`button[aria-label="Добавить: ${name}"]`);

  it('shows each product with its placeholder, price and a link to it', () => {
    const cards = Array.from(el().querySelectorAll('[data-testid="food-suggestion"]'));
    expect(cards).toHaveLength(2);
    expect(el().querySelector('h2')?.textContent?.trim()).toBe('Добавить к напитку?');
    expect(cards[0]?.querySelector('img')?.getAttribute('src')).toBe('/ui-kit/product-placeholders/bakery.svg');
    expect(cards[0]?.querySelector('a')?.getAttribute('href')).toBe('/products/croissant?store=centre');
    expect(cards[0]?.textContent).toContain('25');
  });

  it('adds one in a tap with what its page starts with', async () => {
    const changed: unknown[] = [];
    fixture.componentInstance.cartChanged.subscribe((cart) => changed.push(cart));

    plus('Круассан')?.click();
    http
      .expectOne((r) => r.url === '/api/products/croissant' && r.params.get('store') === 'centre')
      .flush(
        detail(croissant, {
          optionGroups: [
            catalogGroup(
              'serving',
              'VARIANT',
              'A',
              'Подача',
              [catalogOption('warm', 'Тёплый', { isDefault: true }), catalogOption('cold', 'Холодный')],
              { minSelect: 1 },
            ),
            catalogGroup(
              'sauce',
              'ADDON',
              'A',
              'Соус',
              [catalogOption('jam', 'Джем', { isDefault: true }), catalogOption('honey', 'Мёд')],
              { maxSelect: 2 },
            ),
            catalogGroup('remove', 'ADDON', 'B', 'Убрать ингредиент', [catalogOption('no-sugar', 'Без сахара')]),
          ],
        }),
      );
    const add = http.expectOne('/api/cart/items');
    expect(add.request.body).toEqual({
      storeId: 'store-1',
      productId: 'croissant',
      quantity: 1,
      options: [
        { optionId: 'jam', qty: 1 },
        { optionId: 'warm', qty: 1 },
      ],
    });
    add.flush({ id: 'cart-1', storeId: 'store-1', items: [], subtotalCents: 2500 });
    await fixture.whenStable();

    expect(changed).toHaveLength(1);
    expect(plus('Круассан')?.textContent?.trim()).toBe('✓');
  });

  it('opens one the menu says has something to choose, without fetching it first', async () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentRef.setInput('suggestions', [
      { product: { ...sandwich, hasRequiredOptions: true }, kind: 'FOOD' },
    ]);
    await fixture.whenStable();

    plus('Сэндвич')?.click();
    expect(navigate).toHaveBeenCalledWith(['/products', 'sandwich'], { queryParams: { store: 'centre' } });
    http.expectNone((r) => r.url === '/api/products/sandwich');
  });

  it('opens one whose defaults are no choice yet (a size to pick)', async () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    plus('Сэндвич')?.click();
    http.expectOne((r) => r.url === '/api/products/sandwich').flush(detail(sandwich, { optionGroups: COFFEE_GROUPS }));
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/products', 'sandwich'], { queryParams: { store: 'centre' } });
    http.expectNone('/api/cart/items');
  });

  it('opens one with an add-on that has to be taken', async () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    plus('Сэндвич')?.click();
    http
      .expectOne((r) => r.url === '/api/products/sandwich')
      .flush(
        detail(sandwich, {
          optionGroups: [
            ...READY_GROUPS.filter((g) => g.kind === 'VARIANT'),
            catalogGroup('sauce', 'ADDON', 'A', 'Соус', [catalogOption('garlic', 'Чесночный')], { minSelect: 1 }),
          ],
        }),
      );
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/products', 'sandwich'], { queryParams: { store: 'centre' } });
    http.expectNone('/api/cart/items');
    expect(plus('Сэндвич')?.disabled).toBe(false);
  });

  it('has no «+» for a customer who cannot order', async () => {
    fixture.componentRef.setInput('canAdd', false);
    await fixture.whenStable();
    expect(plus('Круассан')).toBeNull();
  });
});
