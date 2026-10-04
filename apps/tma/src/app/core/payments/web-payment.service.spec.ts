import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../api/api.config';
import { WebPaymentApi } from './web-payment.service';

const PAGE = {
  method: 'POST' as const,
  action: 'https://bank.example/PaymentStart',
  fields: { nivid: 'inv-1' },
  url: 'https://bank.example/PaymentStart?nivid=inv-1',
};

describe('tma WebPaymentApi', () => {
  let api: WebPaymentApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      ],
    });
    api = TestBed.inject(WebPaymentApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function start(orderId: string, page: typeof PAGE | null, expiresAt: string | null): void {
    api.start(orderId).subscribe();
    const req = http.expectOne('/api/payments/agroprombank-web/start');
    expect(req.request.body).toEqual({ orderId, returnTo: 'tma' });
    req.flush({ paymentId: 'p', invoiceId: 'inv-1', status: 'PENDING', page, expiresAt });
  }

  // Telegram opens outside links only straight from a tap, so the order
  // screen needs the issued page at hand, without a request in between.
  it('keeps the issued page for the order', () => {
    start('ord-1', PAGE, new Date(Date.now() + 60_000).toISOString());
    expect(api.issuedPageUrl('ord-1')).toBe(PAGE.url);
    expect(api.issuedPageUrl('ord-2')).toBeNull();
  });

  it('drops a page the bank no longer takes', () => {
    start('ord-1', PAGE, new Date(Date.now() - 1_000).toISOString());
    expect(api.issuedPageUrl('ord-1')).toBeNull();
  });

  it('drops the page once nothing is left to pay', () => {
    start('ord-1', PAGE, null);
    start('ord-1', null, null);
    expect(api.issuedPageUrl('ord-1')).toBeNull();
  });
});
