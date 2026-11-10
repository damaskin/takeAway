import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { StoreDetail } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { BonusesService } from '../../core/loyalty/bonuses.service';
import { LoyaltyService, PromoService } from '../../core/loyalty/loyalty.service';
import { DeliveryFeeApi } from '../../core/orders/delivery-fee.service';
import { OrdersApi } from '../../core/orders/orders.service';
import { PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { CheckoutPage } from './checkout.page';

const MINUTE = 60_000;
/** HH:MM in UTC (the store's zone here) of the minute `at` rounds up to. */
const clock = (at: number) => new Date(Math.ceil(at / MINUTE) * MINUTE).toISOString().slice(11, 16);

const STORE = {
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
} as StoreDetail;

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

describe('CheckoutPage under the order queue policy', () => {
  let catalog: Record<string, jest.Mock>;

  async function open(view: CartView) {
    const later = Date.now() + 60 * MINUTE;
    catalog = {
      getStore: jest.fn(() => of(STORE)),
      getPickupSlots: jest.fn(() => of([])),
      getReadyWindows: jest.fn(() =>
        of([{ from: new Date(later).toISOString(), to: new Date(later + 2 * MINUTE).toISOString() }]),
      ),
      cachedMenu: jest.fn(() => ({ storeId: STORE.id, storeSlug: STORE.slug, categories: [] })),
      getMenu: jest.fn(),
      getSuggestions: jest.fn(() => throwError(() => new Error('404'))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'checkout', component: CheckoutPage }]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal(null) } },
        { provide: CartService, useValue: { load: jest.fn(() => of(view)) } },
        { provide: CatalogService, useValue: catalog },
        { provide: OrdersApi, useValue: { create: jest.fn() } },
        { provide: LoyaltyService, useValue: { me: () => of({ pointsBalance: 0 }) } },
        { provide: PromoService, useValue: {} },
        { provide: BonusesService, useValue: { list: () => of([]), isDismissed: () => false } },
        { provide: DeliveryFeeApi, useValue: { quote: () => of({ feeCents: 0, distanceM: null, deliverable: true }) } },
        {
          provide: FeatureFlagsStore,
          useValue: {
            load: jest.fn(),
            deliveryEnabled: signal(false),
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
    return { page, root: harness.routeNativeElement as HTMLElement, later };
  }

  const text = (root: HTMLElement, testId: string): string[] =>
    Array.from(root.querySelectorAll(`[data-testid="${testId}"]`)).map((el) => el.textContent?.trim() ?? '');
  const asapButton = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Сейчас');

  it('says when the cart would be ready if ordered now: «Если закажете сейчас — будет готово в 12:11 · ≈ 11 мин»', async () => {
    const readyAt = Date.now() + 11 * MINUTE;
    const { page, root } = await open(
      cart({ readyAt: new Date(readyAt).toISOString(), asapAvailable: true, asapBlockedReason: null }),
    );

    expect(page.mode()).toBe('ASAP');
    expect(text(root, 'queue-ready')).toEqual([`Если закажете сейчас — будет готово в ${clock(readyAt)} · ≈ 11 мин`]);
    expect(page.readyTimeLabel()).toBe(clock(readyAt));
  });

  it('offers a time later when the cart would not be ready before the closing', async () => {
    const { page, root, later } = await open(
      cart({
        readyAt: new Date(Date.now() + 20 * MINUTE).toISOString(),
        asapAvailable: false,
        asapBlockedReason: 'CLOSING_SOON',
      }),
    );

    expect(page.mode()).toBe('SCHEDULED');
    expect(asapButton(root)?.disabled).toBe(true);
    expect(text(root, 'asap-blocked')).toEqual(['Не успеем до закрытия — выберите заказ ко времени']);
    expect(text(root, 'queue-ready')).toEqual([]);
    // The times come from the free windows, not the 15-minute slots.
    expect(catalog['getPickupSlots']).not.toHaveBeenCalled();
    expect(catalog['getReadyWindows']).toHaveBeenCalledWith(STORE.id, 'cart-1');
    expect(page.slots().map((s) => s.startsAt)[0]).toBe(new Date(later).toISOString());
    expect(page.scheduledAt()).toBe(new Date(later).toISOString());
  });

  it('keeps the old wording and the slots without the queue fields', async () => {
    const { page, root } = await open(cart({}));
    expect(text(root, 'queue-ready')).toEqual([]);
    page.selectMode('SCHEDULED');
    expect(catalog['getPickupSlots']).toHaveBeenCalled();
    expect(catalog['getReadyWindows']).not.toHaveBeenCalled();
  });
});
