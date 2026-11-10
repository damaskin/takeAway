import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { type Observable, of, throwError } from 'rxjs';

import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrdersApi, type OrderView } from '../../core/orders/orders.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaOrderStatusPage } from './order-status.page';

const inMinutes = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

function order(over: Partial<OrderView> = {}): OrderView {
  return {
    id: 'ord-1',
    orderCode: 'A-12',
    qrToken: 'qr',
    status: 'PAID',
    pickupMode: 'ASAP',
    pickupAt: inMinutes(8),
    totalCents: 4500,
    currency: 'RUP',
    storeId: 'store-1',
    storeName: 'NoName Centre',
    storeTimezone: 'UTC',
    // No pin: the page draws no map, and the test needs no Leaflet.
    storeLatitude: 0,
    storeLongitude: 0,
    storeAddress: null,
    items: [],
    payment: { state: 'HELD', amountCents: 4500, cardMask: null, paidAt: null },
    canCancel: true,
    ...over,
  };
}

describe('TmaOrderStatusPage', () => {
  let orders: { get: jest.Mock; cancel: jest.Mock; reportLocation: jest.Mock; review: jest.Mock };
  let haptic: jest.Mock;
  let confirm: jest.Mock;
  /** The page's `order.statusChanged` handler, as it subscribed. */
  let pushStatus: (event: { status: OrderView['status'] }) => void;

  async function open(first: OrderView, opts: { phone?: string; qr?: string[]; cards?: boolean } = {}) {
    orders = {
      get: jest.fn(() => of(first)),
      cancel: jest.fn(),
      reportLocation: jest.fn(() => of({})),
      review: jest.fn(),
    };
    haptic = jest.fn();
    confirm = jest.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'orders/:id', component: TmaOrderStatusPage }]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: OrdersApi, useValue: orders },
        {
          provide: CatalogService,
          useValue: {
            getMenu: () => of({ storeId: 'store-1', storeSlug: 'centre', categories: [] }),
            getStore: () => of({ id: 'store-1', phone: opts.phone ?? null, openNow: true }),
          },
        },
        {
          provide: RealtimeService,
          useValue: {
            subscribeToOrder: (_id: string, handler: typeof pushStatus) => {
              pushStatus = handler;
              return () => undefined;
            },
            onStoreAvailabilityChanged: () => () => undefined,
          },
        },
        {
          provide: FeatureFlagsStore,
          useValue: {
            load: jest.fn(),
            webPaymentsEnabled: signal(false),
            cardPaymentsEnabled: signal(opts.cards ?? true),
            qrPaymentCurrencies: signal(opts.qr ?? []),
          },
        },
        { provide: WebPaymentApi, useValue: { issuedPageUrl: () => null, forget: jest.fn(), start: jest.fn() } },
        {
          provide: TelegramBridgeService,
          useValue: { haptic, confirm, setBackButton: () => () => undefined, openLink: jest.fn() },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/orders/ord-1', TmaOrderStatusPage);
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    const byTestId = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const settle = async () => {
      await harness.fixture.whenStable();
      harness.detectChanges();
    };
    const text = (id: string) => byTestId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    return { page, root, byTestId, text, settle, destroy: () => harness.fixture.destroy() };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('cancels an order the kitchen has not accepted, after asking', async () => {
    const { byTestId, settle, root, destroy } = await open(order());
    orders.cancel.mockReturnValue(of(order({ status: 'CANCELLED', canCancel: false })));

    byTestId('cancel-order')?.click();
    await settle();

    expect(confirm).toHaveBeenCalledWith('Отменить заказ A-12?');
    expect(orders.cancel).toHaveBeenCalledWith('ord-1');
    expect(byTestId('cancel-order')).toBeNull();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Отменён');
    expect(byTestId('call-to-cancel')).toBeNull();
    destroy();
  });

  describe('a takeAway promo on the order', () => {
    const LATTE: OrderView['items'][number] = {
      id: 'item-1',
      quantity: 1,
      totalCents: 4500,
      productSnapshot: {
        id: 'latte',
        slug: 'latte',
        name: 'Латте',
        variationIds: [],
        modifiers: {},
        notes: null,
        unitPrepSeconds: 60,
        variations: [],
        modifierLines: [],
        optionLines: [],
      },
    };
    const line = (root: HTMLElement) =>
      root.querySelector('[data-testid="takeaway-promo-line"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

    it('reads «Акция takeAway −10%» beside the code', async () => {
      const { root, destroy } = await open(
        order({
          items: [LATTE],
          totalCents: 4050,
          takeawayPromo: {
            code: 'WELCOME10',
            name: 'Приветственный бонус',
            percent: 10,
            menuTotalCents: 4500,
            discountCents: 450,
            paidByGuestCents: 4050,
          },
        }),
      );
      expect(line(root)).toMatch(/^Акция takeAway −10% · WELCOME10\s*− 4,50 руб\.$/);
      destroy();
    });

    it('has no such line without one', async () => {
      const { root, destroy } = await open(order({ items: [LATTE], takeawayPromo: null }));
      expect(line(root)).toBeNull();
      destroy();
    });
  });

  describe('a cancelled order says why (item 7)', () => {
    const NOT_CHARGED = { state: 'NONE' as const, amountCents: 0, cardMask: null, paidAt: null };
    const lines = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('[data-testid="cancel-reason"] span'), (el) => el.textContent?.trim());

    it("gives the store's reason, its comment and the money, as the push did", async () => {
      const { root, byTestId, destroy } = await open(
        order({
          status: 'CANCELLED',
          canCancel: false,
          cancelledBy: 'STORE',
          cancelReason: 'OUT_OF_STOCK',
          cancelComment: 'Нет овсяного молока',
          payment: NOT_CHARGED,
        }),
      );
      expect(root.querySelector('h1')?.textContent?.trim()).toBe('Отменён');
      expect(byTestId('order-slogan')?.textContent?.trim()).toBe('Заведение отменило заказ');
      expect(lines(root)).toEqual([
        'Части позиций сейчас нет в наличии.',
        'Комментарий заведения: «Нет овсяного молока»',
        'Деньги с карты не списывались.',
      ]);
      destroy();
    });

    it("says it was the customer's own cancel, with the hold lifted", async () => {
      const { root, byTestId, destroy } = await open(
        order({
          status: 'CANCELLED',
          canCancel: false,
          cancelledBy: 'CUSTOMER',
          payment: { state: 'REFUNDED', amountCents: 4500, cardMask: null, paidAt: null },
        }),
      );
      expect(byTestId('order-slogan')?.textContent?.trim()).toBe('Вы отменили заказ');
      expect(lines(root)).toEqual(['Деньги не списаны, блокировка на карте снята.']);
      destroy();
    });

    it('tells a declined card apart and what to do next', async () => {
      const { root, byTestId, destroy } = await open(
        order({
          status: 'CANCELLED',
          canCancel: false,
          cancelledBy: 'STORE',
          cancelReason: 'CARD_DECLINED',
          payment: NOT_CHARGED,
        }),
      );
      expect(byTestId('order-slogan')?.textContent?.trim()).toBe('Банк отклонил оплату картой');
      expect(lines(root)).toEqual(['Оформите заказ ещё раз с другой картой.', 'Деньги с карты не списывались.']);
      destroy();
    });

    it('shows the reason as soon as the kitchen turns the order down, from the re-read', async () => {
      const { root, byTestId, settle, destroy } = await open(order());
      expect(byTestId('cancel-reason')).toBeNull();

      orders.get.mockReturnValue(
        of(
          order({
            status: 'CANCELLED',
            canCancel: false,
            cancelledBy: 'STORE',
            cancelReason: 'TOO_BUSY',
            payment: { state: 'REFUNDED', amountCents: 4500, cardMask: null, paidAt: null },
          }),
        ),
      );
      pushStatus({ status: 'CANCELLED' });
      await settle();

      expect(byTestId('order-slogan')?.textContent?.trim()).toBe('Заведение отменило заказ');
      expect(lines(root)).toEqual(['Заведение сейчас перегружено заказами.', 'Деньги вернутся на карту.']);
      destroy();
    });

    /**
     * The store turned down an order paid with a card hold: the push said
     * «Деньги не списаны, блокировка на карте снята» — and so does the page,
     * once the API recorded it; the payment reads REFUNDED either way.
     */
    it('says the hold came off, in the words of the push, and never «Спишем при принятии заказа»', async () => {
      const { root, byTestId, destroy } = await open(
        order({
          status: 'CANCELLED',
          canCancel: false,
          cancelledBy: 'STORE',
          cancelReason: 'TOO_BUSY',
          cancelMoney: 'RELEASED',
          payment: { state: 'REFUNDED', amountCents: 4500, cardMask: null, paidAt: null },
        }),
      );
      expect(lines(root)).toEqual([
        'Заведение сейчас перегружено заказами.',
        'Деньги не списаны, блокировка на карте снята.',
      ]);
      expect(byTestId('payment-line')?.textContent).toContain('Блокировка снята');
      destroy();
    });

    it('says the money is still coming back on a cancelled order whose hold the bank kept', async () => {
      const { root, byTestId, destroy } = await open(
        order({
          status: 'CANCELLED',
          canCancel: false,
          cancelledBy: 'CUSTOMER',
          cancelMoney: 'PENDING',
          payment: { state: 'HELD', amountCents: 4500, cardMask: null, paidAt: null },
        }),
      );
      expect(lines(root)).toEqual(['Блокировка на карте будет снята автоматически.']);
      expect(byTestId('payment-line')?.textContent).toContain('Возврат в обработке');
      expect(root.textContent).not.toContain('Спишем при принятии заказа');
      expect(root.textContent).not.toContain('Если точка не примет заказ');
      destroy();
    });
  });

  /** Agroprombank «Мобильный платёж» (docs/agroprombank-payments.md §12). */
  describe('paid by QR in the bank app', () => {
    const QR_PAID = {
      state: 'HELD' as const,
      amountCents: 4500,
      cardMask: null,
      paidAt: null,
      provider: 'AGROPROMBANK_QR' as const,
    };

    it('offers to pay a new unpaid order by QR, on the QR screen', async () => {
      const unpaid = order({
        status: 'CREATED',
        payment: { state: 'NONE', amountCents: 0, cardMask: null, paidAt: null },
      });
      const { byTestId, destroy } = await open(unpaid, { qr: ['RUP'] });
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      expect(byTestId('pay-by-qr')?.textContent?.trim()).toBe('Оплатить по QR');
      byTestId('pay-by-qr')?.click();
      expect(navigate).toHaveBeenCalledWith(['/orders', 'ord-1', 'qr']);
      destroy();
    });

    it('offers no QR in a store of another currency', async () => {
      const unpaid = order({
        status: 'CREATED',
        currency: 'MDL',
        payment: { state: 'NONE', amountCents: 0, cardMask: null, paidAt: null },
      });
      const { byTestId, destroy } = await open(unpaid, { qr: ['RUP'] });
      expect(byTestId('pay-by-qr')).toBeNull();
      destroy();
    });

    it('says the order is paid by QR and the money comes back if the store turns it down', async () => {
      const { text, root, destroy } = await open(order({ payment: QR_PAID }), { qr: ['RUP'] });
      expect(text('payment-line')).toContain('Оплачено по QR');
      expect(root.textContent).toContain('Если заведение не примет заказ, деньги вернутся.');
      expect(root.textContent).not.toContain('Спишем при принятии заказа');
      destroy();
    });

    it('says the QR payment was returned on a cancelled order', async () => {
      const { text, destroy } = await open(
        order({
          status: 'CANCELLED',
          canCancel: false,
          cancelledBy: 'CUSTOMER',
          cancelMoney: 'REFUNDED',
          payment: { ...QR_PAID, state: 'REFUNDED' },
        }),
        { qr: ['RUP'] },
      );
      expect(text('cancel-reason')).toContain('Оплата по QR возвращена — деньги вернулись на ваш счёт в банке.');
      expect(text('payment-line')).toContain('Деньги возвращены');
      destroy();
    });
  });

  it('keeps the order when the customer says no', async () => {
    const { byTestId, settle, destroy } = await open(order());
    confirm.mockReturnValue(Promise.resolve(false));
    byTestId('cancel-order')?.click();
    await settle();
    expect(orders.cancel).not.toHaveBeenCalled();
    destroy();
  });

  // The kitchen accepted it a moment before the tap.
  it('sends the customer to the store when the kitchen got there first', async () => {
    const { byTestId, settle, destroy } = await open(order(), { phone: '+37369123456' });
    orders.cancel.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { code: 'ORDER_NOT_CANCELLABLE', reason: 'ACCEPTED' } }),
      ) as Observable<OrderView>,
    );
    orders.get.mockReturnValue(of(order({ status: 'ACCEPTED', canCancel: false })));

    byTestId('cancel-order')?.click();
    await settle();

    expect(byTestId('cancel-order')).toBeNull();
    expect(byTestId('call-to-cancel')?.textContent?.trim()).toBe('Заказ уже готовят — для отмены позвоните в точку');
    expect(byTestId('call-store')?.getAttribute('href')).toBe('tel:+37369123456');
    destroy();
  });

  it('names the new time instead of «Немного задерживаемся» once the kitchen accepted late', async () => {
    const { byTestId, destroy } = await open(
      order({ status: 'IN_PROGRESS', canCancel: false, pickupAt: inMinutes(-2), readyEstimateAt: inMinutes(5.5) }),
    );
    expect(byTestId('order-slogan')?.textContent?.trim()).toBe('Готовим · будет готово через 6 мин');
    expect(byTestId('order-countdown')?.textContent?.trim()).toMatch(/^5:[23]\d$/);
    expect(byTestId('order-late')).toBeNull();
    destroy();
  });

  it('shows the pickup time of a pre-order hours away instead of a long countdown', async () => {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 9, 15));
    const { byTestId, destroy } = await open(order({ pickupMode: 'SCHEDULED', pickupAt: tomorrow.toISOString() }));
    expect(byTestId('order-ready-at')?.textContent?.trim()).toBe('к 09:15 завтра');
    expect(byTestId('order-countdown')).toBeNull();
    destroy();
  });
  describe('«Как вам заказ?» (item 11)', () => {
    const pickedUp = (over: Partial<OrderView> = {}) =>
      order({
        status: 'PICKED_UP',
        canCancel: false,
        payment: { state: 'PAID', amountCents: 4500, cardMask: null, paidAt: inMinutes(-20) },
        canReview: true,
        review: null,
        ...over,
      });
    const reviewed = pickedUp({
      canReview: false,
      review: { rating: 5, comment: null, createdAt: inMinutes(0) },
    });

    it('asks nothing before the handover, nor from an API without reviews', async () => {
      for (const first of [order(), pickedUp({ canReview: undefined, review: undefined })]) {
        TestBed.resetTestingModule();
        const { byTestId, destroy } = await open(first);
        expect(byTestId('order-review')).toBeNull();
        destroy();
      }
    });

    it('sends the stars and the comment, then thanks with the stars given', async () => {
      const { byTestId, root, settle, destroy } = await open(pickedUp());
      orders.review.mockReturnValue(of({ ...reviewed, review: { rating: 5, comment: 'Лучший раф', createdAt: '' } }));

      expect(byTestId('order-review')?.textContent).toContain('Как вам заказ?');
      expect(byTestId('order-review-star-5')?.getAttribute('aria-label')).toBe('Оценка 5 из 5');
      expect((byTestId('order-review-send') as HTMLButtonElement).disabled).toBe(true);
      byTestId('order-review-star-5')?.click();
      await settle();
      expect(haptic).toHaveBeenCalledWith('light');
      const comment = root.querySelector<HTMLTextAreaElement>('[data-testid="order-review-comment"]');
      if (!comment) throw new Error('no comment field');
      comment.value = 'Лучший раф ';
      comment.dispatchEvent(new Event('input'));
      byTestId('order-review-send')?.click();
      await settle();

      expect(orders.review).toHaveBeenCalledWith('ord-1', { rating: 5, comment: 'Лучший раф' });
      expect(byTestId('order-review-thanks')?.textContent).toContain('Спасибо за отзыв!');
      expect(byTestId('order-review-given')?.getAttribute('aria-label')).toBe('Ваша оценка: 5 из 5');
      expect(byTestId('order-review-comment-given')?.textContent).toContain('Лучший раф');
      destroy();
    });

    it('shows the thanks on an order reviewed before', async () => {
      const { byTestId, destroy } = await open(reviewed);
      expect(byTestId('order-review-thanks')).not.toBeNull();
      expect(byTestId('order-review-send')).toBeNull();
      destroy();
    });

    it('drops the card when the order turns out not to be reviewable', async () => {
      const { byTestId, settle, destroy } = await open(pickedUp());
      orders.review.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'ORDER_NOT_REVIEWABLE' } })),
      );
      orders.get.mockReturnValue(of(pickedUp({ status: 'CANCELLED', canReview: false })));

      byTestId('order-review-star-1')?.click();
      await settle();
      byTestId('order-review-send')?.click();
      await settle();

      expect(byTestId('order-review')).toBeNull();
      destroy();
    });

    it('says so and keeps the form after a failure of another kind', async () => {
      const { byTestId, settle, destroy } = await open(pickedUp());
      orders.review.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

      byTestId('order-review-star-2')?.click();
      await settle();
      byTestId('order-review-send')?.click();
      await settle();

      expect(byTestId('order-review-error')).not.toBeNull();
      expect(byTestId('order-review-star-2')?.getAttribute('aria-pressed')).toBe('true');
      destroy();
    });
  });
});
