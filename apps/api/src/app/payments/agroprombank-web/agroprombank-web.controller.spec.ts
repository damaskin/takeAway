import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AgroprombankWebController } from './agroprombank-web.controller';
import { AgroprombankWebService } from './agroprombank-web.service';

/**
 * The three addresses registered at the bank, over a real Fastify instance:
 * the bank posts an HTML form or calls with a query string, and the customer's
 * browser has to get a redirect it can follow.
 */
describe('AgroprombankWebController (Fastify)', () => {
  let app: NestFastifyApplication;
  const web = {
    handleNotification: jest.fn(),
    handleReturn: jest.fn(),
    startPayment: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AgroprombankWebController],
      providers: [{ provide: AgroprombankWebService, useValue: web }],
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

  it('reads a form-encoded ResultURL notification and answers OK', async () => {
    web.handleNotification.mockResolvedValue(true);

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/agroprombank-web/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'status=paid&InvoiceId=1100042&paymentsum=3300&paymentcurrency=000&date=04102026&signature=ABC',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('OK');
    expect(web.handleNotification).toHaveBeenCalledWith({
      status: 'paid',
      invoiceid: '1100042',
      paymentsum: '3300',
      paymentcurrency: '000',
      date: '04102026',
      signature: 'ABC',
    });
  });

  it('reads a notification sent as GET', async () => {
    web.handleNotification.mockResolvedValue(true);

    const response = await app.inject({
      method: 'GET',
      url: '/api/payments/agroprombank-web/result?status=fail&invoiceid=7',
    });

    expect(response.statusCode).toBe(200);
    expect(web.handleNotification).toHaveBeenCalledWith({ status: 'fail', invoiceid: '7' });
  });

  it('turns away a notification that failed verification', async () => {
    web.handleNotification.mockResolvedValue(false);

    const response = await app.inject({ method: 'GET', url: '/api/payments/agroprombank-web/result?invoiceid=7' });

    expect(response.statusCode).toBe(400);
  });

  it.each([
    ['GET', 'success'],
    ['POST', 'success'],
    ['GET', 'fail'],
    ['POST', 'fail'],
  ] as const)('redirects the customer back to the order on %s %s', async (method, outcome) => {
    web.handleReturn.mockResolvedValue('https://takeaway.md/orders/order-1?payment=success');

    const response = await app.inject({
      method,
      url: `/api/payments/agroprombank-web/${outcome}${method === 'GET' ? '?invoiceid=1100042' : ''}`,
      ...(method === 'POST'
        ? { headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'invoiceid=1100042' }
        : {}),
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('https://takeaway.md/orders/order-1?payment=success');
    expect(web.handleReturn).toHaveBeenCalledWith(outcome, { invoiceid: '1100042' });
  });
});
