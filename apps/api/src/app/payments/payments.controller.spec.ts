import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Stripe signs the bytes it sends. The webhook used to get a re-serialised
 * copy of the parsed body — different whitespace and key order, so a genuine
 * signature could never verify.
 */
describe('POST /payments/webhook', () => {
  let app: NestFastifyApplication;
  const handleWebhook = jest.fn(async () => undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: { handleWebhook } }],
    }).compile();
    // As in main.ts.
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { rawBody: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('hands the exact request bytes to the signature check', async () => {
    const body = '{"type": "payment_intent.succeeded",\n  "id":"evt_1"}';
    const res = await app.inject({
      method: 'POST',
      url: '/payments/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=abc' },
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const [raw, signature] = handleWebhook.mock.calls[0] as unknown as [Buffer, string];
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw.toString('utf8')).toBe(body);
    expect(signature).toBe('t=1,v1=abc');
  });
});
