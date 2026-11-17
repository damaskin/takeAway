import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { CustomerBonus, StoreDetail, ValidPromoResult } from '@takeaway/shared-types';
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
import { QrPaymentApi } from '../../core/payments/qr-payment.service';

/**
 * «Акции takeAway» at checkout (docs/takeaway-promos.md §5): the welcome
 * bonus goes on by itself and «Убрать» keeps it off the cart. Any promo code
 * turns «Оплатить баллами» off (the loyalty spec: one or the other), and
 * points read with their kopecks — 1 балл = 1 руб. = 100 API units.
 */

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

/** What the API answers for a takeAway code: 10 % of the subtotal, half up. */
function takeawayAnswer(code: string, percent: number, isWelcome: boolean, subtotalCents: number): ValidPromoResult {
  return {
    valid: true,
    reason: null,
    reasonCode: null,
    promo: null,
    source: 'TAKEAWAY',
    takeawayPromo: { id: `tp-${code}`, code, name: code, percent, isWelcome },
    discountCents: Math.floor((subtotalCents * percent + 50) / 100),
    pointsMultiplier: 1,
  };
}

/** What the API answers for a brand's own code worth `discountCents`. */
function brandAnswer(discountCents: number): ValidPromoResult {
  return {
    valid: true,
    reason: null,
    reasonCode: null,
    promo: null,
    source: 'BRAND',
    discountCents,
    pointsMultiplier: 1,
  };
}

function refusal(reasonCode: ValidPromoResult['reasonCode']): ValidPromoResult {
  return {
    valid: false,
    reason: 'no',
    reasonCode,
    promo: null,
    source: null,
    discountCents: 0,
    pointsMultiplier: 1,
  };
}

function firstLine(page: CheckoutPage) {
  const line = page.cart()?.items[0];
  if (!line) throw new Error('the cart has no lines');
  return line;
}

