import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { OptionLine } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AdminOrdersApi, type AdminOrderDetail } from '../../core/orders/orders.service';
import { OrderDetailPanelComponent } from './order-detail-panel.component';

const ORDER: AdminOrderDetail = {
  id: 'order-1',
  orderCode: '4242',
  status: 'CANCELLED',
  fulfillmentType: 'PICKUP',
  pickupMode: 'ASAP',
  pickupAt: '2026-11-09T09:15:00Z',
  createdAt: '2026-11-09T09:00:00Z',
  storeId: 'store-1',
  storeName: 'Центр',
  storeTimezone: 'UTC',
  customerName: 'Ира',
  customerPhone: null,
  customerEmail: null,
  notes: null,
  currency: 'RUP',
  subtotalCents: 4500,
  discountCents: 0,
  taxCents: 0,
  deliveryFeeCents: 0,
  giftCardCents: 0,
  totalCents: 4500,
  couponCode: null,
  giftCardCode: null,
  refundedCents: 4500,
  refundableCents: 0,
  items: [],
  payments: [],
  events: [],
};

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Text of an element with its pieces apart: «Сумма для бизнеса 100 MDL», not «…бизнеса100 MDL». */
function spaced(el: Element | null | undefined): string {
  if (!el) return '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = node.textContent?.trim();
    if (piece) parts.push(piece);
  }
  return parts.join(' ').replace(/\s+/g, ' ');
}

