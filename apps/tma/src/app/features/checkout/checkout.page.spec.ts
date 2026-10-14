import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PickupSlot, StoreListItem } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

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

describe('TmaCheckoutPage — pickup time', () => {
  let catalog: Record<string, jest.Mock>;
  let orders: { create: jest.Mock };
  let mainButton: { label: string; tap: () => void } | null;

  async function open(store: StoreListItem) {
    mainButton = null;
    catalog = {
      listStores: jest.fn(() => of([store])),
      getStore: jest.fn(() => of(store)),
      getMenu: jest.fn(() => of({ storeId: STORE.id, storeSlug: STORE.slug, categories: [] })),
      getPickupSlots: jest.fn(() => of(SLOTS)),
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
    return { page, root, texts, detect: () => harness.detectChanges() };
  }

  it('takes a pre-order for tomorrow morning while the store is closed for the night', async () => {
    const { page, root, texts } = await open(NIGHT);

    expect(page.pickupMode()).toBe('SCHEDULED');
    const asap = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Сейчас'));
    expect(asap?.disabled).toBe(true);
    expect(texts('asap-blocked')).toEqual([
      'Точка откроется завтра в 09:00 — выберите, к какому времени приготовить заказ.',
    ]);
    expect(catalog['getPickupSlots']).toHaveBeenCalledWith(STORE.id, CART.id);
    expect(texts('slot-day')).toEqual(['Сегодня', 'Завтра']);
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
});
