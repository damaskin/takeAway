import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { StoreDetail } from '@takeaway/shared-types';
import { type Observable, of, throwError } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrdersApi, type OrderView } from '../../core/orders/orders.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { OrderStatusPage } from './order-status.page';

const minutesFromNow = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

/** 09:15 tomorrow in UTC, the store's zone here: always an hour or more away. */
const now = new Date();
const TOMORROW_0915 = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 9, 15),
).toISOString();

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
  let orders: { get: jest.Mock; cancel: jest.Mock };

  async function open(
    order: OrderView,
    store: Partial<StoreDetail> = {},
    cancel: () => Observable<OrderView> = () => of({ ...order, status: 'CANCELLED', canCancel: false }),
  ) {
    orders = { get: jest.fn(() => of(order)), cancel: jest.fn(cancel) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'orders/:id', component: OrderStatusPage }]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: OrdersApi, useValue: orders },
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
    const byTestId = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return {
      page,
      root,
      text: () => root.textContent ?? '',
      byTestId,
      /** The element's text, its child elements' texts joined by a space. */
      testText: (id: string) => {
        const el = byTestId(id);
        if (!el) return null;
        const parts =
          el.children.length > 0 ? Array.from(el.children, (c) => c.textContent ?? '') : [el.textContent ?? ''];
        return parts.join(' ').replace(/\s+/g, ' ').trim();
      },
      detect: () => harness.detectChanges(),
    };
  }

  it('says a pre-order placed at night is confirmed once the store opens', async () => {
    const { text } = await open(ORDER, { openNow: false, asapBlockedReason: 'OUTSIDE_HOURS' });
    expect(text()).toContain('Точка подтвердит предзаказ, когда откроется');
  });

  it('names the pickup time on the store clock for a pre-order hours away, not a countdown', async () => {
    const { byTestId, testText } = await open({ ...ORDER, pickupAt: TOMORROW_0915 });
    expect(testText('order-clock')).toBe('Будет готово к 09:15 Завтра');
    expect(byTestId('order-countdown')).toBeNull();
    expect(testText('pickup-when')).toBe('🚶 Заберёте в 09:15 завтра');
  });

  it('counts down, and says in how many minutes, under an hour away', async () => {
    const { page, byTestId, testText } = await open({ ...ORDER, pickupMode: 'ASAP', pickupAt: minutesFromNow(12) });
    expect(byTestId('order-clock')).toBeNull();
    expect(page.countdown()).toMatch(/^1[12]:\d\d$/);
    expect(byTestId('order-countdown')?.parentElement?.textContent).toContain('до выдачи');
    expect(testText('pickup-when')).toBe('🚶 Заберёте примерно через 12 мин');
  });

  it('shows the pickup code as the one thing to say at the counter, with no QR', async () => {
    const { text, testText } = await open(ORDER);
    expect(testText('pickup-code')).toBe('Ваш код 1234 Назовите его на кассе — по нему выдадут заказ');
    expect(text()).not.toContain('QR');
  });

  it("counts down to the kitchen's new estimate instead of saying it is late", async () => {
    const { byTestId, testText, page } = await open({
      ...ORDER,
      status: 'IN_PROGRESS',
      pickupAt: minutesFromNow(-3),
      readyEstimateAt: minutesFromNow(8),
    });
    expect(testText('order-subtitle')).toBe('Готовим · будет готово через 8 мин');
    expect(byTestId('order-late')).toBeNull();
    expect(page.countdown()).toMatch(/^[78]:\d\d$/);
    expect(testText('pickup-when')).toBe('🚶 Заберёте примерно через 8 мин');
  });

  it('says it is running late once the new estimate has passed too', async () => {
    const { byTestId, testText } = await open({
      ...ORDER,
      status: 'ACCEPTED',
      pickupAt: minutesFromNow(-10),
      readyEstimateAt: minutesFromNow(-1),
    });
    expect(testText('order-subtitle')).toBe('Немного задерживаемся');
    expect(byTestId('order-late')).not.toBeNull();
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

  describe('cancelling', () => {
    it('asks first, then cancels an order the store has not accepted', async () => {
      const { byTestId, detect, text } = await open({ ...ORDER, canCancel: true });
      byTestId('cancel-order')?.click();
      detect();
      expect(text()).toContain('Отменить заказ #1234?');
      expect(orders.cancel).not.toHaveBeenCalled();

      byTestId('confirm-accept')?.click();
      detect();
      expect(orders.cancel).toHaveBeenCalledWith('order-1');
      expect(byTestId('confirm-accept')).toBeNull();
      expect(byTestId('cancel-order')).toBeNull();
    });

    it('closes the question without cancelling on «Не отменять»', async () => {
      const { byTestId, detect } = await open(ORDER);
      byTestId('cancel-order')?.click();
      detect();
      byTestId('confirm-dismiss')?.click();
      detect();
      expect(byTestId('confirm-accept')).toBeNull();
      expect(orders.cancel).not.toHaveBeenCalled();
      expect(byTestId('cancel-order')).not.toBeNull();
    });

    it('offers no cancel once the kitchen accepted, and says to call the store', async () => {
      const { byTestId, testText } = await open({ ...ORDER, status: 'ACCEPTED', canCancel: false });
      expect(byTestId('cancel-order')).toBeNull();
      expect(testText('cancel-note')).toContain('Заказ уже готовят — для отмены позвоните в точку');
      expect(byTestId('cancel-call-store')?.getAttribute('href')).toBe('tel:+37369123456');
    });

    it('says so plainly when the store left no phone', async () => {
      const { byTestId, testText } = await open({ ...ORDER, status: 'IN_PROGRESS' }, { phone: null });
      expect(testText('cancel-note')).toBe('Заказ уже готовят — отменить его уже нельзя');
      expect(byTestId('cancel-call-store')).toBeNull();
    });

    it('follows canCancel from the API: no cancel once the money is taken', async () => {
      const { byTestId, testText } = await open({
        ...ORDER,
        status: 'PAID',
        canCancel: false,
        payment: { state: 'PAID', amountCents: 4500, cardMask: null, paidAt: minutesFromNow(-1) },
      });
      expect(byTestId('cancel-order')).toBeNull();
      expect(testText('cancel-note')).toContain('Оплата уже прошла — для отмены позвоните в точку');
    });

    it('falls back to CREATED and PAID on an API without canCancel', async () => {
      const older = { ...ORDER } as Partial<OrderView>;
      delete older.canCancel;
      const created = await open(older as OrderView);
      expect(created.byTestId('cancel-order')).not.toBeNull();
      TestBed.resetTestingModule();

      const ready = await open({ ...(older as OrderView), status: 'READY' });
      expect(ready.byTestId('cancel-order')).toBeNull();
      expect(ready.byTestId('cancel-note')).toBeNull();
    });

    it('reads the order again and says to call when the kitchen accepted it a moment ago', async () => {
      const { byTestId, detect, testText } = await open(ORDER, {}, () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { statusCode: 409, code: 'ORDER_NOT_CANCELLABLE', reason: 'ACCEPTED' },
            }),
        ),
      );
      byTestId('cancel-order')?.click();
      detect();
      byTestId('confirm-accept')?.click();
      detect();

      expect(orders.get).toHaveBeenCalledTimes(2);
      expect(byTestId('confirm-accept')).toBeNull();
      expect(byTestId('cancel-order')).toBeNull();
      expect(testText('cancel-note')).toContain('Заказ уже готовят — для отмены позвоните в точку');
    });

    it('keeps the button for another try after a failure of another kind', async () => {
      const { byTestId, detect, testText } = await open(ORDER, {}, () =>
        throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } })),
      );
      byTestId('cancel-order')?.click();
      detect();
      byTestId('confirm-accept')?.click();
      detect();
      expect(testText('cancel-error')).toBe('Не удалось отменить заказ. Попробуйте ещё раз.');
      expect(byTestId('cancel-order')).not.toBeNull();
    });
  });
});
