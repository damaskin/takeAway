import { generateKeyPairSync } from 'node:crypto';
import { type Server, createServer } from 'node:http';

import type { Payment } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import type { AgroprombankClient } from '../agroprombank/agroprombank.client';
import type { AgroprombankConfig } from '../agroprombank/agroprombank.config';
import { PaymentHoldsService } from '../agroprombank/payment-holds.service';
import type { OrderSettlementService } from '../order-settlement.service';
import { AgroprombankWebClient, AgroprombankWebError, AgroprombankWebTransportError } from './agroprombank-web.client';
import type { AgroprombankWebConfig } from './agroprombank-web.config';
import { AgroprombankWebService } from './agroprombank-web.service';
import { WEB_STATE } from './constants';
import { normalizeParams } from './protocol';
import {
  WEB_DECLINE_AMOUNT,
  WEB_PAYMENT_PATH,
  WEB_SERVICE_PATH,
  type SandboxWebBank,
  createSandboxWebBank,
} from './testing/sandbox-web-bank';

/**
 * Web-платёж end to end against the sandbox bank, over real HTTP: the signed
 * payment page, the ResultURL notification, the redirect back, and the admin
 * web service with its base64-wrapped, RSA-signed answers.
 *
 * The first half drives the client alone, like the bound-card e2e spec. The
 * second runs the whole service — checkout, the notification, the kitchen's
 * capture, a cancel, a lost notification — over an in-memory stand-in for the
 * two tables it touches, so what is asserted is the money moving at the bank.
 */
