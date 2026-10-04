import type { PrismaService } from '../../prisma/prisma.service';
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
  const hold = (provider: 'AGROPROMBANK' | 'AGROPROMBANK_WEB', raw: Record<string, unknown> = {}) => ({
    id: `hold-${provider}`,
    orderId: 'order-1',
    provider,
    status: 'REQUIRES_ACTION',
    invoiceId: '1100042',
    amountCents: 3300,
    rawJson: raw,
  });

  function build(flow: 'token' | 'web' | 'none' = 'web') {
    const prisma = {
      payment: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...hold('AGROPROMBANK_WEB'),
          ...data,
        })),
      },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const client = { invoke: jest.fn().mockResolvedValue({}) };
    const webClient = { cancel: jest.fn().mockResolvedValue({ state: 2 }) };
    const service = new PaymentHoldsService(
      prisma as unknown as PrismaService,
      { isConfigured: true, enabled: true } as unknown as AgroprombankConfig,
      client as unknown as AgroprombankClient,
      { isConfigured: true, cardPaymentFlow: flow } as unknown as AgroprombankWebConfig,
      webClient as unknown as AgroprombankWebClient,
    );
    return { service, prisma, client, webClient };
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
  });

  it('requires a card for a paid order whichever flow is on, and none when both are off', () => {
    expect(build('web').service.cardPaymentRequired({ totalCents: 100 })).toBe(true);
    expect(build('token').service.cardPaymentRequired({ totalCents: 100 })).toBe(true);
    expect(build('none').service.cardPaymentRequired({ totalCents: 100 })).toBe(false);
    expect(build('web').service.cardPaymentRequired({ totalCents: 0 })).toBe(false);
  });
});
