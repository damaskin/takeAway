import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { CustomerBonus, StoreListItem, ValidPromoResult, ValidatePromoInput } from '@takeaway/shared-types';
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
import { BonusesApi, PromoApi } from '../../core/promo/promo.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaCheckoutPage } from './checkout.page';

/**
 * «Акции takeAway» in the Mini App's checkout (docs/takeaway-promos.md §5):
 * the promo field works, the welcome bonus goes in by itself and «Убрать»
 * keeps it off the cart.
 */

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

function cart(quantity = 1): CartView {
  return {
    id: 'cart-1',
    userId: 'user-1',
    storeId: STORE.id,
    subtotalCents: 4500 * quantity,
    etaSeconds: 300,
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'line-1',
        productId: 'latte',
        productName: 'Латте',
        quantity,
        variationIds: [],
        modifiers: {},
        unitPriceCents: 4500,
        unitPrepSeconds: 180,
        notes: null,
      },
    ],
  };
}

const WELCOME: CustomerBonus = {
  id: 'bonus-1',
  kind: 'WELCOME',
  promoId: 'promo-1',
  code: 'WELCOME10',
  name: 'Приветственный бонус',
  percent: 10,
  currency: 'RUP',
  expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
};

/** The API's answer for a takeAway code: the percent of the subtotal, half up. */
function takeaway(input: ValidatePromoInput, percent: number, isWelcome: boolean): ValidPromoResult {
  return {
    valid: true,
    reason: null,
    reasonCode: null,
    promo: null,
    source: 'TAKEAWAY',
    takeawayPromo: { id: `tp-${input.code}`, code: input.code, name: input.code, percent, isWelcome },
    discountCents: Math.floor((input.subtotalCents * percent + 50) / 100),
    pointsMultiplier: 1,
  };
}

function firstLine(page: TmaCheckoutPage) {
  const line = page.cart()?.items[0];
  if (!line) throw new Error('the cart has no lines');
  return line;
}

