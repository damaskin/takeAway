import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type {
  CategoryKind,
  PickupSlot,
  ProductSummary,
  StoreListItem,
  StoreMenu,
  StoreSuggestions,
} from '@takeaway/shared-types';
import { type Observable, of, throwError } from 'rxjs';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { ActiveStoreService } from '../../core/catalog/active-store.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { DeliveryFeeApi } from '../../core/orders/delivery-fee.service';
import { OrdersApi } from '../../core/orders/orders.service';
import { PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaCheckoutPage } from './checkout.page';

/** Today and tomorrow in UTC, the store's zone here, so the day headings are stable. */
const now = new Date();
const day = (offset: number, hours: number, minutes: number): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, hours, minutes)).toISOString();

const STORE: StoreListItem = {
  id: 'store-1',
  brandId: 'brand-1',
  slug: 'centre',
  name: 'NoName Centre',
  addressLine: 'Ленина 1',
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
  asapBlockedReason: null,
  opensAt: null,
  closesAt: null,
  taxRateBps: 0,
  taxIncludedInPrice: true,
  currency: 'RUP',
  timezone: 'UTC',
  heroImageUrl: null,
  distanceMeters: null,
};

const NIGHT: StoreListItem = { ...STORE, openNow: false, asapBlockedReason: 'OUTSIDE_HOURS', opensAt: day(1, 9, 0) };

const CART: CartView = {
  id: 'cart-1',
  userId: 'user-1',
  storeId: STORE.id,
  subtotalCents: 4500,
  etaSeconds: 300,
  updatedAt: now.toISOString(),
  items: [
    {
      id: 'line-1',
      productId: 'latte',
      productName: 'Латте',
      quantity: 1,
      variationIds: [],
      modifiers: {},
      unitPriceCents: 4500,
      unitPrepSeconds: 180,
      notes: null,
    },
  ],
};

const slot = (startsAt: string): PickupSlot => ({ startsAt, endsAt: startsAt, taken: 0, capacity: 4, available: true });
const SLOTS = [slot(day(0, 23, 45)), slot(day(1, 9, 15)), slot(day(1, 9, 30))];

/** A latte and a croissant: a menu with something to eat next to the drink. */
const MENU: StoreMenu = {
  storeId: STORE.id,
  storeSlug: STORE.slug,
  categories: [
    { ...category('coffee', 'HOT_DRINKS'), products: [summary('latte', 'Латте', 'coffee')] },
    { ...category('pastry', 'BAKERY'), products: [summary('croissant', 'Круассан', 'pastry')] },
  ],
};

function category(id: string, kind: CategoryKind) {
  return {
    id,
    slug: id,
    name: id,
    description: null,
    iconUrl: null,
    sortOrder: 0,
    availableFrom: null,
    availableTo: null,
    kind,
  };
}

