import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG, DEFAULT_API_CONFIG } from '../api/api.config';
import { KitchenApi, type KitchenRejectResult } from './kitchen.api';

describe('KitchenApi.reject', () => {
  let api: KitchenApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_CONFIG, useValue: DEFAULT_API_CONFIG },
      ],
    });
    api = TestBed.inject(KitchenApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('posts the reason and comment to the store-scoped reject endpoint', () => {
    let result: KitchenRejectResult | undefined;
    api.reject('store-1', 'order-1', { reason: 'OUT_OF_STOCK', comment: 'No oat milk' }).subscribe((r) => (result = r));

    const req = backend.expectOne((r) => r.url === '/api/kds/orders/order-1/reject');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('storeId')).toBe('store-1');
    expect(req.request.body).toEqual({ reason: 'OUT_OF_STOCK', comment: 'No oat milk' });

    req.flush({ id: 'order-1', status: 'CANCELLED', orderCode: 'A12', money: 'released' });
    expect(result?.money).toBe('released');
  });
});

describe('KitchenApi pause', () => {
  let api: KitchenApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_CONFIG, useValue: DEFAULT_API_CONFIG },
      ],
    });
    api = TestBed.inject(KitchenApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('puts the pause on the store and takes it off again', () => {
    api.pause('store-1', { minutes: null, reason: 'EQUIPMENT', comment: 'кофемашина' }).subscribe();
    const put = backend.expectOne((r) => r.url === '/api/kds/pause');
    expect(put.request.method).toBe('PUT');
    expect(put.request.params.get('storeId')).toBe('store-1');
    expect(put.request.body).toEqual({ minutes: null, reason: 'EQUIPMENT', comment: 'кофемашина' });
    put.flush({ storeId: 'store-1' });

    api.resume('store-1').subscribe();
    const del = backend.expectOne((r) => r.url === '/api/kds/pause');
    expect(del.request.method).toBe('DELETE');
    expect(del.request.params.get('storeId')).toBe('store-1');
    del.flush({ storeId: 'store-1' });
  });
});