describe('TmaCheckoutPage — promo code and the welcome bonus', () => {
  let validate: jest.Mock;
  let orders: { create: jest.Mock };
  let dismissed: Set<string>;
  let mainButton: { label: string; tap: () => void } | null;

  async function open(opts: { bonuses?: CustomerBonus[]; answer?: jest.Mock } = {}) {
    dismissed = new Set();
    mainButton = null;
    validate = opts.answer ?? jest.fn((input: ValidatePromoInput) => of(takeaway(input, 10, true)));
    orders = { create: jest.fn(() => of({ id: 'order-1' })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'checkout', component: TmaCheckoutPage },
          { path: 'orders/:id', children: [] },
        ]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TmaAuthStore, useValue: { isAuthenticated: signal(true) } },
        {
          provide: CartService,
          useValue: {
            load: jest.fn(() => of(cart())),
            updateQuantity: jest.fn((_id: string, quantity: number) => of(cart(quantity))),
          },
        },
        { provide: ActiveStoreService, useValue: { current: signal(STORE.id) } },
        {
          provide: CatalogService,
          useValue: {
            listStores: jest.fn(() => of([STORE])),
            getStore: jest.fn(() => of(STORE)),
            getMenu: jest.fn(() => of({ storeId: STORE.id, storeSlug: STORE.slug, categories: [] })),
            getPickupSlots: jest.fn(() => of([])),
            getSuggestions: jest.fn(() => throwError(() => new Error('404'))),
          },
        },
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
        { provide: WebPaymentApi, useValue: { start: jest.fn(() => of({ page: null })) } },
        { provide: PromoApi, useValue: { validate } },
        {
          provide: BonusesApi,
          useValue: {
            list: () => of(opts.bonuses ?? []),
            dismiss: (cartId: string) => dismissed.add(cartId),
            isDismissed: (cartId: string) => dismissed.has(cartId),
          },
        },
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
    const byTestId = <T extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<T>(`[data-testid="${id}"]`);
    const textOf = (id: string) => byTestId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const type = (value: string) => {
      const input = byTestId<HTMLInputElement>('promo-input');
      if (!input) throw new Error('no promo field');
      input.value = value;
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();
    };
    return { page, byTestId, textOf, type, detect: () => harness.detectChanges() };
  }

  it('puts the welcome bonus on by itself, for the cart’s store, and the pay button shows the new total', async () => {
    const { byTestId, textOf } = await open({ bonuses: [WELCOME] });

    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith({
      code: 'WELCOME10',
      brandId: 'brand-1',
      subtotalCents: 4500,
      storeId: 'store-1',
    });
    expect(byTestId<HTMLInputElement>('promo-input')?.value).toBe('WELCOME10');
    expect(textOf('promo-status')).toBe('Приветственный бонус −10%');
    expect(textOf('promo-apply')).toBe('Убрать');
    expect(textOf('promo-line')).toMatch(/^Приветственный бонус −10%\s*− 4,50/);
    expect(mainButton?.label).toMatch(/^Оплатить 40,50/);
  });

  it('sends the code with the order', async () => {
    await open({ bonuses: [WELCOME] });
    mainButton?.tap();
    expect(orders.create).toHaveBeenCalledWith(expect.objectContaining({ couponCode: 'WELCOME10' }));
  });

  it('keeps the bonus off the cart once the customer removed it', async () => {
    const { page, byTestId, detect } = await open({ bonuses: [WELCOME] });

    byTestId<HTMLButtonElement>('promo-apply')?.click();
    detect();

    expect(dismissed.has('cart-1')).toBe(true);
    expect(page.promoCode()).toBeNull();
    expect(byTestId<HTMLInputElement>('promo-input')?.value).toBe('');
    expect(byTestId('promo-line')).toBeNull();
    expect(mainButton?.label).toMatch(/^Оплатить 45/);

    page.changeQuantity(firstLine(page), 1);
    detect();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(page.promoCode()).toBeNull();

    mainButton?.tap();
    expect(orders.create).toHaveBeenCalledWith(expect.objectContaining({ couponCode: undefined }));
  });

  it('checks the applied code again for a changed basket', async () => {
    const { page, detect } = await open({ bonuses: [WELCOME] });

    page.changeQuantity(firstLine(page), 1);
    detect();

    expect(validate).toHaveBeenCalledTimes(2);
    expect(validate).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'WELCOME10', subtotalCents: 9000 }));
    expect(page.discountCents()).toBe(900);
    expect(mainButton?.label).toMatch(/^Оплатить 81/);
  });

  it('leaves the bonus out at a store in another currency', async () => {
    const { page } = await open({ bonuses: [{ ...WELCOME, currency: 'MDL' }] });
    expect(validate).not.toHaveBeenCalled();
    expect(page.promoInput()).toBe('');
  });

  it('applies a takeAway code typed by hand as «Акция takeAway −15%»', async () => {
    const answer = jest.fn((input: ValidatePromoInput) => of(takeaway(input, 15, false)));
    const { byTestId, textOf, type, detect } = await open({ answer });

    type('autumn15');
    byTestId<HTMLButtonElement>('promo-apply')?.click();
    detect();

    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTUMN15', storeId: 'store-1' }));
    expect(textOf('promo-status')).toBe('Акция takeAway −15%');
    expect(textOf('promo-apply')).toBe('Убрать');
  });

  it('says a takeAway promo does not work at this venue', async () => {
    const answer = jest.fn(() =>
      of({
        valid: false,
        reason: 'no',
        reasonCode: 'PROMO_NOT_HERE' as const,
        promo: null,
        source: null,
        discountCents: 0,
        pointsMultiplier: 1,
      }),
    );
    const { byTestId, textOf, type, detect } = await open({ answer });
    type('AUTUMN15');
    byTestId<HTMLButtonElement>('promo-apply')?.click();
    detect();

    expect(textOf('promo-status')).toBe('Акция не действует в этом заведении');
    expect(byTestId('promo-line')).toBeNull();
  });
});