describe('CheckoutPage — takeAway promos and the welcome bonus', () => {
  let validate: jest.Mock;
  let orders: { create: jest.Mock };
  let cartService: { load: jest.Mock; updateQuantity: jest.Mock };
  let quote: jest.Mock;
  let dismissed: Set<string>;

  async function open(
    opts: { bonuses?: CustomerBonus[]; points?: number; answer?: typeof validate; quoteAnswer?: jest.Mock } = {},
  ) {
    dismissed = new Set();
    validate =
      opts.answer ??
      jest.fn((code: string, _brand: string, subtotal: number) => of(takeawayAnswer(code, 10, true, subtotal)));
    orders = { create: jest.fn(() => of({ id: 'order-1' })) };
    cartService = { load: jest.fn(() => of(cart())), updateQuantity: jest.fn((_id: string, q: number) => of(cart(q))) };
    quote =
      opts.quoteAnswer ??
      jest.fn((points: number) =>
        of({ points, discountCents: points, balance: opts.points ?? 0, pointValueCents: 1, minPoints: 100 }),
      );
    TestBed.configureTestingModule({
      providers: [
        // The order page is where a placed order goes; nothing to show of it here.
        provideRouter([
          { path: 'checkout', component: CheckoutPage },
          { path: 'orders/:id', children: [] },
        ]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal(null) } },
        { provide: CartService, useValue: cartService },
        {
          provide: CatalogService,
          useValue: {
            getStore: jest.fn(() => of(STORE)),
            getPickupSlots: jest.fn(() => of([])),
            cachedMenu: jest.fn(() => ({ storeId: STORE.id, storeSlug: STORE.slug, categories: [] })),
            getMenu: jest.fn(),
            getSuggestions: jest.fn(() => throwError(() => new Error('404'))),
          },
        },
        { provide: OrdersApi, useValue: orders },
        {
          provide: LoyaltyService,
          useValue: { me: () => of({ pointsBalance: opts.points ?? 0 }), quoteRedemption: quote },
        },
        { provide: PromoService, useValue: { validate } },
        {
          provide: BonusesService,
          useValue: {
            list: () => of(opts.bonuses ?? []),
            dismiss: (cartId: string) => dismissed.add(cartId),
            isDismissed: (cartId: string) => dismissed.has(cartId),
          },
        },
        { provide: DeliveryFeeApi, useValue: { quote: () => of({ feeCents: 0, distanceM: null, deliverable: true }) } },
        {
          provide: FeatureFlagsStore,
          useValue: {
            load: jest.fn(),
            deliveryEnabled: signal(false),
            cardPaymentsEnabled: signal(true),
            boundCardsEnabled: signal(false),
            webPaymentsEnabled: signal(true),
            qrPaymentCurrencies: signal([]),
          },
        },
        { provide: PaymentCardsApi, useValue: {} },
        { provide: PaymentCardsStore, useValue: { load: () => of([]) } },
        { provide: QrPaymentApi, useValue: { start: jest.fn() } },
        { provide: WebPaymentApi, useValue: { start: jest.fn(() => of({ page: null })) } },
        { provide: RealtimeService, useValue: { onStoreAvailabilityChanged: () => () => undefined } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/checkout?store=centre', CheckoutPage);
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    const byTestId = <T extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<T>(`[data-testid="${id}"]`);
    const textOf = (id: string) => byTestId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    return { page, root, byTestId, textOf, detect: () => harness.detectChanges() };
  }

  it('puts the welcome bonus on by itself, for the cart’s store', async () => {
    const { page, byTestId, textOf } = await open({ bonuses: [WELCOME] });

    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith('WELCOME10', 'brand-1', 4500, 'store-1');
    expect(byTestId<HTMLInputElement>('promo-input')?.value).toBe('WELCOME10');
    expect(textOf('promo-status')).toBe('Приветственный бонус −10%');
    expect(textOf('promo-apply')).toBe('Убрать');
    expect(textOf('promo-line')).toMatch(/^Приветственный бонус −10%\s*− 4,50/);
    expect(page.totalCents(4500)).toBe(4050);
  });

  it('keeps the bonus off the cart once the customer removed it', async () => {
    const { page, byTestId, textOf, detect } = await open({ bonuses: [WELCOME] });

    byTestId<HTMLButtonElement>('promo-apply')?.click();
    detect();

    expect(dismissed.has('cart-1')).toBe(true);
    expect(page.promoCode()).toBeNull();
    expect(byTestId<HTMLInputElement>('promo-input')?.value).toBe('');
    expect(byTestId('promo-line')).toBeNull();
    expect(page.totalCents(4500)).toBe(4500);

    // A bigger basket does not bring it back.
    page.changeQuantity(firstLine(page), 1);
    detect();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(page.promoCode()).toBeNull();
    expect(textOf('promo-status')).toBeNull();
  });

  it('puts the bonus back on for a changed basket without asking to apply it again', async () => {
    const { page, detect } = await open({ bonuses: [WELCOME] });

    page.changeQuantity(firstLine(page), 1);
    detect();

    expect(validate).toHaveBeenLastCalledWith('WELCOME10', 'brand-1', 9000, 'store-1');
    expect(page.discountCents()).toBe(900);
    expect(page.error()).toBeNull();
  });

  it('leaves the bonus out at a store in another currency', async () => {
    const { page } = await open({ bonuses: [{ ...WELCOME, currency: 'MDL' }] });
    expect(validate).not.toHaveBeenCalled();
    expect(page.promoInput()).toBe('');
  });

  it('turns points off for a takeAway code typed by hand and sends none with the order', async () => {
    const answer = jest.fn((code: string, _brand: string, subtotal: number) =>
      of(takeawayAnswer(code, 15, false, subtotal)),
    );
    const { page, byTestId, textOf, detect } = await open({ points: 500, answer });

    // Points first, then the promo: the points come off.
    page.pointsInput.set('5');
    page.applyPoints();
    expect(quote).toHaveBeenCalledWith(500, 4500);
    expect(page.pointsSpent()).toBe(500);

    page.promoInput.set('AUTUMN15');
    page.applyPromo();
    detect();

    expect(answer).toHaveBeenCalledWith('AUTUMN15', 'brand-1', 4500, 'store-1');
    expect(textOf('promo-status')).toBe('Акция takeAway −15%');
    expect(page.pointsSpent()).toBe(0);
    expect(page.totalCents(4500)).toBe(3825);
    expect(byTestId<HTMLInputElement>('points-input')?.value).toBe('');
    expect(byTestId<HTMLButtonElement>('points-apply')?.disabled).toBe(true);
    expect(byTestId<HTMLInputElement>('points-input')?.disabled).toBe(true);
    expect(textOf('points-blocked')).toBe('Баллы сняты: их нельзя совместить с промокодом');

    page.applyPoints();
    expect(quote).toHaveBeenCalledTimes(1);

    page.placeOrder();
    expect(orders.create).toHaveBeenCalledWith(expect.objectContaining({ couponCode: 'AUTUMN15', pointsToSpend: 0 }));
  });

  it('turns points off for a brand code too, and back on once it is removed', async () => {
    const answer = jest.fn(() => of(brandAnswer(500)));
    const { page, byTestId, textOf, detect } = await open({ points: 500, answer });
    page.promoInput.set('COFFEE5');
    page.applyPromo();
    detect();

    expect(page.takeawayPromo()).toBeNull();
    expect(textOf('promo-line')).toMatch(/^Промокод · COFFEE5/);
    expect(byTestId<HTMLButtonElement>('points-apply')?.disabled).toBe(true);
    expect(byTestId<HTMLInputElement>('points-input')?.disabled).toBe(true);
    expect(textOf('points-blocked')).toBe('Баллы нельзя совместить с промокодом');
    page.applyPoints();
    expect(quote).not.toHaveBeenCalled();

    page.placeOrder();
    expect(orders.create).toHaveBeenCalledWith(expect.objectContaining({ couponCode: 'COFFEE5', pointsToSpend: 0 }));

    byTestId<HTMLButtonElement>('promo-apply')?.click();
    detect();
    expect(page.promoCode()).toBeNull();
    expect(byTestId<HTMLButtonElement>('points-apply')?.disabled).toBe(false);
    expect(byTestId('points-blocked')).toBeNull();
  });

  it('takes points off when a brand code goes on, and says why', async () => {
    const answer = jest.fn(() => of(brandAnswer(500)));
    const { page, textOf, detect } = await open({ points: 1000, answer });
    page.pointsInput.set('7');
    page.applyPoints();
    expect(page.pointsSpent()).toBe(700);

    page.promoInput.set('COFFEE5');
    page.applyPromo();
    detect();

    expect(page.pointsSpent()).toBe(0);
    expect(page.pointsDiscountCents()).toBe(0);
    expect(page.totalCents(4500)).toBe(4000);
    expect(textOf('points-blocked')).toBe('Баллы сняты: их нельзя совместить с промокодом');
  });

  it('keeps points off under a points-multiplier code, and lets the button take that code off', async () => {
    const answer = jest.fn(() => of({ ...brandAnswer(0), pointsMultiplier: 2 }));
    const { page, byTestId, textOf, detect } = await open({ points: 500, answer });
    page.promoInput.set('DOUBLE');
    page.applyPromo();
    detect();

    expect(textOf('promo-status')).toBe('Применён · 2× баллов');
    expect(textOf('promo-apply')).toBe('Очистить');
    expect(byTestId<HTMLButtonElement>('points-apply')?.disabled).toBe(true);

    byTestId<HTMLButtonElement>('promo-apply')?.click();
    detect();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(page.promoCode()).toBeNull();
    expect(byTestId<HTMLButtonElement>('points-apply')?.disabled).toBe(false);
  });

  describe('points with kopecks', () => {
    it('shows the balance in points, a fraction with two decimals', async () => {
      const { textOf, byTestId } = await open({ points: 1240 });
      expect(textOf('points-section')).toContain('Доступно 12,40 балла');
      expect(byTestId<HTMLInputElement>('points-input')?.placeholder).toBe('12,40');
    });

    it('takes «5,5» as 5,50 points, and shows the quoted amount back', async () => {
      const { page, byTestId, textOf, detect } = await open({ points: 1240 });
      const input = byTestId<HTMLInputElement>('points-input');
      if (!input) throw new Error('no points field');
      input.value = '5,5';
      input.dispatchEvent(new Event('input'));
      page.applyPoints();
      detect();

      expect(quote).toHaveBeenCalledWith(550, 4500);
      expect(page.pointsSpent()).toBe(550);
      expect(input.value).toBe('5,50');
      expect(textOf('points-section')).toContain('Списано 5,50 балла — минус 5,50 руб.');
      expect(page.totalCents(4500)).toBe(3950);
    });

    it('asks for the whole balance when the field is left empty', async () => {
      const { page } = await open({ points: 1240 });
      page.applyPoints();
      expect(quote).toHaveBeenCalledWith(1240, 4500);
    });

    it('names the minimum in points when the quote refuses', async () => {
      const quoteAnswer = jest.fn(() =>
        of({ points: 0, discountCents: 0, balance: 150, pointValueCents: 1, minPoints: 100 }),
      );
      const { page, textOf, detect } = await open({ points: 150, quoteAnswer });
      page.pointsInput.set('0,5');
      page.applyPoints();
      detect();

      expect(quoteAnswer).toHaveBeenCalledWith(50, 4500);
      expect(textOf('points-section')).toContain('Минимум 1 балл, и не больше суммы заказа');
    });
  });

  it('says a takeAway promo does not work at this venue', async () => {
    const answer = jest.fn(() => of(refusal('PROMO_NOT_HERE')));
    const { page, textOf, detect } = await open({ answer });
    page.promoInput.set('AUTUMN15');
    page.applyPromo();
    detect();
    expect(textOf('promo-status')).toBe('Акция не действует в этом заведении');
  });

  it('says a welcome code is not this customer’s', async () => {
    const answer = jest.fn(() => of(refusal('PROMO_NOT_ELIGIBLE')));
    const { page, textOf, detect } = await open({ answer });
    page.promoInput.set('WELCOME10');
    page.applyPromo();
    detect();
    expect(textOf('promo-status')).toBe('Этот промокод вам недоступен');
  });

  it('says points and a promo do not combine when the order is refused for it', async () => {
    const { page } = await open();
    orders.create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { statusCode: 400, code: 'PROMO_WITH_POINTS' } })),
    );
    page.placeOrder();
    expect(page.error()).toBe('Баллы нельзя совместить с промокодом');
  });
});
