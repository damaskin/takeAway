import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { StoreListItem } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { ActiveStoreService } from '../../core/catalog/active-store.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { DeliveryFeeApi } from '../../core/orders/delivery-fee.service';
import { OrdersApi } from '../../core/orders/orders.service';
import { PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { QrPaymentApi } from '../../core/payments/qr-payment.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { BonusesApi, PromoApi } from '../../core/promo/promo.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaCheckoutPage } from './checkout.page';

const MINUTE = 60_000;
/** HH:MM in UTC (the store's zone here) of the minute `at` rounds up to. */
const clock = (at: number) => new Date(Math.ceil(at / MINUTE) * MINUTE).toISOString().slice(11, 16);

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

function cart(patch: Partial<CartView>): CartView {
  return {
    id: 'cart-1',
    userId: 'user-1',
    storeId: STORE.id,
    subtotalCents: 4500,
    etaSeconds: 660,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'line-1',
        productId: 'americano',
        productName: 'Американо',
        quantity: 2,
        variationIds: [],
        modifiers: {},
        unitPriceCents: 2250,
        unitPrepSeconds: 180,
        notes: null,
      },
    ],
    ...patch,
  };
}

describe('TmaCheckoutPage under the order queue policy', () => {
  let catalog: Record<string, jest.Mock>;

  async function open(view: CartView) {
    const later = Date.now() + 60 * MINUTE;
    catalog = {
      listStores: jest.fn(() => of([STORE])),
      getStore: jest.fn(() => of(STORE)),
      getMenu: jest.fn(() => of({ storeId: STORE.id, storeSlug: STORE.slug, categories: [] })),
      getPickupSlots: jest.fn(() => of([])),
      getReadyWindows: jest.fn(() =>
        of([{ from: new Date(later).toISOString(), to: new Date(later + 2 * MINUTE).toISOString() }]),
      ),
      getSuggestions: jest.fn(() => throwError(() => new Error('404'))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'checkout', component: TmaCheckoutPage }]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TmaAuthStore, useValue: { isAuthenticated: signal(true) } },
        { provide: CartService, useValue: { load: jest.fn(() => of(view)) } },
        { provide: ActiveStoreService, useValue: { current: signal(STORE.id) } },
        { provide: CatalogService, useValue: catalog },
        { provide: OrdersApi, useValue: { create: jest.fn() } },
        { provide: DeliveryFeeApi, useValue: { quote: () => of({ feeCents: 0, distanceM: null, deliverable: true }) } },
        {
          provide: FeatureFlagsStore,
          useValue: {
            load: jest.fn(),
            cardPaymentFlow: signal('web'),
            cardPaymentsEnabled: signal(true),
            boundCardsEnabled: signal(false),
            webPaymentsEnabled: signal(true),
            qrPaymentCurrencies: signal([]),
          },
        },
        { provide: PaymentCardsApi, useValue: {} },
        { provide: PaymentCardsStore, useValue: { load: () => of([]) } },
        { provide: WebPaymentApi, useValue: { start: jest.fn() } },
        { provide: PromoApi, useValue: {} },
        { provide: BonusesApi, useValue: { list: () => of([]), isDismissed: () => false } },
        { provide: QrPaymentApi, useValue: { start: jest.fn() } },
        { provide: RealtimeService, useValue: { onStoreAvailabilityChanged: () => () => undefined } },
        {
          provide: TelegramBridgeService,
          useValue: {
            setBackButton: () => () => undefined,
            hideMainButton: () => undefined,
            setMainButton: () => undefined,
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
    return { page, root, texts, later };
  }

  it('says when the cart would be ready if ordered now', async () => {
    const readyAt = Date.now() + 11 * MINUTE;
    const { page, texts } = await open(
      cart({ readyAt: new Date(readyAt).toISOString(), asapAvailable: true, asapBlockedReason: null }),
    );

    expect(page.pickupMode()).toBe('ASAP');
    expect(texts('queue-ready')).toEqual([`Если закажете сейчас — будет готово в ${clock(readyAt)} · ≈ 11 мин`]);
  });

  it('offers the free windows when the cart would not be ready before the closing', async () => {
    const { page, root, texts, later } = await open(
      cart({
        readyAt: new Date(Date.now() + 20 * MINUTE).toISOString(),
        asapAvailable: false,
        asapBlockedReason: 'CLOSING_SOON',
      }),
    );

    expect(page.pickupMode()).toBe('SCHEDULED');
    const asap = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Сейчас'));
    expect(asap?.disabled).toBe(true);
    expect(texts('asap-blocked')).toEqual(['Не успеем до закрытия — выберите заказ ко времени']);
    expect(catalog['getPickupSlots']).not.toHaveBeenCalled();
    expect(catalog['getReadyWindows']).toHaveBeenCalledWith(STORE.id, 'cart-1');
    expect(page.scheduledAt()).toBe(new Date(later).toISOString());
  });
});
