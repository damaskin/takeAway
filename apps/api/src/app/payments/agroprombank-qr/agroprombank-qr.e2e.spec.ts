import { type Server, createServer } from 'node:http';

import type { HttpException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import type { AgroprombankClient } from '../agroprombank/agroprombank.client';
import type { AgroprombankConfig } from '../agroprombank/agroprombank.config';
import { PaymentHoldsService } from '../agroprombank/payment-holds.service';
import type { AgroprombankService } from '../agroprombank/agroprombank.service';
import type { AgroprombankWebClient } from '../agroprombank-web/agroprombank-web.client';
import type { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import type { AgroprombankWebService } from '../agroprombank-web/agroprombank-web.service';
import { CardPaymentsService } from '../card-payments.service';
import { releaseOutcome } from '../card-providers';
import type { OrderSettlementService } from '../order-settlement.service';
import { AgroprombankQrClient, AgroprombankQrError, AgroprombankQrTransportError } from './agroprombank-qr.client';
import type { AgroprombankQrConfig } from './agroprombank-qr.config';
import { AgroprombankQrService } from './agroprombank-qr.service';
import { DEFAULT_QR_CODE_FORMAT, DEFAULT_QR_NAMESPACE } from './constants';
import { createMemoryDb } from './testing/memory-db';
import {
  QR_APP_PATH,
  QR_REFUSE_AMOUNT,
  QR_SERVICE_PATH,
  SANDBOX_QR_STATE,
  type SandboxQrBank,
  createSandboxQrBank,
} from './testing/sandbox-qr-bank';

/**
 * «Мобильный платёж» end to end against the sandbox bank, over real HTTP:
 * the SOAP service with its credentials header, the fake bank app, and the
 * callback to us.
 *
 * The first half drives the client alone. The second runs the service —
 * checkout, the callback, the kitchen's accept, a rejection, a lost callback,
 * a lapsed invoice, late money, a wrong sum — over an in-memory stand-in for
 * the tables it touches, so what is asserted is the money moving at the bank.
 */
describe('Agroprombank QR payment end-to-end (sandbox bank)', () => {
  const TERMINAL = 'QRT169007299815722';
  const CREDENTIALS = { login: 'takeaway', password: 'sandbox-pass' };

  /** Our callback route: hands every call to whatever the test plugs in. */
  let onCallback: (fields: { payments: string | null; trx: string | null }) => Promise<void> = async () => undefined;
  let receiver: Server;
  let bank: SandboxQrBank;
  let baseUrl: string;
  let config: AgroprombankQrConfig;
  let client: AgroprombankQrClient;

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        void onCallback({ payments: form.get('payments'), trx: form.get('trx') }).then(() => res.end('OK'));
      });
    });
    const receiverPort = await new Promise<number>((resolve) =>
      receiver.listen(0, () => resolve((receiver.address() as { port: number }).port)),
    );

    bank = createSandboxQrBank({ ...CREDENTIALS, callbackUrl: `http://127.0.0.1:${receiverPort}/callback` });
    const port = await bank.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
    config = qrConfig({});
    client = new AgroprombankQrClient(config);
  });

  afterAll(async () => {
    await bank.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  });

  beforeEach(() => {
    onCallback = async () => undefined;
    bank.amountUnit = 'kopecks';
    bank.refuseReverse = false;
  });

  function qrConfig(overrides: Record<string, unknown>): AgroprombankQrConfig {
    return {
      enabled: true,
      serviceUrl: `${baseUrl}${QR_SERVICE_PATH}`,
      namespace: DEFAULT_QR_NAMESPACE,
      login: CREDENTIALS.login,
      password: CREDENTIALS.password,
      externalToken: null,
      terminalId: TERMINAL,
      codeFormat: DEFAULT_QR_CODE_FORMAT,
      appLink: `${baseUrl}${QR_APP_PATH}?code={code}`,
      lifetimeMinutes: 10,
      timeoutMs: 10_000,
      invoicePrefix: '9',
      isConfigured: true,
      canCallBank: true,
      currencies: ['RUP'],
      missingSettings: () => [],
      ...overrides,
    } as unknown as AgroprombankQrConfig;
  }

  let nextExtid = 7_000_000;
  const freshExtid = (): string => String((nextExtid += 1));

  describe('client', () => {
    it('issues an invoice in kopecks and reads it back unpaid', async () => {
      const extid = freshExtid();
      const id = await client.createPaymentId(extid, 1250);

      expect(id).toMatch(/^\d+$/);
      expect(bank.payments.get(id)).toMatchObject({ externalId: extid, amount: 1250, terminalId: TERMINAL });
      const record = await client.getPaymentStateExtId(extid);
      expect(record).toMatchObject({ qrPaymentId: id, externalId: extid, state: SANDBOX_QR_STATE.WAITING });
      expect(bank.calls).toContain(`CreatePaymentID ${TERMINAL} 1250 ${extid}`);
    });

    it('reads a paid invoice with the RRN that ReversePayment needs, and reverses it', async () => {
      const extid = freshExtid();
      const id = await client.createPaymentId(extid, 3300);
      const paid = await bank.pay(extid, { silent: true });

      const record = await client.getPaymentStateExtId(extid);
      expect(record).toMatchObject({ state: 2, rrn: paid.rrn, amount: '3300', currencyCode: '000' });

      const after = await client.reverseInvoice(extid, { qrPaymentId: null, rrn: null });

      expect(bank.calls).toContain(`ReversePayment ${TERMINAL} ${id} ${paid.rrn}`);
      expect(after?.state).toBe(SANDBOX_QR_STATE.REVERSED);
    });

    it('closes an unpaid invoice', async () => {
      const extid = freshExtid();
      await client.createPaymentId(extid, 500);
      await client.closePaymentExtId(extid);
      expect((await client.getPaymentStateExtId(extid))?.state).toBe(SANDBOX_QR_STATE.CLOSED);
    });

    it('answers null for an invoice the bank does not know', async () => {
      await expect(client.getPaymentStateExtId('404404')).resolves.toBeNull();
    });

    it('reports a refused invoice and wrong credentials as the bank saying no', async () => {
      await expect(client.createPaymentId(freshExtid(), QR_REFUSE_AMOUNT)).rejects.toBeInstanceOf(AgroprombankQrError);

      const intruder = new AgroprombankQrClient(qrConfig({ password: 'wrong' }));
      await expect(intruder.createPaymentId(freshExtid(), 100)).rejects.toMatchObject({
        name: 'AgroprombankQrError',
        description: expect.stringContaining('авторизации'),
      });
    });

    it('signs in with an external token instead, sending login and password empty', async () => {
      const tokenBank = createSandboxQrBank({ login: 'x', password: 'y', externalToken: 'tok-1', callbackUrl: null });
      const port = await tokenBank.listen(0);
      try {
        const tokenClient = new AgroprombankQrClient(
          qrConfig({ serviceUrl: `http://127.0.0.1:${port}${QR_SERVICE_PATH}`, externalToken: 'tok-1' }),
        );
        await expect(tokenClient.createPaymentId(freshExtid(), 100)).resolves.toMatch(/^\d+$/);
      } finally {
        await tokenBank.close();
      }
    });

    it('reports a bank it cannot reach as a transport failure', async () => {
      const unreachable = new AgroprombankQrClient(
        qrConfig({ serviceUrl: 'http://127.0.0.1:9/mobile/QRMobileService.asmx', timeoutMs: 2_000 }),
      );
      await expect(unreachable.getPaymentStateExtId('1')).rejects.toBeInstanceOf(AgroprombankQrTransportError);
    });

    it('serves a fake bank app that pays the invoice from its QR text', async () => {
      const extid = freshExtid();
      await client.createPaymentId(extid, 990);
      const code = `${TERMINAL}:9.90:${extid}`;

      const page = await fetch(`${baseUrl}${QR_APP_PATH}?code=${encodeURIComponent(code)}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Оплатить');

      const paid = await fetch(`${baseUrl}${QR_APP_PATH}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `extid=${extid}`,
      });
      expect(paid.status).toBe(200);
      expect((await client.getPaymentStateExtId(extid))?.state).toBe(2);
    });
  });

  describe('service', () => {
    let db: ReturnType<typeof createMemoryDb>;
    let service: AgroprombankQrService;
    let holds: PaymentHoldsService;
    let cards: CardPaymentsService;
    let settlement: { announceHeld: jest.Mock; settlePaidOrder: jest.Mock };

    beforeEach(() => {
      db = createMemoryDb();
      settlement = {
        announceHeld: jest.fn().mockResolvedValue(undefined),
        settlePaidOrder: jest.fn(async (orderId: string) => {
          const order = db.orders.get(orderId);
          if (order && order.status === 'CREATED') order.status = 'PAID';
          return order;
        }),
      };
      holds = new PaymentHoldsService(
        db.prisma as unknown as PrismaService,
        { isConfigured: false } as unknown as AgroprombankConfig,
        {} as AgroprombankClient,
        { isConfigured: false, cardPaymentFlow: 'none' } as unknown as AgroprombankWebConfig,
        {} as AgroprombankWebClient,
        config,
        client,
      );
      service = new AgroprombankQrService(
        db.prisma as unknown as PrismaService,
        config,
        client,
        settlement as unknown as OrderSettlementService,
        holds,
      );
      cards = new CardPaymentsService(holds, {} as AgroprombankService, {} as AgroprombankWebService, service);
      onCallback = (fields) => service.handleCallback(fields);
    });

    it('issues an invoice once, is paid through the callback, and settles on accept with no bank call', async () => {
      db.addOrder('order-1', 3300);

      const started = await service.startPayment('user-1', 'order-1');
      const extid = db.payments.get(started.paymentId)?.invoiceId as string;

      expect(started).toMatchObject({ status: 'PENDING', amountCents: 3300, currency: 'RUP' });
      expect(extid).toMatch(/^9\d+$/);
      expect(started.qr?.code).toBe(`${TERMINAL}:33.00:${extid}`);
      expect(started.qr?.appLink).toBe(`${baseUrl}${QR_APP_PATH}?code=${encodeURIComponent(started.qr?.code ?? '')}`);

      // A reload answers the same invoice and issues nothing new.
      const again = await service.startPayment('user-1', 'order-1');
      expect(again).toEqual(started);
      expect(bank.calls.filter((c) => c.startsWith('CreatePaymentID') && c.endsWith(extid))).toHaveLength(1);

      // The customer pays from the code they were shown, through the bank app.
      const page = await fetch(started.qr?.appLink ?? '');
      expect(page.status).toBe(200);
      await bank.pay(extid);

      expect(db.payments.get(started.paymentId)?.status).toBe('REQUIRES_ACTION');
      expect(settlement.announceHeld).toHaveBeenCalledTimes(1);
      expect((await service.getPayment('user-1', started.paymentId)).status).toBe('PAID');
      expect((await service.startPayment('user-1', 'order-1')).paymentId).toBe(started.paymentId);

      // The kitchen accepts: settled from what was paid, nothing asked of the bank.
      const callsBefore = bank.calls.length;
      await cards.captureHoldForOrder('order-1');

      expect(db.payments.get(started.paymentId)?.status).toBe('SUCCEEDED');
      expect(settlement.settlePaidOrder).toHaveBeenCalledTimes(1);
      expect(settlement.settlePaidOrder.mock.calls[0]?.[1]).toMatchObject({ announced: true });
      expect(bank.calls.slice(callsBefore).filter((c) => !c.startsWith('GetPaymentState'))).toEqual([]);
    });

    it('gives the money back with ReversePayment when the kitchen rejects the order', async () => {
      db.addOrder('order-2', 2000);
      const started = await service.startPayment('user-1', 'order-2');
      const extid = db.payments.get(started.paymentId)?.invoiceId as string;
      const paid = await bank.pay(extid);
      const order = db.orders.get('order-2');
      if (order) order.status = 'CANCELLED';

      const released = await holds.releaseForOrder('order-2', 'order-cancelled-by-store');

      expect(released?.status).toBe('REFUNDED');
      expect(releaseOutcome(released, true)).toBe('REFUNDED');
      expect(bank.calls).toContain(`ReversePayment ${TERMINAL} ${paid.qrPaymentId} ${paid.rrn}`);
      expect(paid.state).toBe(SANDBOX_QR_STATE.REVERSED);
      expect((await service.getPayment('user-1', started.paymentId)).status).toBe('REFUNDED');
      expect(db.events).toContainEqual(
        expect.objectContaining({ type: 'REFUND_ISSUED', payload: expect.objectContaining({ kind: 'reversal' }) }),
      );
    });

    it('finds a payment whose callback was lost — by the status poll, and by the cron', async () => {
      db.addOrder('order-3', 1800);
      db.addOrder('order-4', 1900);
      const polled = await service.startPayment('user-1', 'order-3');
      const cronned = await service.startPayment('user-1', 'order-4');
      await bank.pay(db.payments.get(polled.paymentId)?.invoiceId as string, { silent: true });
      await bank.pay(db.payments.get(cronned.paymentId)?.invoiceId as string, { silent: true });
      expect(db.payments.get(polled.paymentId)?.status).toBe('PENDING');

      expect((await service.getPayment('user-1', polled.paymentId)).status).toBe('PAID');
      const { checked, settled } = await service.reconcilePendingPayments(0);

      expect(checked).toBe(1);
      expect(settled).toBe(1);
      expect(db.payments.get(cronned.paymentId)?.status).toBe('REQUIRES_ACTION');
      expect(settlement.announceHeld).toHaveBeenCalledTimes(2);
    });

    it('closes an invoice past its lifetime, and issues a new one on the next start', async () => {
      db.addOrder('order-5', 1500);
      const started = await service.startPayment('user-1', 'order-5');
      const row = db.payments.get(started.paymentId);
      const extid = row?.invoiceId as string;
      if (row) row.rawJson = { ...(row.rawJson as object), expiresAt: new Date(Date.now() - 1_000).toISOString() };

      const expired = await service.getPayment('user-1', started.paymentId);

      expect(expired).toMatchObject({ status: 'EXPIRED', qr: null });
      expect(bank.calls).toContain(`ClosePaymentExtId ${TERMINAL} ${extid}`);
      await expect(bank.pay(extid)).rejects.toThrow();

      const next = await service.startPayment('user-1', 'order-5');
      expect(next.paymentId).not.toBe(started.paymentId);
      expect(next.status).toBe('PENDING');
    });

    it('lets the cron close a lapsed invoice nobody asks about, after the grace', async () => {
      db.addOrder('order-6', 1200);
      const started = await service.startPayment('user-1', 'order-6');
      const row = db.payments.get(started.paymentId);
      if (row) {
        row.createdAt = new Date(Date.now() - 20 * 60_000);
        row.rawJson = { ...(row.rawJson as object), expiresAt: new Date(Date.now() - 3 * 60_000).toISOString() };
      }

      await service.reconcilePendingPayments();

      expect(db.payments.get(started.paymentId)?.status).toBe('FAILED');
      expect((await service.getPayment('user-1', started.paymentId)).status).toBe('EXPIRED');
    });

    it('closes the invoice when the customer leaves the QR screen', async () => {
      db.addOrder('order-7', 1100);
      const started = await service.startPayment('user-1', 'order-7');
      const extid = db.payments.get(started.paymentId)?.invoiceId as string;

      const cancelled = await service.cancelPayment('user-1', started.paymentId);

      expect(cancelled.status).toBe('EXPIRED');
      expect([...bank.payments.values()].find((p) => p.externalId === extid)?.state).toBe(SANDBOX_QR_STATE.CLOSED);
      expect(db.orders.get('order-7')?.status).toBe('CREATED');
    });

    it('gives back money that arrives for an order cancelled meanwhile', async () => {
      db.addOrder('order-8', 2500);
      const started = await service.startPayment('user-1', 'order-8');
      const order = db.orders.get('order-8');
      if (order) order.status = 'CANCELLED';

      await bank.pay(db.payments.get(started.paymentId)?.invoiceId as string);

      expect(db.payments.get(started.paymentId)?.status).toBe('REFUNDED');
      expect(db.orders.get('order-8')?.cancelMoney).toBe('REFUNDED');
      expect(settlement.announceHeld).not.toHaveBeenCalled();
    });

    it('gives back a sum other than the invoice and leaves the order unpaid', async () => {
      db.addOrder('order-9', 4000);
      const started = await service.startPayment('user-1', 'order-9');

      await bank.pay(db.payments.get(started.paymentId)?.invoiceId as string, { amountKopecks: 400 });

      expect(db.payments.get(started.paymentId)?.status).toBe('REFUNDED');
      expect(db.orders.get('order-9')?.status).toBe('CREATED');
      expect(settlement.announceHeld).not.toHaveBeenCalled();
    });

    it('accepts a bank that reports amounts in rubles, and records the reading', async () => {
      bank.amountUnit = 'rubles';
      db.addOrder('order-10', 1250);
      const started = await service.startPayment('user-1', 'order-10');

      await bank.pay(db.payments.get(started.paymentId)?.invoiceId as string);

      const row = db.payments.get(started.paymentId);
      expect(row?.status).toBe('REQUIRES_ACTION');
      expect(row?.rawJson).toMatchObject({
        paidAmount: '12.50',
        amountReadings: { amount: 'rubles', transactionamount: 'rubles' },
      });
    });

    it('settles the order once when the callback, the poll and the cron land together', async () => {
      db.addOrder('order-11', 900);
      const started = await service.startPayment('user-1', 'order-11');
      const extid = db.payments.get(started.paymentId)?.invoiceId as string;
      await bank.pay(extid, { silent: true });
      const snapshot = db.payments.get(started.paymentId);
      if (!snapshot) throw new Error('no payment');

      await Promise.all([
        service.reconcile(snapshot, 0),
        service.getPayment('user-1', started.paymentId),
        service.reconcilePendingPayments(0),
      ]);

      expect(db.payments.get(started.paymentId)?.status).toBe('REQUIRES_ACTION');
      expect(settlement.announceHeld).toHaveBeenCalledTimes(1);
    });

    it('answers FAILED when the bank refuses to issue the invoice', async () => {
      db.addOrder('order-12', QR_REFUSE_AMOUNT);

      const started = await service.startPayment('user-1', 'order-12');

      expect(started).toMatchObject({ status: 'FAILED', qr: null });
    });

    it('refunds a settled QR payment in full only', async () => {
      db.addOrder('order-13', 3000);
      const started = await service.startPayment('user-1', 'order-13');
      await bank.pay(db.payments.get(started.paymentId)?.invoiceId as string);
      await cards.captureHoldForOrder('order-13');
      const payment = db.payments.get(started.paymentId);
      if (!payment) throw new Error('no payment');

      const partial = await cards.refund(payment, 1000, { actorId: 'admin-1' }).catch((err: HttpException) => err);
      expect((partial as HttpException).getResponse()).toMatchObject({ code: 'QR_PARTIAL_REFUND_UNSUPPORTED' });

      await cards.refund(payment, 3000, { actorId: 'admin-1' });
      expect(db.payments.get(started.paymentId)).toMatchObject({ status: 'REFUNDED', refundedCents: 3000 });
    });

    it('retries a reversal the bank refused, from the cron', async () => {
      db.addOrder('order-14', 1700);
      const started = await service.startPayment('user-1', 'order-14');
      const paid = await bank.pay(db.payments.get(started.paymentId)?.invoiceId as string);
      const order = db.orders.get('order-14');
      if (order) order.status = 'CANCELLED';
      bank.refuseReverse = true;

      await expect(holds.releaseForOrder('order-14', 'order-cancelled-by-customer')).resolves.toBeNull();
      expect(db.payments.get(started.paymentId)?.rawJson).toMatchObject({ releaseAttempts: 1 });

      bank.refuseReverse = false;
      const row = db.payments.get(started.paymentId);
      if (row) row.updatedAt = new Date(Date.now() - 10 * 60_000);
      const orderRow = db.orders.get('order-14');
      if (orderRow) orderRow.cancelMoney = 'PENDING';

      const retried = await holds.retryPendingReleases();

      expect(retried).toEqual({ checked: 1, released: 1 });
      expect(db.payments.get(started.paymentId)?.status).toBe('REFUNDED');
      expect(db.orders.get('order-14')?.cancelMoney).toBe('REFUNDED');
      expect(paid.state).toBe(SANDBOX_QR_STATE.REVERSED);
    });
  });
});
