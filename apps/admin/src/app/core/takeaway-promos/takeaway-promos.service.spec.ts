import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { BrandTakeawayPromoReport, TakeawayPromo } from '@takeaway/shared-types';

import { API_CONFIG, DEFAULT_API_CONFIG } from '../api/api.config';
import { SettlementsApi } from '../settlements/settlements.service';
import { TakeawayPromosApi } from './takeaway-promos.service';

describe('TakeawayPromosApi', () => {
  let api: TakeawayPromosApi;
  let settlements: SettlementsApi;
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
    api = TestBed.inject(TakeawayPromosApi);
    settlements = TestBed.inject(SettlementsApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('lists, reads, creates and edits promos under /admin/takeaway-promos', () => {
    api.list().subscribe();
    backend.expectOne({ method: 'GET', url: '/api/admin/takeaway-promos' }).flush([]);

    api.get('tp 1').subscribe();
    backend.expectOne({ method: 'GET', url: '/api/admin/takeaway-promos/tp%201' }).flush({});

    const body = {
      name: 'Приветственный бонус',
      code: 'HELLO10',
      percent: 10,
      startsAt: '2026-11-10T00:00:00.000Z',
      endsAt: '2026-12-10T00:00:00.000Z',
      currency: 'RUP',
      budgetCents: 500_000,
      isWelcome: true,
    };
    api.create(body).subscribe();
    const create = backend.expectOne({ method: 'POST', url: '/api/admin/takeaway-promos' });
    expect(create.request.body).toEqual(body);
    create.flush({} as TakeawayPromo);

    api.update('tp1', { name: 'Бонус', budgetCents: 600_000 }).subscribe();
    const update = backend.expectOne({ method: 'PATCH', url: '/api/admin/takeaway-promos/tp1' });
    expect(update.request.body).toEqual({ name: 'Бонус', budgetCents: 600_000 });
    update.flush({});
  });

  it('switches a promo off and on through its status route', () => {
    api.setStatus('tp1', 'DISABLED').subscribe();
    const req = backend.expectOne({ method: 'PATCH', url: '/api/admin/takeaway-promos/tp1/status' });
    expect(req.request.body).toEqual({ status: 'DISABLED' });
    req.flush({});
  });

  it('reads the report of a promo and the debt to every brand', () => {
    api.report('tp1').subscribe();
    backend.expectOne({ method: 'GET', url: '/api/admin/takeaway-promos/tp1/report' }).flush({});

    api.debt().subscribe();
    backend.expectOne({ method: 'GET', url: '/api/admin/takeaway-promos/debt' }).flush({ rows: [], totals: [] });
  });

  it("asks settlements for the brand's promo orders with the page's brand, currency and period", () => {
    let answer: BrandTakeawayPromoReport | undefined;
    settlements
      .takeawayPromos({ brandId: 'b1', currency: 'RUP', from: '2026-11-02', to: '2026-11-08' })
      .subscribe((r) => (answer = r));

    const req = backend.expectOne((r) => r.url === '/api/admin/settlements/takeaway-promos');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('brandId')).toBe('b1');
    expect(req.request.params.get('currency')).toBe('RUP');
    expect(req.request.params.get('from')).toBe('2026-11-02');
    expect(req.request.params.get('to')).toBe('2026-11-08');
    req.flush({ brandId: 'b1', currency: 'RUP', items: [] });
    expect(answer?.brandId).toBe('b1');
  });

  it("leaves the brand out for a brand owner's own settlements", () => {
    settlements.takeawayPromos({ brandId: null, currency: null, from: '2026-11-02', to: '2026-11-08' }).subscribe();
    const req = backend.expectOne((r) => r.url === '/api/admin/settlements/takeaway-promos');
    expect(req.request.params.has('brandId')).toBe(false);
    expect(req.request.params.has('currency')).toBe(false);
    req.flush({});
  });
});
