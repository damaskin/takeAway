import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { ProductDetail, StoreListItem, StoreMenu, StoreSuggestions } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { AuthStore } from '../../core/auth/auth.store';
import { COFFEE_GROUPS } from './option-groups.testing';
import { ProductPage } from './product.page';

const STORE: StoreListItem = {
  id: 'store-1',
  brandId: 'brand-1',
  slug: 'centre',
  name: 'NoName Centre',
  addressLine: '',
  city: 'Тирасполь',
  country: 'MD',
  latitude: 46.84,
  longitude: 29.62,
  status: 'OPEN',
  fulfillmentTypes: ['TAKEAWAY'],
  pickupPointType: 'COUNTER',
  busyMeter: 0,
  currentEtaSeconds: 300,
  acceptingOrders: true,
  openNow: true,
  taxRateBps: 0,
  taxIncludedInPrice: true,
  currency: 'RUP',
  timezone: 'Europe/Chisinau',
  heroImageUrl: null,
  distanceMeters: null,
};

function product(id: string, over: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id,
    brandId: 'brand-1',
    categoryId: 'coffee',
    slug: id,
    name: id,
    description: null,
    basePriceCents: 3000,
    prepTimeSeconds: 120,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    imageUrls: [],
    sortOrder: 0,
    variations: [],
    modifiers: [],
    ...over,
  };
}

const LATTE = product('latte', {
  name: 'Латте',
  calories: 150,
  variations: [
    { id: 'm', type: 'SIZE', name: 'M', priceDeltaCents: 0, prepTimeDeltaSeconds: 0, sortOrder: 0, isDefault: true },
    { id: 'l', type: 'SIZE', name: 'L', priceDeltaCents: 500, prepTimeDeltaSeconds: 0, sortOrder: 1, isDefault: false },
  ],
});

const CROISSANT = product('croissant', {
  name: 'Круассан',
  categoryId: 'pastry',
  categoryKind: 'BAKERY',
});

const MENU: StoreMenu = {
  storeId: STORE.id,
  storeSlug: STORE.slug,
  categories: [
    {
      id: 'coffee',
      slug: 'coffee',
      name: 'Кофе',
      description: null,
      iconUrl: null,
      sortOrder: 0,
      availableFrom: null,
      availableTo: null,
      kind: 'HOT_DRINKS',
      products: [LATTE],
    },
    {
      id: 'pastry',
      slug: 'pastry',
      name: 'Выпечка',
      description: null,
      iconUrl: null,
      sortOrder: 1,
      availableFrom: null,
      availableTo: null,
      kind: 'BAKERY',
      products: [CROISSANT, product('muffin', { name: 'Маффин', categoryId: 'pastry' })],
    },
  ],
};