function summary(id: string, name: string, categoryId: string): ProductSummary {
  return {
    id,
    categoryId,
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

describe('TmaCheckoutPage — pickup time', () => {
  let catalog: Record<string, jest.Mock>;
  let orders: { create: jest.Mock };
  let mainButton: { label: string; tap: () => void } | null;
  /** The windows the API offers; reset to {@link SLOTS} after each test. */
  let catalogSlots: PickupSlot[] = SLOTS;

  afterEach(() => (catalogSlots = SLOTS));

  async function open(
    store: StoreListItem,
    opts: { menu?: StoreMenu; suggestions?: Observable<StoreSuggestions> } = {},
  ) {
    mainButton = null;
    catalog = {
      listStores: jest.fn(() => of([store])),
      getStore: jest.fn(() => of(store)),
      getMenu: jest.fn(() => of(opts.menu ?? { storeId: STORE.id, storeSlug: STORE.slug, categories: [] })),
      getPickupSlots: jest.fn(() => of(catalogSlots)),
      // An API from before the endpoint, unless a test gives an answer.
      getSuggestions: jest.fn(() => opts.suggestions ?? throwError(() => new Error('404'))),
    };
    orders = { create: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'checkout', component: TmaCheckoutPage }]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TmaAuthStore, useValue: { isAuthenticated: signal(true) } },
        { provide: CartService, useValue: { load: jest.fn(() => of(CART)) } },
        { provide: ActiveStoreService, useValue: { current: signal(STORE.id) } },
        { provide: CatalogService, useValue: catalog },
        { provide: OrdersApi, useValue: orders },
        { provide: DeliveryFeeApi, useValue: { quote: () => of({ feeCents: 0, distanceM: null, deliverable: true }) } },
        {
          provide: FeatureFlagsStore,
          useValue: {
            load: jest.fn(),
            cardPaymentFlow: signal('web'),
            cardPaymentsEnabled: signal(true),
            boundCardsEnabled: signal(false),
            webPaymentsEnabled: signal(true),
          },
        },
        { provide: PaymentCardsApi, useValue: {} },
        { provide: PaymentCardsStore, useValue: { load: () => of([]) } },
        { provide: WebPaymentApi, useValue: { start: jest.fn() } },
        { provide: RealtimeService, useValue: { onStoreAvailabilityChanged: () => () => undefined } },
        {
          provide: TelegramBridgeService,
          useValue: {
            setBackButton: () => () => undefined,
            hideMainButton: () => (mainButton = null),
            setMainButton: (label: string, tap: () => void) => (mainButton = { label, tap }),
            haptic: () => undefined,
            openLink: () => undefined,
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/checkout', TmaCheckoutPage);
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    const texts = (testId: string): string[] =>
      Array.from(root.querySelectorAll(`[data-testid="${testId}"]`)).map((el) => el.textContent?.trim() ?? '');
    /** The day groups of the time picker: «Сегодня», «Завтра». */
    const days = (): string[] =>
      Array.from(root.querySelectorAll('[data-testid="slot-day"]')).map((el) => el.getAttribute('label') ?? '');
    return { page, root, texts, days, detect: () => harness.detectChanges() };
  }

  it('takes a pre-order for tomorrow morning while the store is closed for the night', async () => {
    const { page, root, texts, days } = await open(NIGHT);

    expect(page.pickupMode()).toBe('SCHEDULED');
    const asap = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Сейчас'));
    expect(asap?.disabled).toBe(true);
    expect(texts('asap-blocked')).toEqual([
      'Точка откроется завтра в 09:00 — выберите, к какому времени приготовить заказ.',
    ]);
    expect(catalog['getPickupSlots']).toHaveBeenCalledWith(STORE.id, CART.id);
    expect(days()).toEqual(['Сегодня', 'Завтра']);
    // The Telegram main button is there: the order can be paid for now.
    expect(mainButton?.label).toContain('Оплатить');
    expect(page.pickupTimeLabel(day(1, 9, 15))).toBe('09:15 завтра');
  });

  it('switches to a time later when «Сейчас» was refused at payment', async () => {
    const { page, texts, detect } = await open(STORE);
    expect(page.pickupMode()).toBe('ASAP');
    orders.create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'ASAP_UNAVAILABLE', reason: 'OUTSIDE_HOURS', opensAt: day(1, 9, 0) },
          }),
      ),
    );

    mainButton?.tap();
    detect();

    expect(page.pickupMode()).toBe('SCHEDULED');
    expect(catalog['getPickupSlots']).toHaveBeenCalledWith(STORE.id, CART.id);
    expect(texts('asap-blocked')).toEqual([
      'Точка откроется завтра в 09:00 — выберите, к какому времени приготовить заказ.',
    ]);
    expect(page.error()).toBe('На сейчас заказ уже не принять — выберите, к какому времени приготовить');
  });

  it('offers the windows in one native picker, by day, with the full ones greyed out', async () => {
    catalogSlots = [slot(day(1, 9, 0)), { ...slot(day(1, 9, 15)), available: false }, slot(day(1, 9, 30))];
    const { page, root, days, detect } = await open(NIGHT);
    const select = root.querySelector<HTMLSelectElement>('[data-testid="slot-select"]');
    if (!select) throw new Error('no time picker');

    expect(days()).toEqual(['Завтра']);
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((o) => [o.textContent?.trim(), o.disabled])).toEqual([
      ['09:00', false],
      ['09:15 — занято', true],
      ['09:30', false],
    ]);
    // The first free window is picked already: the pay button is up.
    expect(page.scheduledAt()).toBe(day(1, 9, 0));
    expect(select.value).toBe(day(1, 9, 0));
    expect(mainButton?.label).toContain('Оплатить');

    select.value = day(1, 9, 30);
    select.dispatchEvent(new Event('change'));
    detect();
    expect(page.scheduledAt()).toBe(day(1, 9, 30));

    // A full window is never taken, whatever the picker sends.
    page.pickSlot(day(1, 9, 15));
    expect(page.scheduledAt()).toBe(day(1, 9, 30));
  });

  it('says the kitchen is on a break until when, and takes a pre-order meanwhile', async () => {
    const { page, texts } = await open({
      ...STORE,
      openNow: false,
      asapBlockedReason: 'PAUSED',
      pausedUntil: day(0, 12, 30),
      pauseReason: 'EQUIPMENT',
    });
    expect(page.pickupMode()).toBe('SCHEDULED');
    expect(texts('asap-blocked')).toEqual([
      'В точке технический перерыв до 12:30 — выберите, к какому времени приготовить заказ.',
    ]);
  });

  it('switches to a time later when «Сейчас» was refused because the store closes soon', async () => {
    const { page, texts, detect } = await open(STORE);
    orders.create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'ASAP_UNAVAILABLE', reason: 'CLOSING_SOON', closesAt: day(0, 21, 0) },
          }),
      ),
    );

    mainButton?.tap();
    detect();

    expect(page.pickupMode()).toBe('SCHEDULED');
    expect(texts('asap-blocked')).toEqual([
      'Точка закрывается в 21:00 — заказ «сейчас» уже не успеем приготовить. Выберите время.',
    ]);
  });

  it('asks for a new time when the chosen window filled up', async () => {
    const { page } = await open(NIGHT);
    orders.create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'PICKUP_SLOT_FULL' } })),
    );
    catalog['getPickupSlots']?.mockReturnValue(of([{ ...slot(day(0, 23, 45)), available: false }, SLOTS[1]]));

    mainButton?.tap();

    expect(page.scheduledAt()).toBe('');
    // No time chosen: nothing to pay for until the customer picks one.
    expect(mainButton).toBeNull();
  });

  describe('suggestions under the basket', () => {
    const heading = (root: HTMLElement) => root.querySelector('[data-testid="upsell"] .title')?.textContent?.trim();

    it("says «Часто берут вместе» over what the store's customers bought with the basket", async () => {
      const { root } = await open(STORE, {
        menu: MENU,
        suggestions: of({ productIds: ['croissant'], source: 'copurchase' }),
      });
      expect(catalog['getSuggestions']).toHaveBeenCalledWith(STORE.id, ['latte'], 6);
      expect(heading(root)).toBe('Часто берут вместе');
    });

    it('keeps «Добавить к напитку?» when the API cannot be asked', async () => {
      const { root } = await open(STORE, { menu: MENU });
      expect(heading(root)).toBe('Добавить к напитку?');
    });
  });
});
