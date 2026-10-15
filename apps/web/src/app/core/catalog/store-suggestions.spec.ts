import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentInjector, type Signal, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { StoreSuggestions } from '@takeaway/shared-types';

import { API_CONFIG } from '../api/api.config';
import { type SuggestionsQuery, storeSuggestions } from './store-suggestions';

describe('storeSuggestions', () => {
  let http: HttpTestingController;
  let query: ReturnType<typeof signal<SuggestionsQuery | null>>;
  let answer: Signal<StoreSuggestions | null | undefined>;

  const together: StoreSuggestions = { productIds: ['croissant'], source: 'copurchase' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    query = signal<SuggestionsQuery | null>({ storeId: 'store-1', productIds: ['latte', 'americano', 'latte'] });
    answer = runInInjectionContext(TestBed.inject(EnvironmentInjector), () => storeSuggestions(query));
  });

  afterEach(() => http.verify());

  const expectAsk = (productIds: string) =>
    http.expectOne(
      (req) => req.url === '/api/stores/store-1/suggestions' && req.params.get('productIds') === productIds,
    );

  it('asks for the set of products once and shows nothing until the answer lands', () => {
    TestBed.tick();
    const req = expectAsk('americano,latte');
    expect(req.request.params.get('limit')).toBe('6');
    expect(answer()).toBeUndefined();
    req.flush(together);
    expect(answer()).toEqual(together);

    // Same products in another order, or another quantity: nothing to ask.
    query.set({ storeId: 'store-1', productIds: ['americano', 'latte'] });
    TestBed.tick();
    http.expectNone('/api/stores/store-1/suggestions');
  });

  it('keeps the last answer while a new set is asked, then takes the new one', () => {
    TestBed.tick();
    expectAsk('americano,latte').flush(together);

    query.set({ storeId: 'store-1', productIds: ['latte', 'americano', 'croissant'] });
    TestBed.tick();
    const req = expectAsk('americano,croissant,latte');
    expect(answer()).toEqual(together);
    req.flush({ productIds: [], source: 'rule' });
    expect(answer()).toEqual({ productIds: [], source: 'rule' });
  });

  it('reads a failed call, as from an API without the endpoint, as null', () => {
    TestBed.tick();
    expectAsk('americano,latte').flush('Not Found', { status: 404, statusText: 'Not Found' });
    expect(answer()).toBeNull();
  });

  it('asks nothing with nothing in hand', () => {
    query.set({ storeId: 'store-1', productIds: [] });
    TestBed.tick();
    query.set(null);
    TestBed.tick();
    http.expectNone(() => true);
    expect(answer()).toBeUndefined();
  });
});
