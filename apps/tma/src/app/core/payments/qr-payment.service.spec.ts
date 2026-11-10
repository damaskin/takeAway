import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AgroprombankQrPaymentDto } from '@takeaway/shared-types';

import { API_CONFIG } from '../api/api.config';
import { QrPaymentApi } from './qr-payment.service';

const PENDING: AgroprombankQrPaymentDto = {
  paymentId: 'pay-1',
  orderId: 'ord-1',
  status: 'PENDING',
  amountCents: 4500,
  currency: 'RUP',
  qr: { code: 'QRT000000000000123:45.00:42', appLink: null, expiresAt: '2026-11-10T12:10:00Z' },
};

describe('tma QrPaymentApi', () => {
  let api: QrPaymentApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      ],
    });
    api = TestBed.inject(QrPaymentApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts, reads and cancels the invoice on the routes of §12.3', () => {
    api.start('ord-1').subscribe();
    const start = http.expectOne('/api/payments/agroprombank-qr/start');
    expect(start.request.method).toBe('POST');
    expect(start.request.body).toEqual({ orderId: 'ord-1' });
    start.flush(PENDING);

    api.status('pay-1').subscribe();
    const status = http.expectOne('/api/payments/agroprombank-qr/pay-1');
    expect(status.request.method).toBe('GET');
    status.flush(PENDING);

    api.cancel('pay-1').subscribe();
    const cancel = http.expectOne('/api/payments/agroprombank-qr/pay-1/cancel');
    expect(cancel.request.method).toBe('POST');
    cancel.flush({ ...PENDING, status: 'EXPIRED', qr: null });
  });

  it('hands the invoice checkout issued to the QR screen while it still waits', () => {
    const before = Date.parse('2026-11-10T12:05:00Z');
    expect(api.issued('ord-1', before)).toBeNull();

    api.start('ord-1').subscribe();
    http.expectOne('/api/payments/agroprombank-qr/start').flush(PENDING);
    expect(api.issued('ord-1', before)).toEqual(PENDING);
    // Lapsed: the screen asks again.
    expect(api.issued('ord-1', Date.parse('2026-11-10T12:10:00Z'))).toBeNull();

    api.cancel('pay-1').subscribe();
    http.expectOne('/api/payments/agroprombank-qr/pay-1/cancel').flush({ ...PENDING, status: 'EXPIRED', qr: null });
    expect(api.issued('ord-1', before)).toBeNull();
  });
});