/** Why a cancelled order ended, for the manager answering the customer (2026-11-09). */
describe('OrderDetailPanelComponent — a cancelled order', () => {
  async function render(order: AdminOrderDetail) {
    TestBed.configureTestingModule({
      imports: [OrderDetailPanelComponent],
      providers: [
        provideTranslateService(),
        { provide: AdminOrdersApi, useValue: { get: jest.fn().mockReturnValue(of(order)) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(OrderDetailPanelComponent);
    fixture.componentRef.setInput('orderId', order.id);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return (id: string) => el.querySelector(`[data-testid="${id}"]`);
  }

  beforeEach(() => TestBed.resetTestingModule());

  it("says who turned it down, the kitchen's reason and comment, and where the money went", async () => {
    const byTestId = await render({
      ...ORDER,
      cancelledBy: 'STORE',
      cancelReason: 'TOO_BUSY',
      cancelComment: 'Очередь на 40 минут',
      cancelMoney: 'RELEASED',
    });
    expect(text(byTestId('order-cancel-by'))).toBe('Заведение');
    expect(text(byTestId('order-cancel-reason'))).toBe('Слишком много заказов');
    expect(text(byTestId('order-cancel-comment'))).toBe('“Очередь на 40 минут”');
    expect(text(byTestId('order-cancel-money'))).toBe('Блокировка на карте снята');
    expect(byTestId('order-cancel-bank')).toBeNull();
  });

  it("shows the bank's answer on a card declined on the accept", async () => {
    const byTestId = await render({
      ...ORDER,
      cancelledBy: 'STORE',
      cancelReason: 'CARD_DECLINED',
      cancelMoney: 'NOT_CHARGED',
      events: [
        {
          id: 'e1',
          type: 'CANCELLED',
          createdAt: '2026-11-09T09:05:00Z',
          actorId: 'staff-1',
          payload: { from: 'CREATED', by: 'store', reason: 'CARD_DECLINED', bankMessage: 'Недостаточно средств' },
        },
      ],
    });
    expect(text(byTestId('order-cancel-by'))).toBe('Банк отклонил карту при принятии');
    expect(byTestId('order-cancel-reason')).toBeNull();
    expect(text(byTestId('order-cancel-money'))).toBe('Не списывались');
    expect(text(byTestId('order-cancel-bank'))).toBe('Недостаточно средств');
  });

  it('has no cancellation block for an order still in work', async () => {
    const byTestId = await render({ ...ORDER, status: 'READY', refundedCents: 0 });
    expect(byTestId('order-cancel')).toBeNull();
  });
});

/** A line of a product on the options catalog (2026-11-09): the picks read as the kitchen and the receipt read them. */
describe('OrderDetailPanelComponent — catalog options', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('shows the variants and add-ons of a line under its name', async () => {
    const line = (groupId: string, name: string, extra: Partial<OptionLine> = {}): OptionLine => ({
      groupId,
      groupName: groupId,
      kind: 'ADDON',
      type: 'A',
      optionId: `${groupId}-${name}`,
      name,
      qty: 1,
      unitPriceCents: 0,
      freeQty: 0,
      totalCents: 0,
      ...extra,
    });
    TestBed.configureTestingModule({
      imports: [OrderDetailPanelComponent],
      providers: [
        provideTranslateService(),
        {
          provide: AdminOrdersApi,
          useValue: {
            get: jest.fn().mockReturnValue(
              of({
                ...ORDER,
                status: 'READY',
                refundedCents: 0,
                items: [
                  {
                    id: 'item-1',
                    name: 'Капучино',
                    variations: [],
                    modifierLines: [],
                    optionLines: [
                      line('size', 'M', { kind: 'VARIANT' }),
                      line('serve', 'Горячий', { kind: 'VARIANT' }),
                      line('milk', 'Овсяное'),
                      line('syrups', 'Ваниль'),
                      line('syrups', 'Солёная карамель'),
                      line('sugar', 'Сахар', { type: 'C', qty: 2 }),
                    ],
                    notes: null,
                    quantity: 1,
                    unitPriceCents: 7100,
                    totalCents: 7100,
                  },
                ],
              } satisfies AdminOrderDetail),
            ),
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(OrderDetailPanelComponent);
    fixture.componentRef.setInput('orderId', 'order-1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text(fixture.nativeElement as HTMLElement)).toContain(
      'M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2',
    );
  });
});

/** Agroprombank «Мобильный платёж» (docs/agroprombank-payments.md §12): the bank gives a QR payment back only whole. */
describe('OrderDetailPanelComponent — paid by QR', () => {
  const qrPayment = {
    id: 'pay-1',
    provider: 'AGROPROMBANK_QR',
    status: 'SUCCEEDED',
    amountCents: 4500,
    refundedCents: 0,
    providerRef: '777',
    createdAt: '2026-11-09T09:01:00Z',
  };

  async function render(order: AdminOrderDetail) {
    TestBed.configureTestingModule({
      imports: [OrderDetailPanelComponent],
      providers: [
        provideTranslateService(),
        { provide: AdminOrdersApi, useValue: { get: jest.fn().mockReturnValue(of(order)) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(OrderDetailPanelComponent);
    fixture.componentRef.setInput('orderId', order.id);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('names QR as the way the customer paid, and refunds it only in full', async () => {
    const order: AdminOrderDetail = {
      ...ORDER,
      status: 'PICKED_UP',
      refundedCents: 0,
      refundableCents: 4500,
      payments: [{ ...qrPayment, id: 'pay-0', status: 'FAILED' }, qrPayment],
    };
    const fixture = await render(order);
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('[data-testid="order-paid-with"]'))).toBe('Мобильный платёж (Агропромбанк)');

    fixture.componentInstance.startRefund(order);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text(el.querySelector('[data-testid="refund-full-only"]'))).toBe(
      'Мобильный платёж можно вернуть только целиком.',
    );
    expect(el.querySelector<HTMLInputElement>('[data-testid="refund-amount"]')?.disabled).toBe(true);

    expect(fixture.componentInstance.amountValid(order)).toBe(true);
    fixture.componentInstance.amountMajor = 20;
    expect(fixture.componentInstance.amountValid(order)).toBe(false);
  });

  it('keeps a card payment refundable in part', async () => {
    const order: AdminOrderDetail = {
      ...ORDER,
      status: 'PICKED_UP',
      refundedCents: 0,
      refundableCents: 4500,
      payments: [{ ...qrPayment, provider: 'AGROPROMBANK_WEB' }],
    };
    const fixture = await render(order);
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('[data-testid="order-paid-with"]'))).toBe('Карта на странице банка (Агропромбанк)');

    fixture.componentInstance.startRefund(order);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="refund-full-only"]')).toBeNull();
    fixture.componentInstance.amountMajor = 20;
    expect(fixture.componentInstance.amountValid(order)).toBe(true);
  });
});

/**
 * A takeAway promo order (docs/takeaway-promos.md §4.4): the card says the
 * guest paid their part and takeAway covers the rest, so staff collect nothing.
 */
describe('OrderDetailPanelComponent — a takeAway promo order', () => {
  beforeEach(() => TestBed.resetTestingModule());

  async function render(order: AdminOrderDetail) {
    TestBed.configureTestingModule({
      imports: [OrderDetailPanelComponent],
      providers: [
        provideTranslateService(),
        { provide: AdminOrdersApi, useValue: { get: jest.fn().mockReturnValue(of(order)) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(OrderDetailPanelComponent);
    fixture.componentRef.setInput('orderId', order.id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const PROMO_ORDER: AdminOrderDetail = {
    ...ORDER,
    status: 'ACCEPTED',
    currency: 'MDL',
    subtotalCents: 10000,
    discountCents: 1000,
    totalCents: 9000,
    couponCode: 'HELLO10',
    refundedCents: 0,
    refundableCents: 9000,
    takeawayPromo: {
      code: 'HELLO10',
      name: 'Приветственный бонус',
      percent: 10,
      menuTotalCents: 10000,
      discountCents: 1000,
      paidByGuestCents: 9000,
    },
  };

  it('says what the guest paid and what takeAway compensates', async () => {
    const el = await render(PROMO_ORDER);
    expect(text(el.querySelector('[data-testid="order-takeaway-promo"]'))).toBe(
      'Акция takeAway −10%: гость оплатил 90 MDL, ещё 10 MDL компенсирует takeAway',
    );
    // The discount line names the promo instead of a plain «Скидка».
    expect(text(el)).toContain('Акция takeAway −10% HELLO10');
  });

  it('has no such line on an order without one', async () => {
    const el = await render({ ...PROMO_ORDER, takeawayPromo: null, couponCode: 'BRAND5' });
    expect(el.querySelector('[data-testid="order-takeaway-promo"]')).toBeNull();
    expect(text(el)).toContain('Скидка BRAND5');
    // A brand's own promo code is the brand's: nothing for takeAway to compensate.
    expect(el.querySelector('[data-testid="order-business-total"]')).toBeNull();
  });

  it('shows the full amount the business is credited with', async () => {
    const el = await render(PROMO_ORDER);
    expect(spaced(el.querySelector('[data-testid="order-business-total"]'))).toBe(
      'Сумма для бизнеса 100 MDL гость оплатил 90 MDL · 10 MDL компенсирует takeAway',
    );
  });

  it('has no full amount once the order was cancelled: takeAway compensates nothing then', async () => {
    const el = await render({ ...PROMO_ORDER, status: 'CANCELLED' });
    expect(el.querySelector('[data-testid="order-business-total"]')).toBeNull();
  });
});

/**
 * Loyalty points (2026-11-14): takeAway funds the programme, so the points
 * are compensated to the business like a takeAway promo, and the panel shows
 * the full amount. The detail does not carry the points yet: the list's
 * `takeawayFundedCents` tells them apart from the brand's own discount.
 */
describe('OrderDetailPanelComponent — an order paid partly with points', () => {
  beforeEach(() => TestBed.resetTestingModule());

  async function render(order: AdminOrderDetail, takeawayFundedCents?: number) {
    TestBed.configureTestingModule({
      imports: [OrderDetailPanelComponent],
      providers: [
        provideTranslateService(),
        { provide: AdminOrdersApi, useValue: { get: jest.fn().mockReturnValue(of(order)) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(OrderDetailPanelComponent);
    fixture.componentRef.setInput('orderId', order.id);
    if (takeawayFundedCents !== undefined) fixture.componentRef.setInput('takeawayFundedCents', takeawayFundedCents);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** 50 at the menu: a brand code −5, points −20, the guest paid 25. */
  const POINTS_ORDER: AdminOrderDetail = {
    ...ORDER,
    status: 'PICKED_UP',
    currency: 'MDL',
    subtotalCents: 5000,
    discountCents: 2500,
    totalCents: 2500,
    couponCode: 'BRAND5',
    refundedCents: 0,
    refundableCents: 2500,
  };

  it('splits the points out of the discount and says takeAway compensates them', async () => {
    const el = await render(POINTS_ORDER, 2000);
    expect(spaced(el)).toContain('Скидка BRAND5 − 5 MDL');
    expect(spaced(el.querySelector('[data-testid="order-points"]'))).toBe('Баллы — компенсирует takeAway − 20 MDL');
    expect(spaced(el.querySelector('[data-testid="order-business-total"]'))).toBe(
      'Сумма для бизнеса 45 MDL гость оплатил 25 MDL · 20 MDL компенсирует takeAway',
    );
  });

  it('takes the points from the detail once the API sends them', async () => {
    const el = await render({ ...POINTS_ORDER, pointsDiscountCents: 2000 });
    expect(spaced(el.querySelector('[data-testid="order-points"]'))).toBe('Баллы — компенсирует takeAway − 20 MDL');
  });

  it('shows one discount line when nobody says what takeAway funds (opened from reviews)', async () => {
    const el = await render(POINTS_ORDER);
    expect(el.querySelector('[data-testid="order-points"]')).toBeNull();
    expect(el.querySelector('[data-testid="order-business-total"]')).toBeNull();
    expect(spaced(el)).toContain('Скидка BRAND5 − 25 MDL');
  });

  it('has no points line on a cancelled order: the points went back to the guest', async () => {
    const el = await render({ ...POINTS_ORDER, status: 'CANCELLED', pointsDiscountCents: 2000 }, 0);
    expect(el.querySelector('[data-testid="order-points"]')).toBeNull();
    expect(spaced(el)).toContain('Скидка BRAND5 − 25 MDL');
  });
});
