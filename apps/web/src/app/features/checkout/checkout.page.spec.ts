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
  StoreDetail,
  StoreMenu,
  StoreSuggestions,
} from '@takeaway/shared-types';
import { type Observable, of, throwError } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { LoyaltyService, PromoService } from '../../core/loyalty/loyalty.service';
import { DeliveryFeeApi } from '../../core/orders/delivery-fee.service';
import { OrdersApi } from '../../core/orders/orders.service';
import { PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { CheckoutPage } from './checkout.page';

/** Today and tomorrow in UTC, the store's zone here, so the day headings are stable. */
const now = new Date();
const day = (offset: number, hours: number, minutes: number): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, hours, minutes)).toISOString();

const STORE: StoreDetail = {
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
  phone: null,
  email: null,
  minOrderCents: 0,
  galleryUrls: [],
  workingHours: [],
  brand: { id: 'brand-1', slug: 'noname', name: 'NoName', logoUrl: null, themeOverrides: null },
};

/** Closed for the night, opening at 09:00 tomorrow: pre-orders only. */
const NIGHT: StoreDetail = {
  ...STORE,
  openNow: false,
  asapBlockedReason: 'OUTSIDE_HOURS',
  opensAt: day(1, 9, 0),
};

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

const slot = (startsAt: string, available = true): PickupSlot => ({
  startsAt,
  endsAt: startsAt,
  taken: available ? 0 : 4,
  capacity: 4,
  available,
});

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

