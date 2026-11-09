import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
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
