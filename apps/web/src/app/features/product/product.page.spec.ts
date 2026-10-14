import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { ProductDetail, StoreListItem, StoreMenu } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { AuthStore } from '../../core/auth/auth.store';
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
    caffeineLevel: null,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    allergens: [],
    dietTags: [],
    imageUrls: [],
    sortOrder: 0,
    variations: [],
    modifiers: [],
    ...over,
  };
}

const LATTE = product('latte', {
  name: 'Латте',
  caffeineLevel: 2,
  allergens: ['MILK', 'орехи'],
  variations: [
    { id: 'm', type: 'SIZE', name: 'M', priceDeltaCents: 0, prepTimeDeltaSeconds: 0, sortOrder: 0, isDefault: true },
    { id: 'l', type: 'SIZE', name: 'L', priceDeltaCents: 500, prepTimeDeltaSeconds: 0, sortOrder: 1, isDefault: false },
  ],
});

const CROISSANT = product('croissant', {
  name: 'Круассан',
  categoryId: 'pastry',
  categoryKind: 'BAKERY',
  // As a POS might send it: a level on something that has none.
  caffeineLevel: 1,
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

  async function open(slug: string, detail: ProductDetail) {
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
    return harness;
  }

  afterEach(() => http.verify());

  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('asks a drink for a note to the barista and shows its caffeine and allergens', async () => {
    const harness = await open('latte', LATTE);
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('label[for="pdp-notes"]'))).toBe('Пожелание бариста');
    expect(text(el)).toContain('Кофеин');
    const chips = Array.from(el.querySelectorAll('[data-testid="allergens"] .pdp-chip')).map(text);
    expect(chips).toEqual(['Молоко', 'орехи']);
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

  it('treats bakery as food: no caffeine, a plain order note, its own placeholder, nothing paired', async () => {
    const harness = await open('croissant', CROISSANT);
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('label[for="pdp-notes"]'))).toBe('Комментарий к заказу');
    expect(text(el)).not.toContain('Кофеин');
    expect(el.querySelector('lib-product-image img')?.getAttribute('src')).toBe(
      '/ui-kit/product-placeholders/bakery.svg',
    );
    expect(el.querySelector('[data-testid="food-suggestion"]')).toBeNull();
  });
});