describe('CheckoutPage — pickup time', () => {
  let catalog: {
    getStore: jest.Mock;
    getPickupSlots: jest.Mock;
    cachedMenu: jest.Mock;
    getMenu: jest.Mock;
    getSuggestions: jest.Mock;
  };
  let orders: { create: jest.Mock };

  async function open(
    store: StoreDetail,
    opts: { menu?: StoreMenu; suggestions?: Observable<StoreSuggestions>; deliveryEnabled?: boolean } = {},
  ): Promise<{ page: CheckoutPage; root: HTMLElement; detect: () => void }> {
    catalog = {
      getStore: jest.fn(() => of(store)),
      getPickupSlots: jest.fn(() => of(SLOTS)),
      cachedMenu: jest.fn(() => opts.menu ?? { storeId: STORE.id, storeSlug: STORE.slug, categories: [] }),
      getMenu: jest.fn(),
      // An API from before the endpoint, unless a test gives an answer.
      getSuggestions: jest.fn(() => opts.suggestions ?? throwError(() => new Error('404'))),
    };
    orders = { create: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'checkout', component: CheckoutPage }]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal(null) } },
        { provide: CartService, useValue: { load: jest.fn(() => of(CART)) } },
        { provide: CatalogService, useValue: catalog },
        { provide: OrdersApi, useValue: orders },
        { provide: LoyaltyService, useValue: { me: () => of({ pointsBalance: 0 }) } },
        { provide: PromoService, useValue: {} },
        { provide: DeliveryFeeApi, useValue: { quote: () => of({ feeCents: 0, distanceM: null, deliverable: true }) } },
        {
          provide: FeatureFlagsStore,
          useValue: {
            load: jest.fn(),
            deliveryEnabled: signal(opts.deliveryEnabled ?? false),
            cardPaymentsEnabled: signal(true),
            boundCardsEnabled: signal(false),
            webPaymentsEnabled: signal(true),
          },
        },
        { provide: PaymentCardsApi, useValue: {} },
        { provide: PaymentCardsStore, useValue: { load: () => of([]) } },
        { provide: WebPaymentApi, useValue: { start: jest.fn() } },
        { provide: RealtimeService, useValue: { onStoreAvailabilityChanged: () => () => undefined } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/checkout?store=centre', CheckoutPage);
    harness.detectChanges();
    return { page, root: harness.routeNativeElement as HTMLElement, detect: () => harness.detectChanges() };
  }

  const text = (root: HTMLElement, testId: string): string[] =>
    Array.from(root.querySelectorAll(`[data-testid="${testId}"]`)).map((el) => el.textContent?.trim() ?? '');

  const asapButton = (root: HTMLElement): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Сейчас');

  const slotSelect = (root: HTMLElement): HTMLSelectElement | null =>
    root.querySelector<HTMLSelectElement>('[data-testid="slot-select"]');

  /** The picker's day groups, each with its windows as the customer reads them. */
  const slotGroups = (root: HTMLElement) =>
    Array.from(slotSelect(root)?.querySelectorAll('optgroup') ?? []).map((group) => ({
      day: group.label,
      options: Array.from(group.querySelectorAll('option')).map((o) => ({
        text: o.textContent?.trim(),
        disabled: o.disabled,
      })),
    }));

  it('takes a pre-order for tomorrow morning while the store is closed for the night', async () => {
    const { page, root } = await open(NIGHT);

    expect(page.mode()).toBe('SCHEDULED');
    expect(asapButton(root)?.disabled).toBe(true);
    expect(text(root, 'asap-blocked')).toEqual([
      'Точка откроется завтра в 09:00 — выберите, к какому времени приготовить заказ.',
    ]);
    // The windows are fitted to this cart, over 24 hours, grouped by day in one drop-down.
    expect(catalog.getPickupSlots).toHaveBeenCalledWith(STORE.id, CART.id);
    expect(slotGroups(root).map((g) => g.day)).toEqual(['Сегодня', 'Завтра']);
    expect(page.scheduledAt()).toBe(SLOTS[0]?.startsAt);
    expect(slotSelect(root)?.value).toBe(SLOTS[0]?.startsAt);
    // Checkout is not blocked: the store takes orders, just not for now.
    expect(root.querySelector('[data-testid="store-inactive"]')).toBeNull();

    page.selectSlot(SLOTS[1] as PickupSlot);
    expect(page.readyTimeLabel()).toBe('09:15 завтра');
    expect(page.canSubmit()).toBe(true);
  });

  it('switches to a time later when «Сейчас» was refused at payment', async () => {
    const { page, root, detect } = await open(STORE);
    expect(page.mode()).toBe('ASAP');
    expect(catalog.getPickupSlots).not.toHaveBeenCalled();

    orders.create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'ASAP_UNAVAILABLE', reason: 'QUEUE_FULL', opensAt: null },
          }),
      ),
    );
    page.placeOrder();
    detect();

    expect(page.mode()).toBe('SCHEDULED');
    expect(page.storeOpen()).toBe(false);
    expect(catalog.getPickupSlots).toHaveBeenCalledWith(STORE.id, CART.id);
    expect(text(root, 'asap-blocked')).toEqual([
      'Сейчас большая очередь — выберите, к какому времени приготовить заказ.',
    ]);
    expect(page.error()).toBe('На сейчас заказ уже не принять — выберите, к какому времени приготовить');
  });

  it('shows the windows again, with nothing chosen, when the chosen one filled up', async () => {
    const { page } = await open(NIGHT);
    page.selectSlot(SLOTS[2] as PickupSlot);
    catalog.getPickupSlots.mockReturnValue(of([SLOTS[0], SLOTS[1], slot(day(1, 9, 30), false)]));
    orders.create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'PICKUP_SLOT_FULL' } })),
    );

    page.placeOrder();

    expect(catalog.getPickupSlots).toHaveBeenCalledTimes(2);
    expect(page.scheduledAt()).toBe('');
    expect(page.canSubmit()).toBe(false);
    expect(page.error()).toBe('Это время только что заняли — выберите другое');
  });

  it('picks the window in a drop-down grouped by day, full windows listed but not selectable', async () => {
    const { page, root, detect } = await open(STORE);
    catalog.getPickupSlots.mockReturnValue(of([slot(day(0, 23, 30), false), ...SLOTS]));
    page.selectMode('SCHEDULED');
    detect();

    expect(slotGroups(root)).toEqual([
      {
        day: 'Сегодня',
        options: [
          { text: '23:30 — занято', disabled: true },
          { text: '23:45', disabled: false },
        ],
      },
      {
        day: 'Завтра',
        options: [
          { text: '09:15', disabled: false },
          { text: '09:30', disabled: false },
        ],
      },
    ]);
    // The first window the store can keep is preselected, not the full one.
    expect(slotSelect(root)?.value).toBe(SLOTS[0]?.startsAt);

    const select = slotSelect(root) as HTMLSelectElement;
    select.value = SLOTS[2]?.startsAt ?? '';
    select.dispatchEvent(new Event('change'));
    detect();
    expect(page.scheduledAt()).toBe(SLOTS[2]?.startsAt);
    expect(page.readyTimeLabel()).toBe('09:30 завтра');
  });

  it('asks to choose a time again when the chosen window filled up', async () => {
    const { page, root, detect } = await open(NIGHT);
    page.selectSlot(SLOTS[2] as PickupSlot);
    catalog.getPickupSlots.mockReturnValue(of([SLOTS[0], SLOTS[1], slot(day(1, 9, 30), false)]));
    orders.create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'PICKUP_SLOT_FULL' } })),
    );
    page.placeOrder();
    detect();

    const first = slotSelect(root)?.options[0];
    expect(first?.textContent?.trim()).toBe('Выберите время');
    expect(slotSelect(root)?.value).toBe('');
  });

  describe('pickup or delivery', () => {
    const toggle = (root: HTMLElement) => root.querySelector('[data-testid="fulfillment-toggle"]');
    const withDelivery: StoreDetail = { ...STORE, fulfillmentTypes: ['TAKEAWAY', 'DELIVERY'] };

    it('shows no «Самовывоз | Доставка» while delivery is switched off, even where the store offers it', async () => {
      const { page, root } = await open(withDelivery, { deliveryEnabled: false });
      expect(toggle(root)).toBeNull();
      expect(root.textContent).not.toContain('Доставка');
      page.selectFulfillment('DELIVERY');
      expect(page.fulfillmentType()).toBe('PICKUP');
    });

    it('shows no choice at a store without delivery', async () => {
      const { root } = await open(STORE, { deliveryEnabled: true });
      expect(toggle(root)).toBeNull();
    });

    it('offers delivery when it is switched on and the store delivers', async () => {
      const { page, root } = await open(withDelivery, { deliveryEnabled: true });
      expect(toggle(root)?.textContent).toContain('Доставка');
      page.selectFulfillment('DELIVERY');
      expect(page.fulfillmentType()).toBe('DELIVERY');
    });
  });

  describe('a kitchen pause and an imminent closing', () => {
    it('says until when the store is paused, and takes a pre-order', async () => {
      const { page, root } = await open({
        ...STORE,
        openNow: false,
        asapBlockedReason: 'PAUSED',
        pausedUntil: day(0, 23, 30),
      });
      expect(page.mode()).toBe('SCHEDULED');
      expect(asapButton(root)?.disabled).toBe(true);
      expect(text(root, 'asap-blocked')).toEqual([
        'В точке технический перерыв до 23:30 — выберите, к какому времени приготовить заказ.',
      ]);
    });

    it('says the store closes before an order for now would be ready', async () => {
      const { root } = await open({
        ...STORE,
        openNow: false,
        asapBlockedReason: 'CLOSING_SOON',
        closesAt: day(0, 23, 59),
      });
      expect(text(root, 'asap-blocked')).toEqual([
        'Точка закрывается в 23:59 — заказ «сейчас» уже не успеем приготовить. Выберите время.',
      ]);
    });

    it('switches to a time later when «Сейчас» was refused for a pause', async () => {
      const { page, root, detect } = await open(STORE);
      orders.create.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { code: 'ASAP_UNAVAILABLE', reason: 'PAUSED', opensAt: null, pausedUntil: day(0, 23, 30) },
            }),
        ),
      );
      page.placeOrder();
      detect();

      expect(page.mode()).toBe('SCHEDULED');
      expect(text(root, 'asap-blocked')).toEqual([
        'В точке технический перерыв до 23:30 — выберите, к какому времени приготовить заказ.',
      ]);
    });

    it('names the closing time from the store when refused as closing soon', async () => {
      const { page, root, detect } = await open({ ...STORE, closesAt: day(0, 23, 59) });
      orders.create.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { code: 'ASAP_UNAVAILABLE', reason: 'CLOSING_SOON', opensAt: null },
            }),
        ),
      );
      page.placeOrder();
      detect();

      expect(text(root, 'asap-blocked')).toEqual([
        'Точка закрывается в 23:59 — заказ «сейчас» уже не успеем приготовить. Выберите время.',
      ]);
    });
  });

  it('refuses checkout only when the store takes no orders at all', async () => {
    const { page, root } = await open({ ...NIGHT, acceptingOrders: false, opensAt: day(3, 9, 0) });
    expect(page.storeInactive()).toBe(true);
    expect(page.canSubmit()).toBe(false);
    expect(root.querySelector('[data-testid="store-inactive"]')).not.toBeNull();
    expect(text(root, 'asap-blocked')).toEqual([]);
  });

  it('keeps an API without the new fields as it was: ASAP while open', async () => {
    const older = { ...STORE } as Partial<StoreDetail>;
    delete older.asapBlockedReason;
    delete older.opensAt;
    delete older.closesAt;
    const { page, root } = await open(older as StoreDetail);
    expect(page.mode()).toBe('ASAP');
    expect(asapButton(root)?.disabled).toBe(false);
    expect(text(root, 'asap-blocked')).toEqual([]);
  });

  describe('suggestions under the basket', () => {
    const heading = (root: HTMLElement) => root.querySelector('[data-testid="upsell"] h2')?.textContent?.trim();
    const names = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('[data-testid="food-suggestion"] .name')).map((n) => n.textContent?.trim());

    it("says «Часто берут вместе» over what the store's customers bought with the basket", async () => {
      const { root } = await open(STORE, {
        menu: MENU,
        suggestions: of({ productIds: ['croissant'], source: 'copurchase' }),
      });
      expect(catalog.getSuggestions).toHaveBeenCalledWith(STORE.id, ['latte'], 6);
      expect(heading(root)).toBe('Часто берут вместе');
      expect(names(root)).toEqual(['Круассан']);
    });

    it('keeps «Добавить к напитку?» for the menu rule, and when the API cannot be asked', async () => {
      const ruled = await open(STORE, { menu: MENU, suggestions: of({ productIds: ['croissant'], source: 'rule' }) });
      expect(heading(ruled.root)).toBe('Добавить к напитку?');
      TestBed.resetTestingModule();

      const failed = await open(STORE, { menu: MENU });
      expect(heading(failed.root)).toBe('Добавить к напитку?');
      expect(names(failed.root)).toEqual(['Круассан']);
    });
  });
});
