import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
  let orders: { get: jest.Mock; cancel: jest.Mock; reportLocation: jest.Mock };
  let confirm: jest.Mock;

  async function open(first: OrderView, opts: { phone?: string } = {}) {
    orders = { get: jest.fn(() => of(first)), cancel: jest.fn(), reportLocation: jest.fn(() => of({})) };
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
          useValue: { subscribeToOrder: () => () => undefined, onStoreAvailabilityChanged: () => () => undefined },
        },
        { provide: FeatureFlagsStore, useValue: { load: jest.fn(), webPaymentsEnabled: signal(false) } },
        { provide: WebPaymentApi, useValue: { issuedPageUrl: () => null, forget: jest.fn(), start: jest.fn() } },
        {
          provide: TelegramBridgeService,
          useValue: { haptic: jest.fn(), confirm, setBackButton: () => () => undefined, openLink: jest.fn() },
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
    return { page, root, byTestId, settle, destroy: () => harness.fixture.destroy() };
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
});
