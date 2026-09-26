import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { ActiveBrandService } from '../brand-context/active-brand.service';
import { AdminCatalogApi } from '../catalog/admin-catalog.service';
import type { KitchenOrderChanged } from './kitchen-board';
import { KitchenApi, type KitchenOrder } from './kitchen.api';
import { KitchenRealtimeService } from './kitchen-realtime.service';
import { OrderAlertsService } from './order-alerts.service';

function order(id: string, status: KitchenOrder['status']): KitchenOrder {
  return {
    id,
    orderCode: id.toUpperCase(),
    status,
    pickupMode: 'ASAP',
    pickupAt: '2026-09-26T10:00:00Z',
    createdAt: '2026-09-26T09:50:00Z',
    customerName: null,
    notes: null,
    items: [{ productSnapshot: {}, quantity: 2 }],
  };
}

describe('OrderAlertsService', () => {
  let role: ReturnType<typeof signal<string>>;
  let brandId: ReturnType<typeof signal<string | null>>;
  let list: jest.Mock;
  let run: jest.Mock;
  let listStores: jest.Mock;
  let emit: (event: KitchenOrderChanged) => void;
  let unwatch: jest.Mock;

  function setup(): OrderAlertsService {
    role = signal('BRAND_ADMIN');
    brandId = signal<string | null>('b1');
    list = jest.fn().mockReturnValue(of([order('old', 'PAID'), order('cooking', 'IN_PROGRESS')]));
    run = jest.fn().mockReturnValue(of({ id: 'x', status: 'ACCEPTED' }));
    listStores = jest.fn().mockReturnValue(of([{ id: 's1', name: 'Центр', timezone: 'Europe/Chisinau' }]));
    unwatch = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        { provide: AuthStore, useValue: { user: () => ({ role: role() }) } },
        { provide: ActiveBrandService, useValue: { activeId: brandId } },
        { provide: AdminCatalogApi, useValue: { listStores } },
        { provide: KitchenApi, useValue: { list, run } },
        {
          provide: KitchenRealtimeService,
          useValue: {
            watch: (_: string, handler: (e: KitchenOrderChanged) => void) => {
              emit = handler;
              return unwatch;
            },
          },
        },
      ],
    });
    const service = TestBed.inject(OrderAlertsService);
    service.soundOn.set(false);
    TestBed.tick();
    return service;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('counts orders already waiting without popping them up', () => {
    const service = setup();
    expect(listStores).toHaveBeenCalledWith('b1');
    expect(service.pendingCount()).toBe(1);
    expect(service.alerts()).toEqual([]);
  });

  it('pops up an order that arrives after the cabinet opened', () => {
    const service = setup();
    emit({ storeId: 's1', kind: 'created', orderId: 'new', order: order('new', 'PAID') });
    expect(service.pendingCount()).toBe(2);
    expect(service.alerts()).toEqual([
      expect.objectContaining({ orderId: 'new', orderCode: 'NEW', storeName: 'Центр', itemCount: 2 }),
    ]);

    // The same order again (a status echo) does not chime twice.
    emit({ storeId: 's1', kind: 'updated', orderId: 'new', order: order('new', 'PAID') });
    expect(service.alerts().length).toBe(1);
  });

  it('drops the pop-up once the order is accepted anywhere', () => {
    const service = setup();
    emit({ storeId: 's1', kind: 'created', orderId: 'new', order: order('new', 'PAID') });
    emit({ storeId: 's1', kind: 'updated', orderId: 'new', order: order('new', 'ACCEPTED') });
    expect(service.alerts()).toEqual([]);
    expect(service.pendingCount()).toBe(1);
  });

  it('accepts through the kitchen endpoint, where the card is charged', () => {
    const service = setup();
    emit({ storeId: 's1', kind: 'created', orderId: 'new', order: order('new', 'PAID') });
    service.accept('new');
    expect(run).toHaveBeenCalledWith('accept', 's1', 'new');
    expect(service.alerts()).toEqual([]);
  });

  it('keeps the pop-up with the reason when the accept fails', () => {
    const service = setup();
    TestBed.inject(TranslateService);
    run.mockReturnValue(
      throwError(() => ({ status: 400, error: { message: 'The card could not be charged: declined' } })),
    );
    emit({ storeId: 's1', kind: 'created', orderId: 'new', order: order('new', 'PAID') });
    service.accept('new');
    expect(service.alerts()[0]).toEqual(
      expect.objectContaining({ busy: false, error: 'The card could not be charged: declined' }),
    );
  });

  it('listens to nothing for a role that does not take orders', () => {
    const service = setup();
    role.set('MENU_EDITOR');
    TestBed.tick();
    expect(unwatch).toHaveBeenCalled();
    expect(service.pendingCount()).toBe(0);
  });
});
