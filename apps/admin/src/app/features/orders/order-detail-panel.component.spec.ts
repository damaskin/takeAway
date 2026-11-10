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
    expect(text(el.querySelector('[data-testid="order-paid-with"]'))).toBe('QR (Агропромбанк)');

    fixture.componentInstance.startRefund(order);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text(el.querySelector('[data-testid="refund-full-only"]'))).toBe(
      'Оплату по QR можно вернуть только целиком.',
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
