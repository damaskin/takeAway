import { BadRequestException, type HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { Payment } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import type { PaymentHoldsService } from '../agroprombank/payment-holds.service';
import type { OrderSettlementService } from '../order-settlement.service';
import { type AgroprombankQrClient, AgroprombankQrError, AgroprombankQrTransportError } from './agroprombank-qr.client';
import type { AgroprombankQrConfig } from './agroprombank-qr.config';
import { AgroprombankQrService } from './agroprombank-qr.service';
import type { QrPaymentRecord } from './protocol';
import { type MemoryOrder, createMemoryDb } from './testing/memory-db';

const TERMINAL = 'QRT169007299815722';

function paidRecord(extid: string, amount = '3300', overrides: Partial<QrPaymentRecord> = {}): QrPaymentRecord {
  return {
    qrPaymentId: '5229848',
    terminalId: TERMINAL,
    externalId: extid,
    state: 2,
    stateDescription: 'Оплачен',
    amount,
    transactionAmount: amount,
    currencyCode: '000',
    transactionCurrency: '000',
    rrn: '000602981706',
    paymentDate: '10.11.2026 12:00:00',
    createDate: '10.11.2026 11:59:00',
    ...overrides,
  };
}

function waitingRecord(extid: string): QrPaymentRecord {
  return paidRecord(extid, '3300', { state: 1, stateDescription: 'Ожидает', rrn: null, transactionAmount: null });
}

/**
 * The QR service against a scripted bank: what it asks, what it does with
 * each answer, and that money is settled once and given back when it cannot
 * be used.
 */
describe('AgroprombankQrService', () => {
  let db: ReturnType<typeof createMemoryDb>;
  let client: {
    createPaymentId: jest.Mock;
    closePaymentExtId: jest.Mock;
    getPaymentStateExtId: jest.Mock;
    reverseInvoice: jest.Mock;
  };
  let holds: { release: jest.Mock };
  let settlement: { announceHeld: jest.Mock; settlePaidOrder: jest.Mock };
  let config: Record<string, unknown>;
  let service: AgroprombankQrService;

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    db = createMemoryDb();
    client = {
      createPaymentId: jest.fn().mockResolvedValue('5229848'),
      closePaymentExtId: jest.fn().mockResolvedValue(undefined),
      getPaymentStateExtId: jest.fn().mockResolvedValue(null),
      reverseInvoice: jest.fn().mockResolvedValue(null),
    };
    holds = {
      release: jest.fn(async (payment: Payment) => {
        const released = { ...payment, status: 'REFUNDED' as const, refundedCents: payment.amountCents };
        db.payments.set(payment.id, released);
        return released;
      }),
    };
    settlement = {
      announceHeld: jest.fn().mockResolvedValue(undefined),
      settlePaidOrder: jest.fn().mockResolvedValue(null),
    };
    config = {
      enabled: true,
      isConfigured: true,
      canCallBank: true,
      terminalId: TERMINAL,
      codeFormat: '{terminal}:{rub}:{extid}',
      appLink: 'https://bank.example/pay?qr={code}',
      lifetimeMinutes: 10,
      timeoutMs: 15_000,
      invoicePrefix: '1',
      missingSettings: () => [],
    };
    service = build();
  });

  function build(): AgroprombankQrService {
    return new AgroprombankQrService(
      db.prisma as unknown as PrismaService,
      config as unknown as AgroprombankQrConfig,
      client as unknown as AgroprombankQrClient,
      settlement as unknown as OrderSettlementService,
      holds as unknown as PaymentHoldsService,
    );
  }

  async function startPaid(orderId: string, total = 3300): Promise<Payment> {
    db.addOrder(orderId, total);
    const started = await service.startPayment('user-1', orderId);
    return db.payments.get(started.paymentId) as Payment;
  }

  const errorCode = (err: unknown): unknown => (err as HttpException).getResponse();

  describe('start', () => {
    it('issues an invoice in kopecks under a fresh extid and shows its code and app link', async () => {
      db.addOrder('order-1', 1250);

      const started = await service.startPayment('user-1', 'order-1');
      const row = db.payments.get(started.paymentId) as Payment;

      expect(row.invoiceId).toMatch(/^1\d+$/);
      expect(client.createPaymentId).toHaveBeenCalledWith(row.invoiceId, 1250);
      expect(row).toMatchObject({ provider: 'AGROPROMBANK_QR', status: 'PENDING', providerRef: '5229848' });
      expect(started.qr).toEqual({
        code: `${TERMINAL}:12.50:${row.invoiceId}`,
        appLink: `https://bank.example/pay?qr=${encodeURIComponent(`${TERMINAL}:12.50:${row.invoiceId}`)}`,
        expiresAt: expect.any(String),
      });
    });

    it('answers the invoice still on offer again, after asking the bank, and issues nothing new', async () => {
      db.addOrder('order-1', 3300);
      const first = await service.startPayment('user-1', 'order-1');
      client.getPaymentStateExtId.mockResolvedValue(waitingRecord('x'));

      const second = await service.startPayment('user-1', 'order-1');

      expect(second).toEqual(first);
      expect(client.createPaymentId).toHaveBeenCalledTimes(1);
      expect(client.getPaymentStateExtId).toHaveBeenCalledTimes(1);
    });

    it('answers a payment the customer made meanwhile instead of a new invoice', async () => {
      db.addOrder('order-1', 3300);
      const first = await service.startPayment('user-1', 'order-1');
      const extid = db.payments.get(first.paymentId)?.invoiceId as string;
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(extid));

      const second = await service.startPayment('user-1', 'order-1');

      expect(second).toMatchObject({ paymentId: first.paymentId, status: 'PAID', qr: null });
      expect(settlement.announceHeld).toHaveBeenCalledTimes(1);
      expect(client.createPaymentId).toHaveBeenCalledTimes(1);
    });

    it('closes an invoice for an old total and issues one for the new', async () => {
      const order = db.addOrder('order-1', 3300);
      const first = await service.startPayment('user-1', 'order-1');
      order.totalCents = 3000;

      const second = await service.startPayment('user-1', 'order-1');

      expect(second.paymentId).not.toBe(first.paymentId);
      expect(second.amountCents).toBe(3000);
      expect(client.closePaymentExtId).toHaveBeenCalledWith(db.payments.get(first.paymentId)?.invoiceId);
      expect(db.payments.get(first.paymentId)?.status).toBe('FAILED');
    });

    it.each([
      ['switched off', 'QR_PAYMENT_DISABLED', () => Object.assign(config, { enabled: false, isConfigured: false })],
      ['in another currency', 'QR_CURRENCY_UNSUPPORTED', (order: MemoryOrder) => (order.currency = 'USD')],
      ['cancelled', 'ORDER_NOT_PAYABLE', (order: MemoryOrder) => (order.status = 'CANCELLED')],
      ['with nothing to pay', 'ORDER_NOT_PAYABLE', (order: MemoryOrder) => (order.totalCents = 0)],
    ])('refuses an order %s with %s (409)', async (_label, code, arrange) => {
      arrange(db.addOrder('order-1', 3300));

      const err = await service.startPayment('user-1', 'order-1').catch((e: unknown) => e);

      expect((err as HttpException).getStatus()).toBe(409);
      expect(errorCode(err)).toMatchObject({ statusCode: 409, code });
      expect(client.createPaymentId).not.toHaveBeenCalled();
    });

    it("does not show one customer another's order", async () => {
      db.addOrder('order-1', 3300, { userId: 'someone-else' });
      await expect(service.startPayment('user-1', 'order-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('leaves an invoice the bank did not confirm pending, and answers QR_BANK_UNAVAILABLE', async () => {
      db.addOrder('order-1', 3300);
      client.createPaymentId.mockRejectedValue(new AgroprombankQrTransportError('CreatePaymentID', 'timed out'));

      const err = await service.startPayment('user-1', 'order-1').catch((e: unknown) => e);

      expect((err as HttpException).getStatus()).toBe(503);
      expect(errorCode(err)).toMatchObject({ code: 'QR_BANK_UNAVAILABLE' });
      const [row] = [...db.payments.values()];
      expect(row).toMatchObject({ status: 'PENDING', providerRef: null });

      // Next start: the bank had made the invoice after all — the same one is answered.
      client.getPaymentStateExtId.mockResolvedValue(waitingRecord(row?.invoiceId ?? ''));
      const retry = await service.startPayment('user-1', 'order-1');
      expect(retry.paymentId).toBe(row?.id);
      expect(db.payments.get(row?.id ?? '')?.providerRef).toBe('5229848');
      expect(client.createPaymentId).toHaveBeenCalledTimes(1);
    });

    it('closes an invoice the bank never made once its call is long over, then issues another', async () => {
      db.addOrder('order-1', 3300);
      client.createPaymentId.mockRejectedValueOnce(new AgroprombankQrTransportError('CreatePaymentID', 'reset'));
      await service.startPayment('user-1', 'order-1').catch(() => undefined);
      const [lost] = [...db.payments.values()];
      if (lost) lost.createdAt = new Date(Date.now() - 60_000);

      const retry = await service.startPayment('user-1', 'order-1');

      expect(client.closePaymentExtId).toHaveBeenCalledWith(lost?.invoiceId);
      expect(db.payments.get(lost?.id ?? '')?.rawJson).toMatchObject({ closed: true, closeReason: 'not-issued' });
      expect(retry.paymentId).not.toBe(lost?.id);
    });

    it('will not issue a second invoice while it cannot tell whether the first was paid', async () => {
      db.addOrder('order-1', 3300);
      await service.startPayment('user-1', 'order-1');
      client.getPaymentStateExtId.mockRejectedValue(new AgroprombankQrTransportError('GetPaymentStateExtId', 'down'));

      const err = await service.startPayment('user-1', 'order-1').catch((e: unknown) => e);

      expect(errorCode(err)).toMatchObject({ code: 'QR_BANK_UNAVAILABLE' });
      expect(client.createPaymentId).toHaveBeenCalledTimes(1);
    });

    it('answers FAILED when the bank refuses the invoice', async () => {
      db.addOrder('order-1', 3300);
      client.createPaymentId.mockRejectedValue(new AgroprombankQrError('CreatePaymentID', 'Терминал заблокирован'));

      const started = await service.startPayment('user-1', 'order-1');

      expect(started).toMatchObject({ status: 'FAILED', qr: null });
      expect(db.events).toContainEqual(expect.objectContaining({ type: 'PAYMENT_FAILED' }));
    });
  });

  describe('paid', () => {
    it('settles the order once when the callback, the poll and the cron land together', async () => {
      const payment = await startPaid('order-1');
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));

      await Promise.all([
        service.reconcile(payment, 0),
        service.reconcile(payment, 0),
        service.handleCallback({
          payments: `<Payments><Payment><externalid>${payment.invoiceId}</externalid></Payment></Payments>`,
          trx: null,
        }),
      ]);

      expect(db.payments.get(payment.id)).toMatchObject({ status: 'REQUIRES_ACTION', providerRef: '5229848' });
      expect(db.payments.get(payment.id)?.rawJson).toMatchObject({ qrPaymentId: '5229848', rrn: '000602981706' });
      expect(settlement.announceHeld).toHaveBeenCalledTimes(1);
      expect(holds.release).not.toHaveBeenCalled();
    });

    it('records which unit the bank wrote the sum in', async () => {
      const payment = await startPaid('order-1', 1250);
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string, '12.50'));

      await service.reconcile(payment, 0);

      expect(db.payments.get(payment.id)?.rawJson).toMatchObject({
        amountReadings: { amount: 'rubles', transactionamount: 'rubles' },
      });
      expect(settlement.announceHeld).toHaveBeenCalled();
    });

    it('gives back a wrong sum at once and leaves the order unpaid', async () => {
      const payment = await startPaid('order-1', 1250);
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string, '125'));

      await service.reconcile(payment, 0);

      expect(holds.release).toHaveBeenCalledWith(
        expect.objectContaining({ id: payment.id, rawJson: expect.objectContaining({ releaseRequired: true }) }),
        'unusable-payment',
      );
      expect(settlement.announceHeld).not.toHaveBeenCalled();
      expect(db.orders.get('order-1')?.status).toBe('CREATED');
    });

    it('gives back money for an order that expired meanwhile, and says so on the order', async () => {
      const payment = await startPaid('order-1');
      const order = db.orders.get('order-1');
      if (order) order.status = 'EXPIRED';
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));

      await service.reconcile(payment, 0);

      expect(holds.release).toHaveBeenCalled();
      expect(db.orders.get('order-1')?.cancelMoney).toBe('REFUNDED');
    });

    it('marks the money as on its way when the reversal has to wait for the cron', async () => {
      holds.release.mockResolvedValue(null);
      const payment = await startPaid('order-1');
      const order = db.orders.get('order-1');
      if (order) order.status = 'CANCELLED';
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));

      await service.reconcile(payment, 0);

      expect(db.orders.get('order-1')?.cancelMoney).toBe('PENDING');
    });

    it('gives back a second payment for an order already paid by another', async () => {
      const first = await startPaid('order-1');
      const second = await db.prisma.payment.create({
        data: {
          orderId: 'order-1',
          provider: 'AGROPROMBANK_QR',
          status: 'PENDING',
          invoiceId: '1999999',
          amountCents: 3300,
          currency: 'RUP',
        },
      });
      client.getPaymentStateExtId.mockResolvedValueOnce(paidRecord(first.invoiceId as string));
      await service.reconcile(first, 0);
      client.getPaymentStateExtId.mockResolvedValueOnce(paidRecord('1999999'));

      await service.reconcile(second, 0);

      expect(holds.release).toHaveBeenCalledTimes(1);
      expect(holds.release.mock.calls[0]?.[0]).toMatchObject({ id: second.id });
    });

    it('uses money paid on an invoice we had already closed, while the order still waits for it', async () => {
      const payment = await startPaid('order-1');
      await service.cancelPayment('user-1', payment.id);
      expect(db.payments.get(payment.id)?.status).toBe('FAILED');
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));

      await service.handleCallback({
        payments: `<Payment><externalid>${payment.invoiceId}</externalid></Payment>`,
        trx: null,
      });

      expect(db.payments.get(payment.id)?.status).toBe('REQUIRES_ACTION');
      expect(settlement.announceHeld).toHaveBeenCalledTimes(1);
    });
  });

  describe('status and cancel', () => {
    it('asks the bank at most once every three seconds per payment', async () => {
      const payment = await startPaid('order-1');
      const now = jest.spyOn(Date, 'now');
      const t0 = Date.now();
      try {
        now.mockReturnValue(t0);
        await service.getPayment('user-1', payment.id);
        now.mockReturnValue(t0 + 2_000);
        await service.getPayment('user-1', payment.id);
        expect(client.getPaymentStateExtId).toHaveBeenCalledTimes(1);
        now.mockReturnValue(t0 + 3_100);
        await service.getPayment('user-1', payment.id);
        expect(client.getPaymentStateExtId).toHaveBeenCalledTimes(2);
      } finally {
        now.mockRestore();
      }
    });

    it('answers from the database when the bank does not', async () => {
      const payment = await startPaid('order-1');
      client.getPaymentStateExtId.mockRejectedValue(new AgroprombankQrTransportError('GetPaymentStateExtId', 'down'));

      await expect(service.getPayment('user-1', payment.id)).resolves.toMatchObject({ status: 'PENDING' });
    });

    it("hides another customer's payment", async () => {
      const payment = await startPaid('order-1');
      await expect(service.getPayment('user-2', payment.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('closes the invoice and checks it once more: unpaid reads EXPIRED', async () => {
      const payment = await startPaid('order-1');

      const cancelled = await service.cancelPayment('user-1', payment.id);

      expect(client.closePaymentExtId).toHaveBeenCalledWith(payment.invoiceId);
      expect(client.getPaymentStateExtId).toHaveBeenCalledWith(payment.invoiceId);
      expect(cancelled).toMatchObject({ status: 'EXPIRED', qr: null });
      expect(db.payments.get(payment.id)?.rawJson).toMatchObject({
        closed: true,
        closeReason: 'cancelled-by-customer',
      });
    });

    it('finds the payment that landed in the same second as the cancel', async () => {
      const payment = await startPaid('order-1');
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));

      await expect(service.cancelPayment('user-1', payment.id)).resolves.toMatchObject({ status: 'PAID' });
      expect(settlement.announceHeld).toHaveBeenCalledTimes(1);
    });

    it('keeps the invoice pending when the bank could not be told to close it', async () => {
      const payment = await startPaid('order-1');
      client.closePaymentExtId.mockRejectedValue(new AgroprombankQrTransportError('ClosePaymentExtId', 'down'));

      const err = await service.cancelPayment('user-1', payment.id).catch((e: unknown) => e);

      expect(errorCode(err)).toMatchObject({ code: 'QR_BANK_UNAVAILABLE' });
      expect(db.payments.get(payment.id)?.status).toBe('PENDING');
    });
  });

  describe('callback', () => {
    it('ignores what it cannot use without asking the bank', async () => {
      const payment = await startPaid('order-1');

      await service.handleCallback({ payments: '<Payments><Payment>', trx: null });
      await service.handleCallback({ payments: null, trx: null });
      await service.handleCallback({ payments: '<Payment><externalid>404</externalid></Payment>', trx: null });
      await service.handleCallback({
        payments: `<Payment><qrterminalid>QRT000000000000001</qrterminalid><externalid>${payment.invoiceId}</externalid></Payment>`,
        trx: null,
      });

      expect(client.getPaymentStateExtId).not.toHaveBeenCalled();
    });

    it('believes the bank, not the callback', async () => {
      const payment = await startPaid('order-1');
      client.getPaymentStateExtId.mockResolvedValue(waitingRecord(payment.invoiceId as string));

      await service.handleCallback({
        payments: `<Payment><externalid>${payment.invoiceId}</externalid><state>2</state></Payment>`,
        trx: null,
      });

      expect(db.payments.get(payment.id)?.status).toBe('PENDING');
    });
  });

  describe('cron', () => {
    it('closes the invoice of an order that can no longer be paid, and leaves a young one alone', async () => {
      const closed = await startPaid('order-1');
      const young = await startPaid('order-2');
      const order = db.orders.get('order-1');
      if (order) order.status = 'CANCELLED';
      client.getPaymentStateExtId.mockResolvedValue(null);

      const result = await service.reconcilePendingPayments(0);

      expect(result).toEqual({ checked: 2, settled: 0 });
      expect(client.closePaymentExtId).toHaveBeenCalledTimes(1);
      expect(client.closePaymentExtId).toHaveBeenCalledWith(closed.invoiceId);
      expect(db.payments.get(closed.id)?.status).toBe('FAILED');
      expect(db.payments.get(young.id)?.status).toBe('PENDING');
    });

    it('does nothing when the QR service cannot be called', async () => {
      await startPaid('order-1');
      config['canCallBank'] = false;

      await expect(service.reconcilePendingPayments(0)).resolves.toEqual({ checked: 0, settled: 0 });
      expect(client.getPaymentStateExtId).not.toHaveBeenCalled();
    });
  });

  describe('accept and back office', () => {
    it('settles on accept with no bank call, and tells settlement the staff already know', async () => {
      const payment = await startPaid('order-1');
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));
      await service.reconcile(payment, 0);
      client.getPaymentStateExtId.mockClear();

      await service.settleOnAccept(payment.id);

      expect(db.payments.get(payment.id)?.status).toBe('SUCCEEDED');
      expect(settlement.settlePaidOrder).toHaveBeenCalledWith('order-1', {
        event: {
          type: 'PAYMENT_SUCCEEDED',
          payload: expect.objectContaining({ provider: 'AGROPROMBANK_QR', qrPaymentId: '5229848' }),
        },
        announced: true,
      });
      expect(client.getPaymentStateExtId).not.toHaveBeenCalled();
      expect(client.reverseInvoice).not.toHaveBeenCalled();
    });

    it('refuses to settle a payment that is not waiting for the kitchen', async () => {
      const payment = await startPaid('order-1');
      await expect(service.settleOnAccept(payment.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('settles by hand only for the amount paid', async () => {
      const payment = await startPaid('order-1');
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));
      await service.reconcile(payment, 0);

      const err = await service.complete(payment.id, 3000).catch((e: unknown) => e);
      expect(errorCode(err)).toMatchObject({ code: 'QR_PARTIAL_CAPTURE_UNSUPPORTED' });

      await expect(service.complete(payment.id, 3300)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    });

    it('reverses a payment from the admin with the recorded ids, and audits it', async () => {
      const payment = await startPaid('order-1');
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));
      await service.reconcile(payment, 0);

      const reversed = await service.reverse(payment.id, { actorId: 'admin-1', reason: 'admin' });

      expect(client.reverseInvoice).toHaveBeenCalledWith(payment.invoiceId, {
        qrPaymentId: '5229848',
        rrn: '000602981706',
      });
      expect(reversed).toMatchObject({ status: 'REFUNDED', refundedCents: 3300, rrn: '000602981706' });
      expect(db.events).toContainEqual(
        expect.objectContaining({ type: 'REFUND_ISSUED', payload: expect.objectContaining({ kind: 'reversal' }) }),
      );
    });

    it('turns a refused reversal into a 400 with the bank reason', async () => {
      const payment = await startPaid('order-1');
      client.getPaymentStateExtId.mockResolvedValue(paidRecord(payment.invoiceId as string));
      await service.reconcile(payment, 0);
      client.reverseInvoice.mockRejectedValue(new AgroprombankQrError('ReversePayment', 'Отмена невозможна'));

      await expect(service.reverse(payment.id)).rejects.toThrow('Отмена невозможна');
      expect(db.payments.get(payment.id)?.status).toBe('REQUIRES_ACTION');
    });
  });
});