describe('Agroprombank Web-платёж end-to-end (sandbox bank)', () => {
  const bankKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const MERCHANT = { login: '000123', pass: 'sandbox-pass' };

  /** Our ResultURL: hands every notification to whatever the test plugs in. */
  let onNotification: (params: Record<string, string>) => Promise<boolean> = async () => true;
  const notifications: Array<Record<string, string>> = [];
  let receiver: Server;
  let bank: SandboxWebBank;
  let config: AgroprombankWebConfig;
  let client: AgroprombankWebClient;
  let baseUrl: string;

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        const params = normalizeParams(Object.fromEntries(new URLSearchParams(body)));
        notifications.push(params);
        void onNotification(params).then((ok) => res.writeHead(ok ? 200 : 400).end(ok ? 'OK' : 'rejected'));
      });
    });
    const receiverPort = await new Promise<number>((resolve) =>
      receiver.listen(0, () => resolve((receiver.address() as { port: number }).port)),
    );

    bank = createSandboxWebBank({
      merchantLogin: MERCHANT.login,
      merchantPass: MERCHANT.pass,
      bankPrivateKeyPem: bankKeys.privateKey,
      resultUrl: `http://127.0.0.1:${receiverPort}/result`,
      successUrl: 'https://api.example/api/payments/agroprombank-web/success',
      failUrl: 'https://api.example/api/payments/agroprombank-web/fail',
    });
    const port = await bank.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    config = {
      enabled: true,
      merchantLogin: MERCHANT.login,
      merchantId: MERCHANT.login,
      merchantPass: MERCHANT.pass,
      paymentUrl: `${baseUrl}${WEB_PAYMENT_PATH}`,
      serviceUrl: `${baseUrl}${WEB_SERVICE_PATH}`,
      namespace: 'http://services.agroprombank.com',
      isTest: true,
      lifetimeMinutes: 15,
      holdUntilAccepted: true,
      bankCertificatePem: bankKeys.publicKey,
      verifyResponses: true,
      timeoutMs: 10_000,
      invoicePrefix: '9',
      isConfigured: true,
      cardPaymentFlow: 'web',
      missingSettings: () => [],
      returnBase: (target: string) =>
        ({ web: 'https://takeaway.md', tma: 'https://t.me/takaway_tgbot/app', mobile: 'takeaway://pay' })[target] ??
        null,
    } as unknown as AgroprombankWebConfig;
    client = new AgroprombankWebClient(config);
  });

  afterAll(async () => {
    await bank.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  });

  beforeEach(() => {
    notifications.length = 0;
    onNotification = async () => true;
    bank.refuseCancel = false;
  });

  let nextNivid = 1_100_000;
  async function openInvoice(sum = 3300, preauth = true): Promise<string> {
    const nivid = String((nextNivid += 1));
    const page = client.paymentPage({
      nivid,
      sum,
      currencyCode: '000',
      description: `takeAway order ${nivid}`,
      preauth,
    });
    // A GET of the link, as the TMA and the mobile app open it.
    const response = await fetch(page.url);
    expect(response.status).toBe(200);
    return nivid;
  }

  describe('client', () => {
    it('opens a signed payment page, by GET or by form POST', async () => {
      const page = client.paymentPage({
        nivid: '7000001',
        sum: 1524,
        currencyCode: '000',
        description: 'takeAway order 1',
        preauth: true,
      });

      const posted = await fetch(page.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(page.fields).toString(),
      });
      expect(posted.status).toBe(200);
      expect(await posted.text()).toContain('Оплатить');
      expect(bank.invoices.get('7000001')).toMatchObject({ sum: 1524, preauth: true, state: WEB_STATE.NOT_PAID });
    });

    it('is turned away when the page request was tampered with', async () => {
      const page = client.paymentPage({
        nivid: '7000002',
        sum: 1524,
        currencyCode: '000',
        description: 'x',
        preauth: false,
      });
      const url = new URL(page.url);
      url.searchParams.set('RequestSum', '1');
      expect((await fetch(url)).status).toBe(400);
    });

    it('verifies the notification and reads the hold back from GetState', async () => {
      const nivid = await openInvoice(3300, true);

      const back = await bank.pay(nivid);

      expect(new URL(back).searchParams.get('invoiceid')).toBe(nivid);
      expect(notifications).toHaveLength(1);
      expect(client.verifyNotification(notifications[0] ?? {})).toBe(true);
      expect(client.verifyNotification({ ...notifications[0], paymentsum: '1' })).toBe(false);

      const state = await client.getState(nivid);
      expect(state).toMatchObject({ state: WEB_STATE.PAID, sum: 3300, usePreauth: true, lastDigits: '0578' });
    });

    it('completes a hold, then refunds part of it', async () => {
      const nivid = await openInvoice(3300, true);
      await bank.pay(nivid);

      await client.complete(nivid, 3300);
      await client.refund(nivid, 1000);

      expect(bank.invoices.get(nivid)).toMatchObject({ completed: true, refunded: 1000 });
      await expect(client.refund(nivid, 5000)).rejects.toBeInstanceOf(AgroprombankWebError);
    });

    it('refuses to capture more than 110% of the hold', async () => {
      const nivid = await openInvoice(1000, true);
      await bank.pay(nivid);
      await expect(client.complete(nivid, 1101)).rejects.toMatchObject({ code: 0 });
    });

    it('cancels a hold, and reports a cancel the bank refuses as a business error', async () => {
      const released = await openInvoice(2000, true);
      await bank.pay(released);
      await client.cancel(released);
      expect((await client.getState(released)).state).toBe(WEB_STATE.CANCELLED);

      const stuck = await openInvoice(2000, true);
      await bank.pay(stuck);
      bank.refuseCancel = true;
      await expect(client.cancel(stuck)).rejects.toBeInstanceOf(AgroprombankWebError);
    });

    it('signals a declined card with a fail notification', async () => {
      const nivid = await openInvoice(WEB_DECLINE_AMOUNT, false);
      const back = await bank.pay(nivid);

      expect(back).toContain('/fail');
      expect(notifications[0]).toMatchObject({ status: 'fail', invoiceid: nivid });
      expect(client.verifyNotification(notifications[0] ?? {})).toBe(true);
      expect((await client.getState(nivid)).state).toBe(WEB_STATE.ERROR);
    });

    it('treats an invoice the bank never saw as a business answer', async () => {
      await expect(client.getState('404404')).rejects.toBeInstanceOf(AgroprombankWebError);
    });

    it('refuses a response that is not signed by the bank', async () => {
      const stranger = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const suspicious = new AgroprombankWebClient({
        ...config,
        bankCertificatePem: stranger.publicKey,
      } as unknown as AgroprombankWebConfig);
      const nivid = await openInvoice(1500, false);

      await expect(suspicious.getState(nivid)).rejects.toBeInstanceOf(AgroprombankWebTransportError);
    });
  });

  describe('service', () => {
    let db: ReturnType<typeof memoryDb>;
    let service: AgroprombankWebService;
    let settlement: { announceHeld: jest.Mock; settlePaidOrder: jest.Mock };
    let holds: PaymentHoldsService;

    beforeEach(() => {
      db = memoryDb();
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
        config,
        client,
      );
      service = new AgroprombankWebService(
        db.prisma as unknown as PrismaService,
        config,
        client,
        settlement as unknown as OrderSettlementService,
        holds,
      );
      onNotification = (params) => service.handleNotification(params);
    });

    it('holds at checkout, captures on accept, settles the order once', async () => {
      db.orders.set('order-1', {
        id: 'order-1',
        userId: 'user-1',
        status: 'CREATED',
        totalCents: 3300,
        currency: 'RUP',
        orderCode: '4242',
      });

      const started = await service.startPayment('user-1', { orderId: 'order-1', returnTo: 'web' });
      expect(started.page?.fields['ispreauth']).toBe('1');
      expect(started.invoiceId).toMatch(/^9\d+$/);
      await fetch(started.page?.url ?? '');

      const back = await bank.pay(started.invoiceId);
      // The notification already did the work; the customer's return only reads it.
      const redirect = await service.handleReturn(
        'success',
        normalizeParams(Object.fromEntries(new URL(back).searchParams)),
      );

      expect(redirect).toBe('https://takeaway.md/orders/order-1?payment=success');
      const held = db.payments.get(started.paymentId) as Payment;
      expect(held.status).toBe('REQUIRES_ACTION');
      expect(settlement.announceHeld).toHaveBeenCalledTimes(1);
      expect(settlement.settlePaidOrder).not.toHaveBeenCalled();

      // A second start for the same order issues nothing new.
      const again = await service.startPayment('user-1', { orderId: 'order-1', returnTo: 'web' });
      expect(again.page).toBeNull();

      // The kitchen accepts.
      await service.complete(held.id, held.amountCents);
      expect(bank.calls).toContain(`ComplitionOperation ${started.invoiceId} 3300`);
      expect(db.payments.get(held.id)?.status).toBe('SUCCEEDED');
      expect(settlement.settlePaidOrder).toHaveBeenCalledTimes(1);
    });

    it('releases the hold when the order is cancelled', async () => {
      db.orders.set('order-2', {
        id: 'order-2',
        userId: 'user-1',
        status: 'CREATED',
        totalCents: 2000,
        currency: 'RUP',
        orderCode: '1',
      });
      const started = await service.startPayment('user-1', { orderId: 'order-2', returnTo: 'mobile' });
      await fetch(started.page?.url ?? '');
      await bank.pay(started.invoiceId);

      const order = db.orders.get('order-2');
      if (order) order.status = 'CANCELLED';
      const released = await holds.releaseForOrder('order-2', 'order-cancelled');

      expect(released?.status).toBe('REFUNDED');
      expect(bank.invoices.get(started.invoiceId)?.state).toBe(WEB_STATE.CANCELLED);
    });

    it('gives money back that arrives for an order which expired meanwhile', async () => {
      db.orders.set('order-3', {
        id: 'order-3',
        userId: 'user-1',
        status: 'CREATED',
        totalCents: 2500,
        currency: 'RUP',
        orderCode: '2',
      });
      const started = await service.startPayment('user-1', { orderId: 'order-3', returnTo: 'tma' });
      await fetch(started.page?.url ?? '');
      const order = db.orders.get('order-3');
      if (order) order.status = 'EXPIRED';

      const back = await bank.pay(started.invoiceId);

      expect(db.payments.get(started.paymentId)?.status).toBe('REFUNDED');
      expect(bank.invoices.get(started.invoiceId)?.state).toBe(WEB_STATE.CANCELLED);
      expect(settlement.announceHeld).not.toHaveBeenCalled();
      const redirect = await service.handleReturn(
        'success',
        normalizeParams(Object.fromEntries(new URL(back).searchParams)),
      );
      expect(redirect).toBe('https://t.me/takaway_tgbot/app?startapp=order_order-3');
    });

    it('turns away a forged notification without asking the bank', async () => {
      db.orders.set('order-7', {
        id: 'order-7',
        userId: 'user-1',
        status: 'CREATED',
        totalCents: 1200,
        currency: 'RUP',
        orderCode: '7',
      });
      const started = await service.startPayment('user-1', { orderId: 'order-7', returnTo: 'web' });
      const callsBefore = bank.calls.length;

      const accepted = await service.handleNotification({
        status: 'paid',
        invoiceid: started.invoiceId,
        paymentsum: '1200',
        paymentcurrency: '000',
        date: '04102026',
        signature: 'deadbeefdeadbeefdeadbeefdeadbeef',
      });

      expect(accepted).toBe(false);
      expect(bank.calls.length).toBe(callsBefore);
      expect(db.payments.get(started.paymentId)?.status).toBe('PENDING');
    });

    it('finds a payment whose notification was lost', async () => {
      onNotification = async () => true; // the bank calls, nobody listens
      db.orders.set('order-4', {
        id: 'order-4',
        userId: 'user-1',
        status: 'CREATED',
        totalCents: 1800,
        currency: 'RUP',
        orderCode: '3',
      });
      const started = await service.startPayment('user-1', { orderId: 'order-4', returnTo: 'web' });
      await fetch(started.page?.url ?? '');
      await bank.pay(started.invoiceId);
      expect(db.payments.get(started.paymentId)?.status).toBe('PENDING');

      const { checked, settled } = await service.reconcilePendingPayments(0);

      expect(checked).toBe(1);
      expect(settled).toBe(1);
      expect(db.payments.get(started.paymentId)?.status).toBe('REQUIRES_ACTION');
    });

    it('records a declined card and sends the customer back to retry', async () => {
      db.orders.set('order-5', {
        id: 'order-5',
        userId: 'user-1',
        status: 'CREATED',
        totalCents: WEB_DECLINE_AMOUNT,
        currency: 'RUP',
        orderCode: '5',
      });
      const started = await service.startPayment('user-1', { orderId: 'order-5', returnTo: 'mobile' });
      await fetch(started.page?.url ?? '');

      const back = await bank.pay(started.invoiceId);
      const redirect = await service.handleReturn(
        'fail',
        normalizeParams(Object.fromEntries(new URL(back).searchParams)),
      );

      expect(db.payments.get(started.paymentId)?.status).toBe('FAILED');
      expect(redirect).toBe('takeaway://pay?orderId=order-5&status=fail');
      const retry = await service.startPayment('user-1', { orderId: 'order-5', returnTo: 'mobile' });
      expect(retry.page).not.toBeNull();
      expect(retry.invoiceId).not.toBe(started.invoiceId);
    });

    it('charges outright and refunds on the same day by cancelling', async () => {
      const charging = { ...config, holdUntilAccepted: false } as unknown as AgroprombankWebConfig;
      service = new AgroprombankWebService(
        db.prisma as unknown as PrismaService,
        charging,
        client,
        settlement as unknown as OrderSettlementService,
        holds,
      );
      onNotification = (params) => service.handleNotification(params);
      db.orders.set('order-6', {
        id: 'order-6',
        userId: 'user-1',
        status: 'CREATED',
        totalCents: 4000,
        currency: 'RUP',
        orderCode: '6',
      });
      const started = await service.startPayment('user-1', { orderId: 'order-6', returnTo: 'web' });
      expect(started.page?.fields['ispreauth']).toBe('0');
      await fetch(started.page?.url ?? '');
      await bank.pay(started.invoiceId);

      expect(db.payments.get(started.paymentId)?.status).toBe('SUCCEEDED');
      expect(settlement.settlePaidOrder).toHaveBeenCalledTimes(1);

      const refunded = await service.refund(started.paymentId, 4000, { actorId: 'admin-1' });
      expect(refunded.status).toBe('REFUNDED');
      expect(bank.calls).toContain(`CancelOperation ${started.invoiceId}`);
    });
  });
});

