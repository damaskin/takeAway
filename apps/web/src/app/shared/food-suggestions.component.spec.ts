import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { ProductDetail, ProductSummary } from '@takeaway/shared-types';
import type { FoodSuggestion } from '@takeaway/utils';

import { API_CONFIG } from '../core/api/api.config';
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
    caffeineLevel: null,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    allergens: [],
    dietTags: [],
    imageUrls: [],
    sortOrder: 0,
  };
}

function detail(base: ProductSummary, over: Partial<ProductDetail> = {}): ProductDetail {
  return { ...base, brandId: 'brand-1', variations: [], modifiers: [], ...over };
}

describe('FoodSuggestionsComponent', () => {
  let fixture: ComponentFixture<FoodSuggestionsComponent>;
  let http: HttpTestingController;

  const croissant = summary('croissant', 'Круассан');
  const sandwich = summary('sandwich', 'Сэндвич');
  const suggestions: FoodSuggestion[] = [
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

  it('adds one with the default options in a tap', async () => {
    const changed: unknown[] = [];
    fixture.componentInstance.cartChanged.subscribe((cart) => changed.push(cart));

    plus('Круассан')?.click();
    http
      .expectOne((r) => r.url === '/api/products/croissant' && r.params.get('store') === 'centre')
      .flush(
        detail(croissant, {
          variations: [
            {
              id: 'warm',
              type: 'TEMPERATURE',
              name: 'Тёплый',
              priceDeltaCents: 0,
              prepTimeDeltaSeconds: 0,
              sortOrder: 0,
              isDefault: true,
            },
          ],
          modifiers: [
            {
              id: 'jam',
              slug: 'jam',
              name: 'Джем',
              priceDeltaCents: 300,
              prepTimeDeltaSeconds: 0,
              minCount: 0,
              maxCount: 1,
              sortOrder: 0,
            },
          ],
        }),
      );
    const add = http.expectOne('/api/cart/items');
    expect(add.request.body).toEqual({
      storeId: 'store-1',
      productId: 'croissant',
      quantity: 1,
      variationIds: ['warm'],
      modifiers: { jam: 0 },
    });
    add.flush({ id: 'cart-1', storeId: 'store-1', items: [], subtotalCents: 2500 });
    await fixture.whenStable();

    expect(changed).toHaveLength(1);
    expect(plus('Круассан')?.textContent?.trim()).toBe('✓');
  });

  it('opens the product instead when an add-on has to be taken', async () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    plus('Сэндвич')?.click();
    http
      .expectOne((r) => r.url === '/api/products/sandwich')
      .flush(
        detail(sandwich, {
          modifiers: [
            {
              id: 'sauce',
              slug: 'sauce',
              name: 'Соус',
              priceDeltaCents: 0,
              prepTimeDeltaSeconds: 0,
              minCount: 1,
              maxCount: 1,
              sortOrder: 0,
            },
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
