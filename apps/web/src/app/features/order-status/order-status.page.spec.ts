import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { StoreDetail } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrdersApi, type OrderView } from '../../core/orders/orders.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { OrderStatusPage } from './order-status.page';

const minutesFromNow = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

const ORDER: OrderView = {
  id: 'order-1',
  orderCode: '1234',
  qrToken: 'qr',
  status: 'CREATED',
  pickupMode: 'SCHEDULED',
  fulfillmentType: 'PICKUP',
  pickupAt: minutesFromNow(8 * 60),
  subtotalCents: 4500,
  totalCents: 4500,
  currency: 'RUP',
  storeId: 'store-1',
  storeName: 'NoName Centre',
  storeTimezone: 'UTC',
  // No pin: the page leaves the map out.
  storeLatitude: 0,
  storeLongitude: 0,
  storeAddress: 'Ленина 1',
  customerName: null,
  items: [],
  createdAt: minutesFromNow(-1),
  readyAt: null,
  cancelledAt: null,
  payment: { state: 'HELD', amountCents: 4500, cardMask: '•• 1234', paidAt: null },
};

const STORE: StoreDetail = {
  id: 'store-1',
  brandId: 'brand-1',
  slug: 'centre',
  name: 'NoName Centre',
  addressLine: 'Ленина 1',
  city: 'Тирасполь',
  country: 'MD',
  latitude: 0,
  longitude: 0,
  status: 'OPEN',
  fulfillmentTypes: ['TAKEAWAY'],
  pickupPointType: 'COUNTER',
  busyMeter: 0,
  currentEtaSeconds: 300,
  acceptingOrders: true,
  openNow: true,
  asapBlockedReason: null,
  taxRateBps: 0,
  taxIncludedInPrice: true,
  currency: 'RUP',
  timezone: 'UTC',
  heroImageUrl: null,
  distanceMeters: null,
  phone: '+373 69 123 456',
  email: null,
  minOrderCents: 0,
  galleryUrls: [],
  workingHours: [],
  brand: { id: 'brand-1', slug: 'noname', name: 'NoName', logoUrl: null, themeOverrides: null },
};

describe('OrderStatusPage — waiting for the store', () => {
  async function open(order: OrderView, store: Partial<StoreDetail> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'orders/:id', component: OrderStatusPage }]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: OrdersApi, useValue: { get: jest.fn(() => of(order)) } },
        {
          provide: CatalogService,
          useValue: {
            getStore: jest.fn(() => of({ ...STORE, ...store })),
            getMenu: jest.fn(() => of({ storeId: STORE.id, storeSlug: 'centre', categories: [] })),
          },
        },
        {
          provide: RealtimeService,
          useValue: { subscribeToOrder: () => () => undefined, onStoreAvailabilityChanged: () => () => undefined },
        },
        { provide: AuthStore, useValue: { user: signal(null) } },
        { provide: FeatureFlagsStore, useValue: { load: jest.fn(), webPaymentsEnabled: signal(false) } },
        { provide: WebPaymentApi, useValue: {} },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl(`/orders/${order.id}`, OrderStatusPage);
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    return { page, root, text: () => root.textContent ?? '' };
  }

  it('says a pre-order placed at night is confirmed once the store opens', async () => {
    const { page, text } = await open(ORDER, { openNow: false, asapBlockedReason: 'OUTSIDE_HOURS' });
    expect(text()).toContain('Точка подтвердит предзаказ, когда откроется');
    // Eight hours away: hours on the clock, not «480:00».
    expect(page.countdown()).toMatch(/^[78]:\d\d:\d\d$/);
  });

  it('waits for the store to confirm while it is open', async () => {
    const { text } = await open(ORDER);
    expect(text()).toContain('Ждём подтверждения точки');
  });

  it('owns up to running late, with a way to call the store', async () => {
    const { root, text } = await open({ ...ORDER, status: 'IN_PROGRESS', pickupAt: minutesFromNow(-3) });
    expect(text()).toContain('Немного задерживаемся');
    expect(root.querySelector('[data-testid="order-late"]')).not.toBeNull();
    const call = root.querySelector<HTMLAnchorElement>('[data-testid="call-store"]');
    expect(call?.getAttribute('href')).toBe('tel:+37369123456');
    expect(call?.textContent).toContain('Позвонить в точку');
  });

  it('offers no call when the store left no phone', async () => {
    const { root } = await open({ ...ORDER, status: 'ACCEPTED' }, { phone: null });
    expect(root.querySelector('[data-testid="call-store"]')).toBeNull();
  });

  it('says plainly why an expired order ended and where the money is', async () => {
    const notAccepted = await open({
      ...ORDER,
      status: 'EXPIRED',
      payment: { state: 'NONE', amountCents: 0, cardMask: null, paidAt: null },
    });
    expect(notAccepted.text()).toContain('Точка не подтвердила заказ — деньги не списаны');
    expect(notAccepted.text()).toContain('Деньги не списаны');
    expect(notAccepted.root.querySelector('[data-testid="call-store"]')).toBeNull();
  });

  it('tells an unpaid expired order from one the store never accepted', async () => {
    const { text } = await open({
      ...ORDER,
      status: 'EXPIRED',
      payment: { state: 'FAILED', amountCents: 4500, cardMask: null, paidAt: null },
    });
    expect(text()).toContain('Оплата не завершилась — заказ отменён');
  });
});