/** One numbering across tests, like the real sequence: the sandbox bank outlives each test. */
let seq = 100_000;

type OrderRow = { id: string; userId: string; status: string; totalCents: number; currency: string; orderCode: string };

/**
 * Just enough of Prisma for the service: the payment and order rows, with
 * the `where` shapes the service actually uses. Not a general fake.
 */
function memoryDb() {
  const payments = new Map<string, Payment>();
  const orders = new Map<string, OrderRow>();
  const events: unknown[] = [];
  let ids = 0;

  const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as Record<string, unknown>;
        if ('in' in c) return (c['in'] as unknown[]).includes(value);
        if ('not' in c) return value !== c['not'];
        if ('lt' in c) return (value as Date) < (c['lt'] as Date);
        return true;
      }
      return value === cond;
    });
  const newest = (rows: Payment[]): Payment[] => [...rows].sort((a, b) => +b.createdAt - +a.createdAt);

  const prisma = {
    payment: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        newest([...payments.values()].filter((p) => matches(p as never, where)))[0] ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        newest([...payments.values()].filter((p) => matches(p as never, where))),
      findUnique: async ({ where }: { where: { id?: string; invoiceId?: string } }) =>
        [...payments.values()].find((p) => (where.id ? p.id === where.id : p.invoiceId === where.invoiceId)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = payments.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      },
      create: async ({ data }: { data: Partial<Payment> }) => {
        ids += 1;
        const row = {
          id: `pay-${ids}`,
          providerRef: null,
          tipCents: 0,
          refundedCents: 0,
          cardTokenId: null,
          createdAt: new Date(Date.now() + ids),
          updatedAt: new Date(),
          ...data,
        } as Payment;
        payments.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Payment> }) => {
        const row = { ...(payments.get(where.id) as Payment), ...data, updatedAt: new Date() };
        payments.set(row.id, row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Payment> }) => {
        let count = 0;
        for (const row of payments.values()) {
          if (!matches(row as never, where)) continue;
          payments.set(row.id, { ...row, ...data, updatedAt: new Date() });
          count += 1;
        }
        return { count };
      },
    },
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => orders.get(where.id) ?? null,
    },
    orderEvent: { create: async ({ data }: { data: unknown }) => events.push(data) },
    $queryRaw: async () => [{ value: BigInt((seq += 1)) }],
  };
  return { prisma, payments, orders, events };
}
