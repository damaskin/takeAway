import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PickupSlot, StoreDetail } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

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

describe('CheckoutPage — pickup time', () => {
  let catalog: { getStore: jest.Mock; getPickupSlots: jest.Mock; cachedMenu: jest.Mock; getMenu: jest.Mock };
  let orders: { create: jest.Mock };

  async function open(store: StoreDetail): Promise<{ page: CheckoutPage; root: HTMLElement; detect: () => void }> {
    catalog = {
      getStore: jest.fn(() => of(store)),
      getPickupSlots: jest.fn(() => of(SLOTS)),
      cachedMenu: jest.fn(() => ({ storeId: STORE.id, storeSlug: STORE.slug, categories: [] })),
      getMenu: jest.fn(),
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

  it('takes a pre-order for tomorrow morning while the store is closed for the night', async () => {
    const { page, root } = await open(NIGHT);

    expect(page.mode()).toBe('SCHEDULED');
    expect(asapButton(root)?.disabled).toBe(true);
    expect(text(root, 'asap-blocked')).toEqual([
      'Точка откроется завтра в 09:00 — выберите, к какому времени приготовить заказ.',
    ]);
    // The windows are fitted to this cart, over 24 hours, under day headings.
    expect(catalog.getPickupSlots).toHaveBeenCalledWith(STORE.id, CART.id);
    expect(text(root, 'slot-day')).toEqual(['Сегодня', 'Завтра']);
    expect(page.scheduledAt()).toBe(SLOTS[0]?.startsAt);
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
});