describe('ProductPage', () => {
  let http: HttpTestingController;

  /**
   * Opens the product page and answers its requests. `suggestions` is the
   * store's answer for the product; without one the call fails, as on an
   * API from before the endpoint.
   */
  async function open(slug: string, detail: ProductDetail, suggestions?: StoreSuggestions) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'products/:slug', component: ProductPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        { provide: AuthStore, useValue: { isAuthenticated: signal(true) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/products/${slug}?store=centre`);
    http.expectOne((r) => r.url === `/api/products/${slug}`).flush(detail);
    http.expectOne('/api/stores').flush([STORE]);
    await harness.fixture.whenStable();
    http
      .expectOne((r) => r.url === '/api/cart')
      .flush({ id: 'cart-1', storeId: STORE.id, items: [], subtotalCents: 0 });
    http.expectOne('/api/stores/centre/menu').flush(MENU);
    await harness.fixture.whenStable();
    const ask = http.expectOne((r) => r.url === `/api/stores/${STORE.id}/suggestions`);
    expect(ask.request.params.get('productIds')).toBe(detail.id);
    if (suggestions) ask.flush(suggestions);
    else ask.flush('Not Found', { status: 404, statusText: 'Not Found' });
    await harness.fixture.whenStable();
    return harness;
  }

  afterEach(() => http.verify());

  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  // Caffeine and allergens left the product page on 2026-11-05, and calories
  // are a meal's since 2026-11-06 — even when an older API build still sends
  // them for a drink.
  it('asks a drink for a note to the barista, with no calories, caffeine or allergens', async () => {
    const harness = await open('latte', { ...LATTE, caffeineLevel: 2, allergens: ['MILK'] } as ProductDetail);
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('label[for="pdp-notes"]'))).toBe('Пожелание бариста');
    expect(el.querySelector('[data-testid="product-meta"]')).toBeNull();
    expect(text(el)).not.toContain('ккал');
    expect(text(el)).not.toContain('Кофеин');
    expect(text(el)).not.toContain('Аллергены');
    expect(el.querySelector('[data-testid="allergens"]')).toBeNull();
  });

  it('shows the calories of a meal', async () => {
    const harness = await open(
      'shawarma',
      product('shawarma', { name: 'Шаурма', categoryId: 'food', categoryKind: 'FOOD', calories: 540 }),
    );
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('[data-testid="product-meta"]'))).toContain('540 ккал');
    expect(text(el.querySelector('label[for="pdp-notes"]'))).toBe('Комментарий к заказу');
  });

  // Maxim 2026-11-11: the brand fills protein / fat / carbs, the buyer saw only kcal.
  it('shows the protein, fat and carbs of a meal, skipping what is empty', async () => {
    const harness = await open(
      'shawarma',
      product('shawarma', {
        name: 'Шаурма',
        categoryId: 'food',
        categoryKind: 'FOOD',
        calories: 540,
        proteinsGrams: 24,
        fatsGrams: 18.5,
        carbsGrams: null,
      }),
    );
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('[data-testid="product-meta"]'))).toBe('🔥 540 ккал Белки 24 г · Жиры 18.5 г');
    expect(text(el)).not.toContain('Углеводы');
  });

  it('shows macros of a meal even without calories', async () => {
    const harness = await open(
      'salad',
      product('salad', { name: 'Салат', categoryId: 'food', categoryKind: 'FOOD', carbsGrams: 12 }),
    );
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('[data-testid="product-macros"]'))).toBe('Углеводы 12 г');
    expect(text(el)).not.toContain('ккал');
  });

  it('prices the choice live and sums it up next to the button', async () => {
    const harness = await open('latte', LATTE);
    const el = harness.routeNativeElement as HTMLElement;
    const summary = () => text(el.querySelector('[data-testid="choice-summary"]'));
    const addButton = () =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b).includes('Добавить в корзину'));

    expect(summary()).toBe('M');
    expect(text(addButton())).toContain('30');

    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((b) => text(b).startsWith('L'))
      ?.click();
    await harness.fixture.whenStable();
    expect(summary()).toBe('L');
    expect(text(addButton())).toContain('35');
  });

  it('offers bakery with a drink, and sends the note with the item', async () => {
    const harness = await open('latte', LATTE);
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el)).toContain('К этому напитку');
    expect(Array.from(el.querySelectorAll('[data-testid="food-suggestion"] .name')).map(text)).toEqual([
      'Круассан',
      'Маффин',
    ]);

    const notes = el.querySelector<HTMLTextAreaElement>('#pdp-notes');
    if (!notes) throw new Error('no notes');
    notes.value = '  погорячее ';
    notes.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    Array.from(el.querySelectorAll('button'))
      .find((b) => text(b).includes('Добавить в корзину'))
      ?.click();

    const add = http.expectOne('/api/cart/items');
    expect(add.request.body).toEqual({
      storeId: STORE.id,
      productId: 'latte',
      quantity: 1,
      variationIds: ['m'],
      modifiers: {},
      notes: 'погорячее',
    });
    add.flush({ id: 'cart-1', storeId: STORE.id, items: [], subtotalCents: 3000 });
  });

  it('treats bakery as food: a plain order note, its own placeholder, nothing paired', async () => {
    const harness = await open('croissant', CROISSANT);
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('label[for="pdp-notes"]'))).toBe('Комментарий к заказу');
    expect(el.querySelector('[data-testid="product-meta"]')).toBeNull();
    expect(el.querySelector('lib-product-image img')?.getAttribute('src')).toBe(
      '/ui-kit/product-placeholders/bakery.svg',
    );
    expect(el.querySelector('[data-testid="food-suggestion"]')).toBeNull();
  });

  it('says «Часто берут вместе» only over what customers bought together, under any product', async () => {
    const harness = await open('croissant', CROISSANT, { productIds: ['latte', 'muffin'], source: 'copurchase' });
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('app-food-suggestions h2'))).toBe('Часто берут вместе');
    expect(Array.from(el.querySelectorAll('[data-testid="food-suggestion"] .name')).map(text)).toEqual([
      'Латте',
      'Маффин',
    ]);
  });

  it('keeps «К этому напитку» while the store has too few orders to tell', async () => {
    const harness = await open('latte', LATTE, { productIds: ['croissant', 'muffin'], source: 'rule' });
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('app-food-suggestions h2'))).toBe('К этому напитку');
  });

  describe('a product on the options catalog', () => {
    const CATALOG_LATTE = product('catalog-latte', {
      name: 'Латте',
      hasRequiredOptions: true,
      optionGroups: COFFEE_GROUPS,
    });

    const pick = async (harness: RouterTestingHarness, name: string) => {
      const el = harness.routeNativeElement as HTMLElement;
      Array.from(el.querySelectorAll('[data-testid="option-row"]'))
        .find((r) => text(r.querySelector('.name')) === name)
        ?.querySelector<HTMLInputElement>('input')
        ?.click();
      await harness.fixture.whenStable();
    };
    const addButton = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('button')).find((b) => text(b).includes('Добавить в корзину'));

    it('keeps the button off, saying what to choose, until a size is picked; then sends the choice', async () => {
      const harness = await open('catalog-latte', CATALOG_LATTE);
      const el = harness.routeNativeElement as HTMLElement;

      expect(el.querySelector('app-product-options')).toBeNull();
      expect(text(el.querySelector('[data-testid="option-hint"]'))).toBe('Выберите: Размер (кофе)');
      expect(addButton(el)?.disabled).toBe(true);

      await pick(harness, 'L');
      expect(el.querySelector('[data-testid="option-hint"]')).toBeNull();
      expect(text(el.querySelector('[data-testid="choice-summary"]'))).toBe('L, Горячий · Коровье');
      expect(addButton(el)?.disabled).toBe(false);
      expect(text(addButton(el))).toMatch(/37\s?руб\./);

      addButton(el)?.click();
      const add = http.expectOne('/api/cart/items');
      expect(add.request.body).toEqual({
        storeId: STORE.id,
        productId: 'catalog-latte',
        quantity: 1,
        options: [
          { optionId: 'cow', qty: 1 },
          { optionId: 'hot', qty: 1 },
          { optionId: 'l', qty: 1 },
        ],
      });
      add.flush({ id: 'cart-1', storeId: STORE.id, items: [], subtotalCents: 3700 });
    });

    it('says so when the cart refuses the choice, and greys out what ran out after a fresh look', async () => {
      const harness = await open('catalog-latte', CATALOG_LATTE);
      const el = harness.routeNativeElement as HTMLElement;
      await pick(harness, 'M');
      el.querySelector<HTMLButtonElement>('[aria-label="Молоко"] button.head')?.click();
      await harness.fixture.whenStable();
      await pick(harness, 'Овсяное');

      addButton(el)?.click();
      http.expectOne('/api/cart/items').flush(
        {
          statusCode: 400,
          code: 'OPTIONS_INVALID',
          message: 'Option unavailable',
          errors: [{ code: 'OPTION_UNAVAILABLE', groupId: 'milk', optionId: 'oat' }],
        },
        { status: 400, statusText: 'Bad Request' },
      );
      const soldOut = COFFEE_GROUPS.map((g) =>
        g.id === 'milk'
          ? { ...g, options: g.options.map((o) => (o.id === 'oat' ? { ...o, available: false } : o)) }
          : g,
      );
      http.expectOne((r) => r.url === '/api/products/catalog-latte').flush({ ...CATALOG_LATTE, optionGroups: soldOut });
      await harness.fixture.whenStable();

      expect(text(el)).toContain('Этот выбор сейчас недоступен — проверьте варианты и добавки');
      expect(text(el.querySelector('[data-testid="option-hint"]'))).toBe('Нет в наличии: Овсяное');
      expect(addButton(el)?.disabled).toBe(true);
    });
  });
});
