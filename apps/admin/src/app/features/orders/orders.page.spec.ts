import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of } from 'rxjs';

import { AdminOrdersApi, type AdminOrderDetail, type AdminOrderSummary } from '../../core/orders/orders.service';
import { AdminOrdersPage } from './orders.page';

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

function summary(overrides: Partial<AdminOrderSummary>): AdminOrderSummary {
  return {
    id: 'o1',
    orderCode: '1001',
    status: 'ACCEPTED',
    pickupMode: 'ASAP',
    pickupAt: '2026-11-14T09:15:00.000Z',
    totalCents: 2500,
    currency: 'MDL',
    storeId: 's1',
    storeName: 'Центр',
    storeTimezone: 'UTC',
    itemCount: 1,
    createdAt: '2026-11-14T09:00:00.000Z',
    ...overrides,
  };
}

/** 50 at the menu, 20 in points: the guest paid 30. */
const POINTS_DETAIL: AdminOrderDetail = {
  id: 'o2',
  orderCode: '1002',
  status: 'ACCEPTED',
  fulfillmentType: 'PICKUP',
  pickupMode: 'ASAP',
  pickupAt: '2026-11-14T09:15:00.000Z',
  createdAt: '2026-11-14T09:00:00.000Z',
  storeId: 's1',
  storeName: 'Центр',
  storeTimezone: 'UTC',
  customerName: 'Ира',
  customerPhone: null,
  customerEmail: null,
  notes: null,
  currency: 'MDL',
  subtotalCents: 5000,
  discountCents: 2000,
  taxCents: 0,
  deliveryFeeCents: 0,
  giftCardCents: 0,
  totalCents: 3000,
  couponCode: null,
  giftCardCode: null,
  refundedCents: 0,
  refundableCents: 3000,
  items: [],
  payments: [],
  events: [],
};

/**
 * Maxim's list (2026-11-14), item 4: takeAway compensates its promo and
 * points and takes its commission on the full amount, so the business sees
 * the full amount of such an order, with what the guest paid under it.
 */
describe('AdminOrdersPage — the amount column', () => {
  async function render(orders: AdminOrderSummary[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminOrdersPage],
      providers: [
        provideTranslateService(),
        {
          provide: AdminOrdersApi,
          useValue: { list: jest.fn().mockReturnValue(of(orders)), get: jest.fn().mockReturnValue(of(POINTS_DETAIL)) },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(AdminOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const text = spaced;

  it('shows the full amount and what the guest paid when takeAway funds part of it', async () => {
    const fixture = await render([
      summary({ id: 'o1', orderCode: '1001', totalCents: 9000, takeawayFundedCents: 1000 }),
      summary({ id: 'o2', orderCode: '1002', totalCents: 2500 }),
      // An API older than the field: the amount stays as it was.
      summary({ id: 'o3', orderCode: '1003', totalCents: 1500, takeawayFundedCents: 0 }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const amounts = [...el.querySelectorAll('[data-testid="order-amount"]')];

    expect(text(amounts[0])).toBe('100 MDL гость оплатил 90 MDL · 10 MDL компенсирует takeAway');
    expect(text(amounts[1])).toBe('25 MDL');
    expect(amounts[1]?.querySelector('[data-testid="order-funded"]')).toBeNull();
    expect(text(amounts[2])).toBe('15 MDL');
  });

  it('hands the funded amount to the detail panel, which splits out the points', async () => {
    const fixture = await render([
      summary({ id: 'o2', orderCode: '1002', totalCents: 3000, takeawayFundedCents: 2000 }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('tbody tr') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(el.querySelector('[data-testid="order-points"]'))).toBe('Баллы — компенсирует takeAway − 20 MDL');
    expect(text(el.querySelector('[data-testid="order-business-total"]'))).toContain('Сумма для бизнеса 50 MDL');
  });
});
