import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { ProductDetail, StoreListItem } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService } from '../../core/cart/cart.service';
import { ActiveStoreService } from '../../core/catalog/active-store.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { COFFEE_GROUPS } from './option-groups.testing';
import { TmaProductPage } from './product.page';

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

function product(over: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 'latte',
    brandId: 'brand-1',
    categoryId: 'coffee',
    slug: 'latte',
    name: 'Латте',
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

describe('TmaProductPage', () => {
  let tg: { setMainButton: jest.Mock; hideMainButton: jest.Mock; setBackButton: jest.Mock; haptic: jest.Mock };
  let cart: { add: jest.Mock };

  async function open(detail: ProductDetail) {
    tg = {
      setMainButton: jest.fn(),
      hideMainButton: jest.fn(),
      setBackButton: jest.fn(() => () => undefined),
      haptic: jest.fn(),
    };
    cart = { add: jest.fn(() => of({ id: 'cart-1', storeId: STORE.id, items: [], subtotalCents: 0 })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'products/:slug', component: TmaProductPage },
          { path: 'checkout', children: [] },
        ]),
        provideTranslateService({ fallbackLang: 'ru' }),
        {
          provide: CatalogService,
          useValue: {
            getProduct: jest.fn(() => of(detail)),
            listStores: jest.fn(() => of([STORE])),
            getMenu: jest.fn(() => of({ storeId: STORE.id, storeSlug: STORE.slug, categories: [] })),
            getSuggestions: jest.fn(() => throwError(() => new Error('404'))),
          },
        },
        { provide: CartService, useValue: cart },
        { provide: TelegramBridgeService, useValue: tg },
        { provide: TmaAuthStore, useValue: { isAuthenticated: signal(true) } },
        { provide: ActiveStoreService, useValue: { current: signal(STORE.id) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/products/${detail.slug}`);
    await harness.fixture.whenStable();
    return harness;
  }

  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  /** Telegram's main button as last set: its label, its action, and whether it can be tapped. */
  const mainButton = () => {
    const [label, tap, enabled] = tg.setMainButton.mock.calls.at(-1) as [string, () => void, boolean | undefined];
    return { label, tap, enabled: enabled !== false };
  };

  // Maxim 2026-11-11: the brand fills protein / fat / carbs, the buyer saw only kcal.
  it('shows the calories and the filled macros of a meal', async () => {
    const harness = await open(
      product({
        id: 'shawarma',
        slug: 'shawarma',
        name: 'Шаурма',
        categoryKind: 'FOOD',
        calories: 540,
        proteinsGrams: 24,
        fatsGrams: null,
        carbsGrams: 41.5,
      }),
    );
    const el = harness.routeNativeElement as HTMLElement;

    expect(text(el.querySelector('[data-testid="product-kcal"]'))).toBe('🔥 540 ккал');
    expect(text(el.querySelector('[data-testid="product-macros"]'))).toBe('Белки 24 г · Углеводы 41.5 г');
  });

  it('shows no nutrition for a drink, whatever the API sends', async () => {
    const harness = await open(
      product({ categoryKind: 'HOT_DRINKS', calories: 150, proteinsGrams: 8, fatsGrams: 6, carbsGrams: 12 }),
    );
    const el = harness.routeNativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="product-kcal"]')).toBeNull();
    expect(el.querySelector('[data-testid="product-macros"]')).toBeNull();
  });

  it('keeps Telegram’s button inert, saying what to choose, until a size is picked', async () => {
    const harness = await open(product({ hasRequiredOptions: true, optionGroups: COFFEE_GROUPS }));
    const el = harness.routeNativeElement as HTMLElement;

    expect(mainButton()).toMatchObject({ label: 'Выберите: Размер (кофе)', enabled: false });
    expect(text(el.querySelector('[data-testid="option-hint"]'))).toBe('Выберите: Размер (кофе)');
    mainButton().tap();
    expect(cart.add).not.toHaveBeenCalled();

    Array.from(el.querySelectorAll('[data-testid="option-row"]'))
      .find((r) => text(r.querySelector('.name')) === 'L')
      ?.querySelector<HTMLInputElement>('input')
      ?.click();
    await harness.fixture.whenStable();

    expect(mainButton().enabled).toBe(true);
    expect(mainButton().label).toMatch(/^Добавить · 37\s?руб\.$/);
    expect(text(el.querySelector('[data-testid="choice-summary"]'))).toMatch(/^L, Горячий · Коровье\s?37\s?руб\.$/);

    mainButton().tap();
    expect(cart.add).toHaveBeenCalledWith({
      storeId: STORE.id,
      productId: 'latte',
      quantity: 1,
      options: [
        { optionId: 'cow', qty: 1 },
        { optionId: 'hot', qty: 1 },
        { optionId: 'l', qty: 1 },
      ],
      notes: undefined,
    });
  });

  it('keeps a product on its older options as it was: the button live at once', async () => {
    await open(
      product({
        variations: [
          {
            id: 'm',
            type: 'SIZE',
            name: 'M',
            priceDeltaCents: 0,
            prepTimeDeltaSeconds: 0,
            sortOrder: 0,
            isDefault: true,
          },
        ],
      }),
    );

    expect(mainButton().enabled).toBe(true);
    expect(mainButton().label).toMatch(/^Добавить · 30\s?руб\.$/);
    mainButton().tap();
    expect(cart.add).toHaveBeenCalledWith({
      storeId: STORE.id,
      productId: 'latte',
      quantity: 1,
      variationIds: ['m'],
      modifiers: {},
      notes: undefined,
    });
  });
});
