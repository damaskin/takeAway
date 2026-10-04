import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../api/api.config';
import { FeatureFlagsStore, resolveCardPaymentFlow } from './feature-flags.store';

describe('resolveCardPaymentFlow', () => {
  it('takes the flow the server names', () => {
    expect(resolveCardPaymentFlow({ deliveryEnabled: false, agroprombankEnabled: true, cardPaymentFlow: 'web' })).toBe(
      'web',
    );
    expect(
      resolveCardPaymentFlow({ deliveryEnabled: false, agroprombankEnabled: false, cardPaymentFlow: 'token' }),
    ).toBe('token');
  });

  // A server from before the field only knows bound cards.
  it('falls back to agroprombankEnabled when the field is missing', () => {
    expect(resolveCardPaymentFlow({ deliveryEnabled: false, agroprombankEnabled: true })).toBe('token');
    expect(resolveCardPaymentFlow({ deliveryEnabled: false, agroprombankEnabled: false })).toBe('none');
  });
});

describe('web FeatureFlagsStore', () => {
  let store: FeatureFlagsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      ],
    });
    store = TestBed.inject(FeatureFlagsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('keeps card payments off until the server answers', () => {
    expect(store.cardPaymentFlow()).toBe('none');
    expect(store.cardPaymentsEnabled()).toBe(false);
  });

  it('turns on the bank-page flow without bound cards', () => {
    store.load();
    http
      .expectOne('/api/config/features')
      .flush({ deliveryEnabled: false, agroprombankEnabled: true, cardPaymentFlow: 'web' });

    expect(store.cardPaymentsEnabled()).toBe(true);
    expect(store.webPaymentsEnabled()).toBe(true);
    expect(store.boundCardsEnabled()).toBe(false);
  });

  it('keeps the bound-card flow on an older server', () => {
    store.load();
    http.expectOne('/api/config/features').flush({ deliveryEnabled: false, agroprombankEnabled: true });

    expect(store.boundCardsEnabled()).toBe(true);
    expect(store.webPaymentsEnabled()).toBe(false);
  });
});
