import { Logger } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankQrError } from '../agroprombank-qr/agroprombank-qr.client';
import type { AgroprombankQrClient } from '../agroprombank-qr/agroprombank-qr.client';
import type { AgroprombankQrConfig } from '../agroprombank-qr/agroprombank-qr.config';
import { releaseOutcome } from '../card-providers';
import { AgroprombankWebError } from '../agroprombank-web/agroprombank-web.client';
import type { AgroprombankWebClient } from '../agroprombank-web/agroprombank-web.client';
import type { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import { AgroprombankTransportError } from './agroprombank.client';
import type { AgroprombankClient } from './agroprombank.client';
import type { AgroprombankConfig } from './agroprombank.config';
import { MAX_RELEASE_ATTEMPTS, PaymentHoldsService } from './payment-holds.service';

/**
 * Releasing a hold goes to the bank that took it, and a release the bank
 * could not do at cancel time is retried rather than forgotten.
 */
describe('PaymentHoldsService', () => {
  const hold = (
    provider: 'AGROPROMBANK' | 'AGROPROMBANK_WEB' | 'AGROPROMBANK_QR',
    raw: Record<string, unknown> = {},
  ) => ({
    id: `hold-${provider}`,
    orderId: 'order-1',
    provider,
    status: 'REQUIRES_ACTION',
    invoiceId: '1100042',
    amountCents: 3300,
    rawJson: raw,
  });

  function build(flow: 'token' | 'web' | 'none' = 'web', qrCurrencies: string[] = []) {
    const prisma = {
      payment: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...hold('AGROPROMBANK_WEB'),
          ...data,
        })),
      },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const client = { invoke: jest.fn().mockResolvedValue({}) };
    const webClient = { cancel: jest.fn().mockResolvedValue({ state: 2 }) };
    const qrClient = { reverseInvoice: jest.fn().mockResolvedValue({ state: 4, stateDescription: 'Возвращён' }) };
    const service = new PaymentHoldsService(
      prisma as unknown as PrismaService,
      { isConfigured: true, enabled: true } as unknown as AgroprombankConfig,
      client as unknown as AgroprombankClient,
      { isConfigured: true, cardPaymentFlow: flow } as unknown as AgroprombankWebConfig,
      webClient as unknown as AgroprombankWebClient,
      { canCallBank: true, currencies: qrCurrencies } as unknown as AgroprombankQrConfig,
      qrClient as unknown as AgroprombankQrClient,
    );
    return { service, prisma, client, webClient, qrClient };
  }

  it('releases a Web-платёж hold with CancelOperation', async () => {
    const { service, prisma, client, webClient } = build();
    prisma.payment.findFirst.mockResolvedValue(hold('AGROPROMBANK_WEB'));

    const released = await service.releaseForOrder('order-1', 'order-cancelled');

    expect(webClient.cancel).toHaveBeenCalledWith('1100042');
    expect(client.invoke).not.toHaveBeenCalled();
    expect(released?.status).toBe('REFUNDED');
    expect(prisma.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'REFUND_ISSUED',
        payload: expect.objectContaining({ provider: 'AGROPROMBANK_WEB', kind: 'hold-released' }),
      }),
    });
  });

  it('releases a bound-card hold with ReverseOperation', async () => {
    const { service, prisma, client, webClient } = build();
    prisma.payment.findFirst.mockResolvedValue(hold('AGROPROMBANK'));

    await service.releaseForOrder('order-1', 'order-cancelled');

    expect(client.invoke).toHaveBeenCalledWith('ReverseOperation', { invoiceid: '1100042', amount: 3300 });
    expect(webClient.cancel).not.toHaveBeenCalled();
  });

  /** A charge that was waiting for the accept never reached the bank — there is nothing to give back. */
  it('calls off a deferred charge without asking the bank', async () => {
    const { service, prisma, client, webClient } = build('token');
    const deferred = { ...hold('AGROPROMBANK', { deferred: true }), invoiceId: null };
    prisma.payment.findFirst.mockResolvedValue(deferred);
    prisma.payment.findUnique.mockResolvedValue({ ...deferred, status: 'FAILED' });

    const released = await service.releaseForOrder('order-1', 'order-cancelled-by-store');

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: deferred.id, status: 'REQUIRES_ACTION', invoiceId: null },
      data: {
        status: 'FAILED',
        rawJson: { deferred: true, voided: true, voidReason: 'order-cancelled-by-store' },
      },
    });
    expect(client.invoke).not.toHaveBeenCalled();
    expect(webClient.cancel).not.toHaveBeenCalled();
    expect(prisma.orderEvent.create).not.toHaveBeenCalled();
    expect(released?.status).toBe('FAILED');
  });

  it('counts a failed release on the payment instead of throwing', async () => {
    const { service, prisma, webClient } = build();
    prisma.payment.findFirst.mockResolvedValue(hold('AGROPROMBANK_WEB', { releaseAttempts: 2 }));
    webClient.cancel.mockRejectedValue(
      new AgroprombankWebError('CancelOperation', 0, 'Отмена возможна только в день оплаты'),
    );

    await expect(service.releaseForOrder('order-1', 'order-expired')).resolves.toBeNull();

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'hold-AGROPROMBANK_WEB' },
      data: { rawJson: expect.objectContaining({ releaseAttempts: 3 }) },
    });
  });

  it('retries holds left on cancelled or expired orders, and gives up after the cap', async () => {
    const { service, prisma, client, webClient } = build();
    prisma.payment.findMany.mockResolvedValue([
      hold('AGROPROMBANK'),
      hold('AGROPROMBANK_WEB', { releaseAttempts: MAX_RELEASE_ATTEMPTS }),
    ]);
    client.invoke.mockRejectedValueOnce(new AgroprombankTransportError('ReverseOperation', 'timed out'));

    const result = await service.retryPendingReleases();

    const where = prisma.payment.findMany.mock.calls[0]?.[0]?.where;
    expect(where.status).toBe('REQUIRES_ACTION');
    expect(where.OR).toEqual([
      { order: { status: { in: ['CANCELLED', 'EXPIRED'] } } },
      { rawJson: { path: ['releaseRequired'], equals: true } },
    ]);
    expect(result).toEqual({ checked: 1, released: 0 });
    expect(webClient.cancel).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  // The order screen said «Блокировка на карте будет снята автоматически»; now it has been.
  it('marks a cancelled order whose money was still on its way as released once the retry lands', async () => {
    const { service, prisma } = build();
    prisma.payment.findMany.mockResolvedValue([hold('AGROPROMBANK_WEB')]);

    const result = await service.retryPendingReleases();

    expect(result).toEqual({ checked: 1, released: 1 });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', cancelMoney: 'PENDING' },
      data: { cancelMoney: 'RELEASED' },
    });
  });

  it('requires a card for a paid order whichever flow is on, and none when both are off', () => {
    expect(build('web').service.cardPaymentRequired({ totalCents: 100, currency: 'RUP' })).toBe(true);
    expect(build('token').service.cardPaymentRequired({ totalCents: 100, currency: 'RUP' })).toBe(true);
    expect(build('none').service.cardPaymentRequired({ totalCents: 100, currency: 'RUP' })).toBe(false);
    expect(build('web').service.cardPaymentRequired({ totalCents: 0, currency: 'RUP' })).toBe(false);
  });

  // With cards off, a QR-only deployment still needs paying — but only in a currency QR takes.
  it('requires payment when only the QR payment is on, for orders in its currency', () => {
    expect(build('none', ['RUP']).service.cardPaymentRequired({ totalCents: 100, currency: 'RUP' })).toBe(true);
    expect(build('none', ['RUP']).service.cardPaymentRequired({ totalCents: 100, currency: 'USD' })).toBe(false);
    expect(build('none', ['RUP']).service.cardPaymentRequired({ totalCents: 0, currency: 'RUP' })).toBe(false);
  });

  it('gives a paid QR invoice back with ReversePayment, using the ids recorded when it was paid', async () => {
    const { service, prisma, client, webClient, qrClient } = build();
    const qrHold = hold('AGROPROMBANK_QR', { qrPaymentId: '5229848', rrn: '000602981706' });
    prisma.payment.findFirst.mockResolvedValue(qrHold);
    prisma.payment.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...qrHold,
      ...data,
    }));

    const released = await service.releaseForOrder('order-1', 'order-cancelled-by-store');

    expect(qrClient.reverseInvoice).toHaveBeenCalledWith('1100042', { qrPaymentId: '5229848', rrn: '000602981706' });
    expect(client.invoke).not.toHaveBeenCalled();
    expect(webClient.cancel).not.toHaveBeenCalled();
    expect(released?.status).toBe('REFUNDED');
    expect(releaseOutcome(released, true)).toBe('REFUNDED');
    expect(prisma.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({ provider: 'AGROPROMBANK_QR', kind: 'reversal' }),
      }),
    });
  });

  it('says REFUND NEEDED when a QR payment still cannot be given back after the last try', async () => {
    const { service, prisma, qrClient } = build();
    prisma.payment.findFirst.mockResolvedValue(
      hold('AGROPROMBANK_QR', { qrPaymentId: '1', rrn: '2', releaseAttempts: MAX_RELEASE_ATTEMPTS - 1 }),
    );
    qrClient.reverseInvoice.mockRejectedValue(new AgroprombankQrError('ReversePayment', 'Отмена невозможна'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.releaseForOrder('order-1', 'retry')).resolves.toBeNull();

    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^REFUND NEEDED: /));
    error.mockRestore();
  });
});
