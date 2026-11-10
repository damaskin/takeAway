import { Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AgroprombankQrController } from './agroprombank-qr.controller';
import { AgroprombankQrService } from './agroprombank-qr.service';

/**
 * The QR routes over a real Fastify instance: the customer's three, and the
 * callback the bank posts as a form — always answered 200 `OK`.
 */
describe('AgroprombankQrController (Fastify)', () => {
  let app: NestFastifyApplication;
  const qr = {
    startPayment: jest.fn(),
    getPayment: jest.fn(),
    cancelPayment: jest.fn(),
    handleCallback: jest.fn(),
  };
  const dto = {
    paymentId: 'pay-1',
    orderId: 'order-1',
    status: 'PENDING',
    amountCents: 3300,
    currency: 'RUP',
    qr: null,
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AgroprombankQrController],
      providers: [
        { provide: AgroprombankQrService, useValue: qr },
        // Stands in for the JWT guard: every request is customer user-1.
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
              ctx.switchToHttp().getRequest().user = { id: 'user-1' };
              return true;
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.resetAllMocks());

  it('starts a payment for the signed-in customer', async () => {
    qr.startPayment.mockResolvedValue(dto);

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/agroprombank-qr/start',
      payload: { orderId: 'order-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(dto);
    expect(qr.startPayment).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it('answers the status and closes the invoice', async () => {
    qr.getPayment.mockResolvedValue(dto);
    qr.cancelPayment.mockResolvedValue({ ...dto, status: 'EXPIRED' });

    const status = await app.inject({ method: 'GET', url: '/api/payments/agroprombank-qr/pay-1' });
    const cancel = await app.inject({ method: 'POST', url: '/api/payments/agroprombank-qr/pay-1/cancel' });

    expect(status.statusCode).toBe(200);
    expect(qr.getPayment).toHaveBeenCalledWith('user-1', 'pay-1');
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ status: 'EXPIRED' });
    expect(qr.cancelPayment).toHaveBeenCalledWith('user-1', 'pay-1');
  });

  it('reads the form-encoded callback and answers OK', async () => {
    qr.handleCallback.mockResolvedValue(undefined);
    const payments = '<Payments><Payment><externalid>1100042</externalid><state>2</state></Payment></Payments>';
    const trx = '<trx type="debet"><rrn>000602981706</rrn></trx>';

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/agroprombank-qr/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ payments, trx }).toString(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('OK');
    expect(qr.handleCallback).toHaveBeenCalledWith({ payments, trx });
  });

  it('answers OK whatever happens behind the callback', async () => {
    qr.handleCallback.mockRejectedValue(new Error('database down'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/agroprombank-qr/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'Payments=x',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('OK');
    expect(qr.handleCallback).toHaveBeenCalledWith({ payments: 'x', trx: null });
    error.mockRestore();
  });
});
