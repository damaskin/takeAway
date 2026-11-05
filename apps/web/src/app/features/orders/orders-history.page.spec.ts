import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of } from 'rxjs';

import { OrdersApi, type OrderSummary } from '../../core/orders/orders.service';
import { OrdersHistoryPage } from './orders-history.page';

const SUMMARY: OrderSummary = {
  id: 'order-1',
  orderCode: '1234',
  status: 'CANCELLED',
  pickupMode: 'ASAP',
  pickupAt: '2026-11-05T09:15:00Z',
  totalCents: 4500,
  currency: 'RUP',
  storeId: 'store-1',
  storeName: 'NoName Centre',
  storeTimezone: 'UTC',
  itemCount: 2,
  createdAt: '2026-11-05T09:00:00Z',
};

describe('OrdersHistoryPage — a cancelled order says who and why (item 7)', () => {
  function render(orders: OrderSummary[]) {
    TestBed.configureTestingModule({
      imports: [OrdersHistoryPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: OrdersApi, useValue: { listMine: jest.fn(() => of(orders)) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(OrdersHistoryPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it("names the store as the one who cancelled, with the kitchen's reason", () => {
    const root = render([{ ...SUMMARY, cancelledBy: 'STORE', cancelReason: 'OUT_OF_STOCK' }]);
    expect(root.textContent).toContain('Отменён заведением');
    expect(root.querySelector('[data-testid="history-cancel-reason"]')?.textContent?.trim()).toBe(
      'Части позиций сейчас нет в наличии.',
    );
  });

  it("tells the customer's own cancel and a declined card apart", () => {
    const root = render([
      { ...SUMMARY, id: 'a', cancelledBy: 'CUSTOMER' },
      { ...SUMMARY, id: 'b', cancelledBy: 'STORE', cancelReason: 'CARD_DECLINED' },
    ]);
    expect(root.textContent).toContain('Отменён вами');
    expect(root.textContent).toContain('Карта отклонена');
    expect(root.querySelector('[data-testid="history-cancel-reason"]')).toBeNull();
  });

  it('keeps the plain status when the order does not say', () => {
    const root = render([SUMMARY]);
    expect(root.textContent).toContain('Отменён');
    expect(root.textContent).not.toContain('Отменён заведением');
  });
});
