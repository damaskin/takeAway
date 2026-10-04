import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../api/api.config';
import { WebPaymentApi } from './web-payment.service';

describe('web WebPaymentApi', () => {
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

  afterEach(() => {
    http.verify();
    document.body.querySelectorAll('form').forEach((f) => f.remove());
    jest.restoreAllMocks();
  });

  it('starts the payment for this order, coming back to the web app', () => {
    api.start('ord-1').subscribe();
    const req = http.expectOne('/api/payments/agroprombank-web/start');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ orderId: 'ord-1', returnTo: 'web' });
    req.flush({ paymentId: 'p', invoiceId: 'i', status: 'PENDING', page: null, expiresAt: null });
  });

  // The fields are signed by the server; the bank rejects anything altered.
  it('posts the signed fields to the bank page unchanged', () => {
    const submit = jest.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);

    api.redirectToBank({
      method: 'POST',
      action: 'https://bank.example/PaymentStart',
      fields: { nivid: 'inv-1', amount: '12.50', sign: 'abc=' },
      url: 'https://bank.example/PaymentStart?nivid=inv-1',
    });

    const form = document.body.querySelector('form');
    expect(form).not.toBeNull();
    expect(form?.method.toUpperCase()).toBe('POST');
    expect(form?.action).toBe('https://bank.example/PaymentStart');
    const fields = Object.fromEntries(
      Array.from(form?.querySelectorAll('input') ?? []).map((input) => [input.name, input.value]),
    );
    expect(fields).toEqual({ nivid: 'inv-1', amount: '12.50', sign: 'abc=' });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
