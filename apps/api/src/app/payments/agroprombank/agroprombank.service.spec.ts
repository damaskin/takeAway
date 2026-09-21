import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { SecretCipher } from '../../common/crypto/secret-cipher';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderSettlementService } from '../order-settlement.service';
import { AgroprombankClient, AgroprombankError, AgroprombankTransportError } from './agroprombank.client';
import { AgroprombankConfig } from './agroprombank.config';
import { AgroprombankService } from './agroprombank.service';
import { parseXml } from './xml';

const CHECK_TOKEN_OK = parseXml(
  '<root><result>1</result><pan>9104 **** **** 1234</pan><embossing>MA*** *******</embossing><cardstate>1</cardstate></root>',
);
const CHECK_TOKEN_REVOKED = parseXml('<root><result>1</result><cardstate>-1</cardstate></root>');
const PAYMENT_OK = parseXml(
  '<root><result>1</result><operationid>123456789</operationid><cos>1</cos>' +
    '<trx><type>debet</type><rrn>000721413841</rrn><authcode>595141</authcode><responsecode>00</responsecode></trx>' +
    '</root>',
);

describe('AgroprombankService', () => {
  let service: AgroprombankService;
  let client: { invoke: jest.Mock; invokeRaw: jest.Mock };
  let settlement: { settlePaidOrder: jest.Mock };
  let prisma: PrismaMock;

  interface PrismaMock {
    order: { findUnique: jest.Mock };
    payment: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    cardToken: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      upsert: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
    };
    cardBindingRequest: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    orderEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  }

  const order = {
    id: 'order-1',
    userId: 'user-1',
    orderCode: '4242',
    status: 'CREATED',
    totalCents: 3300,
    currency: 'RUP',
  };

  const card = {
    id: 'card-1',
    userId: 'user-1',
    provider: 'AGROPROMBANK',
    status: 'ACTIVE',
    tokenCipher: 'cipher:E6B2C8',
    tokenFingerprint: 'fp',
    maskedPan: null,
    embossing: null,
    institute: '0001',
    label: null,
    cardState: null,
    isDefault: true,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    lastUsedAt: null,
  };

  const pendingPayment = {
    id: 'pay-1',
    orderId: order.id,
    provider: 'AGROPROMBANK',
    status: 'PENDING',
    invoiceId: '17560123456781234',
    amountCents: 3300,
    tipCents: 0,
    refundedCents: 0,
    currency: 'RUP',
    providerRef: null,
    rawJson: null,
  };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      payment: {
        // First lookup is for a settled payment, second for an in-flight one.
        findFirst: jest.fn(({ where }) => Promise.resolve(typeof where.status === 'string' ? null : null)),
        findUnique: jest.fn().mockResolvedValue({ ...pendingPayment, status: 'SUCCEEDED' }),
        create: jest.fn().mockResolvedValue(pendingPayment),
        update: jest.fn(({ data }) => Promise.resolve({ ...pendingPayment, ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      cardToken: {
        findUnique: jest.fn().mockResolvedValue(card),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(({ data }) => Promise.resolve({ ...card, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue(card),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([card]),
      },
      cardBindingRequest: {
        findUnique: jest.fn(),
        create: jest.fn(({ data }) => Promise.resolve({ id: 'bind-1', ...data })),
        update: jest.fn(({ data }) => Promise.resolve({ id: 'bind-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };

    client = { invoke: jest.fn(), invokeRaw: jest.fn() };
    settlement = { settlePaidOrder: jest.fn().mockResolvedValue(order) };

    const module = await Test.createTestingModule({
      providers: [
        AgroprombankService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AgroprombankConfig,
          useValue: {
            enabled: true,
            isConfigured: true,
            missingSettings: () => [],
            terminalId: 'E1016682',
            isTest: false,
            invoicePrefix: '',
            bindingTtlMinutes: 10,
            bindingMaxAttempts: 3,
          } as Partial<AgroprombankConfig>,
        },
        { provide: AgroprombankClient, useValue: client },
        {
          provide: SecretCipher,
          useValue: {
            encrypt: (v: string) => `cipher:${v}`,
            decrypt: (v: string) => v.replace(/^cipher:/, ''),
          },
        },
        { provide: OrderSettlementService, useValue: settlement },
      ],
    }).compile();

    service = module.get(AgroprombankService);
  });

  describe('charge', () => {
    it('checks the token, charges the card and settles the order', async () => {
      client.invoke.mockResolvedValueOnce(CHECK_TOKEN_OK).mockResolvedValueOnce(PAYMENT_OK);

      const result = await service.charge('user-1', { orderId: order.id, cardId: card.id });

      expect(client.invoke).toHaveBeenNthCalledWith(1, 'CheckToken', { token: 'E6B2C8' });
      expect(client.invoke).toHaveBeenNthCalledWith(
        2,
        'ProcessCardAutoPayment',
        expect.objectContaining({
          invoiceid: pendingPayment.invoiceId,
          token: 'E6B2C8',
          amount: 3300,
          tipamount: 0,
          currencycode: '000',
          terminalid: 'E1016682',
          preauth: 0,
          description: 'Оплата заказа №4242',
        }),
      );
      expect(settlement.settlePaidOrder).toHaveBeenCalledWith(
        order.id,
        expect.objectContaining({
          event: expect.objectContaining({
            type: 'PAYMENT_SUCCEEDED',
            payload: expect.objectContaining({ rrn: '000721413841', authCode: '595141' }),
          }),
        }),
      );
      expect(result.status).toBe('SUCCEEDED');
      expect(result.operationId).toBe('123456789');
    });

    it('records a declined charge and leaves the order unpaid', async () => {
      client.invoke
        .mockResolvedValueOnce(CHECK_TOKEN_OK)
        .mockRejectedValueOnce(new AgroprombankError('ProcessCardAutoPayment', 116, 'Недостаточно средств'));

      await expect(service.charge('user-1', { orderId: order.id, cardId: card.id })).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
      expect(prisma.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'PAYMENT_FAILED' }) }),
      );
      expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    });

    /**
     * The money may well have moved. Marking the payment FAILED here would let
     * the customer be charged for an order we then treat as unpaid, so the row
     * stays PENDING for the reconciliation pass.
     */
    it('leaves the payment pending when the bank does not answer', async () => {
      client.invoke
        .mockResolvedValueOnce(CHECK_TOKEN_OK)
        .mockRejectedValueOnce(new AgroprombankTransportError('ProcessCardAutoPayment', 'request timed out'));

      await expect(service.charge('user-1', { orderId: order.id, cardId: card.id })).rejects.toThrow(
        BadGatewayException,
      );

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    });

    it('does not charge twice for an order that is already paid', async () => {
      prisma.payment.findFirst.mockImplementation(({ where }: { where: { status: unknown } }) =>
        Promise.resolve(typeof where.status === 'string' ? { ...pendingPayment, status: 'SUCCEEDED' } : null),
      );

      const result = await service.charge('user-1', { orderId: order.id, cardId: card.id });

      expect(result.status).toBe('SUCCEEDED');
      expect(client.invoke).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('holds the funds without settling when preauth is requested', async () => {
      client.invoke.mockResolvedValueOnce(CHECK_TOKEN_OK).mockResolvedValueOnce(PAYMENT_OK);

      const result = await service.charge('user-1', { orderId: order.id, cardId: card.id, preauth: true });

      expect(client.invoke).toHaveBeenNthCalledWith(
        2,
        'ProcessCardAutoPayment',
        expect.objectContaining({ preauth: 1 }),
      );
      expect(result.status).toBe('REQUIRES_ACTION');
      expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    });

    it('retires a card the bank reports as inactive instead of charging it', async () => {
      client.invoke.mockResolvedValueOnce(CHECK_TOKEN_REVOKED);

      await expect(service.charge('user-1', { orderId: order.id, cardId: card.id })).rejects.toThrow(
        'no longer active',
      );

      expect(prisma.cardToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKED', isDefault: false }) }),
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('refuses a currency the bank does not settle', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...order, currency: 'GBP' });

      await expect(service.charge('user-1', { orderId: order.id, cardId: card.id })).rejects.toThrow(
        'does not settle in GBP',
      );
      expect(client.invoke).not.toHaveBeenCalled();
    });

    it('refuses an order that belongs to somebody else', async () => {
      await expect(service.charge('user-2', { orderId: order.id, cardId: card.id })).rejects.toThrow('Order not found');
      expect(client.invoke).not.toHaveBeenCalled();
    });

    it('never re-charges an order that already has funds held on it', async () => {
      prisma.payment.findFirst.mockImplementation(({ where }: { where: { status: unknown } }) =>
        Promise.resolve(typeof where.status === 'string' ? null : { ...pendingPayment, status: 'REQUIRES_ACTION' }),
      );

      const result = await service.charge('user-1', { orderId: order.id, cardId: card.id });

      // Reconciling a hold would read it as a completed payment and settle the
      // order for money that has not been captured.
      expect(result.status).toBe('REQUIRES_ACTION');
      expect(client.invoke).not.toHaveBeenCalled();
      expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    });

    it('refuses to charge again while an earlier attempt is still unresolved', async () => {
      prisma.payment.findFirst.mockImplementation(({ where }: { where: { status: unknown } }) =>
        Promise.resolve(typeof where.status === 'string' ? null : pendingPayment),
      );
      client.invoke.mockRejectedValueOnce(new AgroprombankTransportError('CheckOperation', 'timed out'));

      await expect(service.charge('user-1', { orderId: order.id, cardId: card.id })).rejects.toThrow(
        BadGatewayException,
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('charges again once the bank confirms the earlier attempt never landed', async () => {
      let stale: Record<string, unknown> | null = pendingPayment;
      prisma.payment.findFirst.mockImplementation(({ where }: { where: { status: unknown } }) =>
        Promise.resolve(typeof where.status === 'string' ? null : stale),
      );
      prisma.payment.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        if (data['status'] === 'FAILED') stale = null;
        return Promise.resolve({ ...pendingPayment, ...data });
      });
      client.invoke
        .mockRejectedValueOnce(new AgroprombankError('CheckOperation', 404, 'Операция не найдена'))
        .mockResolvedValueOnce(CHECK_TOKEN_OK)
        .mockResolvedValueOnce(PAYMENT_OK);

      const result = await service.charge('user-1', { orderId: order.id, cardId: card.id });

      expect(result.status).toBe('SUCCEEDED');
      expect(prisma.payment.create).toHaveBeenCalled();
    });

    it('charges the tip on top of the order total', async () => {
      client.invoke.mockResolvedValueOnce(CHECK_TOKEN_OK).mockResolvedValueOnce(PAYMENT_OK);

      await service.charge('user-1', { orderId: order.id, cardId: card.id, tipCents: 150 });

      expect(client.invoke).toHaveBeenNthCalledWith(
        2,
        'ProcessCardAutoPayment',
        expect.objectContaining({ amount: 3300, tipamount: 150 }),
      );
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tipCents: 150 }) }),
      );
    });
  });

  describe('confirmBinding', () => {
    const binding = {
      id: 'bind-1',
      userId: 'user-1',
      bankRequestId: '123456',
      status: 'PENDING',
      attempts: 0,
      deactivateOld: false,
      institute: '0001',
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('exchanges the one-time password for a stored token', async () => {
      prisma.cardBindingRequest.findUnique.mockResolvedValue(binding);
      client.invoke
        .mockResolvedValueOnce(parseXml('<root><result>1</result><token>E6B2C8</token></root>'))
        .mockResolvedValueOnce(CHECK_TOKEN_OK);

      const result = await service.confirmBinding('user-1', 'bind-1', '047805');

      expect(client.invoke).toHaveBeenNthCalledWith(1, 'ProcessTokenRequest', {
        requestid: '123456',
        code: '047805',
      });
      // The token is a bearer credential — it must never hit the DB in clear.
      expect(prisma.cardToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ tokenCipher: 'cipher:E6B2C8' }) }),
      );
      expect(result.maskedPan).toBe('9104 **** **** 1234');
    });

    it('scopes the stored token to the customer, so a shared card works for both', async () => {
      prisma.cardBindingRequest.findUnique.mockResolvedValue(binding);
      client.invoke
        .mockResolvedValueOnce(parseXml('<root><result>1</result><token>E6B2C8</token></root>'))
        .mockResolvedValueOnce(CHECK_TOKEN_OK);

      await service.confirmBinding('user-1', 'bind-1', '047805');

      // The bank derives the token from card + merchant, so two accounts
      // sharing a physical card get the same one.
      expect(prisma.cardToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_tokenFingerprint: { userId: 'user-1', tokenFingerprint: expect.any(String) } },
        }),
      );
    });

    it('burns an attempt on a wrong code', async () => {
      prisma.cardBindingRequest.findUnique.mockResolvedValue(binding);
      client.invoke.mockRejectedValueOnce(new AgroprombankError('ProcessTokenRequest', 5, 'Неверный пароль'));

      await expect(service.confirmBinding('user-1', 'bind-1', '000000')).rejects.toThrow('Неверный пароль');
      expect(prisma.cardBindingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attempts: 1, status: 'PENDING' }) }),
      );
    });

    it('kills the request once the attempts run out', async () => {
      prisma.cardBindingRequest.findUnique.mockResolvedValue({ ...binding, attempts: 2 });
      client.invoke.mockRejectedValueOnce(new AgroprombankError('ProcessTokenRequest', 5, 'Неверный пароль'));

      await expect(service.confirmBinding('user-1', 'bind-1', '000000')).rejects.toThrow();
      expect(prisma.cardBindingRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attempts: 3, status: 'FAILED' }) }),
      );
    });

    it('refuses an expired one-time password', async () => {
      prisma.cardBindingRequest.findUnique.mockResolvedValue({
        ...binding,
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(service.confirmBinding('user-1', 'bind-1', '047805')).rejects.toThrow('expired');
      expect(client.invoke).not.toHaveBeenCalled();
    });

    it('refuses a binding request that belongs to somebody else', async () => {
      prisma.cardBindingRequest.findUnique.mockResolvedValue(binding);
      await expect(service.confirmBinding('user-2', 'bind-1', '047805')).rejects.toThrow('not found');
      expect(client.invoke).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('refuses to refund more than is left on the payment', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...pendingPayment,
        status: 'PARTIALLY_REFUNDED',
        refundedCents: 3000,
      });

      await expect(service.refund('pay-1', 500)).rejects.toThrow('between 1 and 300');
      expect(client.invoke).not.toHaveBeenCalled();
    });

    it('marks a payment fully refunded once nothing is left', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...pendingPayment, status: 'SUCCEEDED' });
      client.invoke.mockResolvedValueOnce(parseXml('<root><result>1</result></root>'));

      await service.refund('pay-1', 3300);

      expect(client.invoke).toHaveBeenCalledWith('RefundOperation', {
        invoiceid: pendingPayment.invoiceId,
        amount: 3300,
        refundamount: 3300,
      });
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REFUNDED', refundedCents: 3300 }) }),
      );
    });
  });

  describe('completePreauthorization', () => {
    it('allows capturing up to 110% of the held amount', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...pendingPayment, status: 'REQUIRES_ACTION' });
      client.invoke.mockResolvedValueOnce(parseXml('<root><result>1</result></root>'));

      await service.completePreauthorization('pay-1', 3630);

      expect(client.invoke).toHaveBeenCalledWith('CompletePreAuthorizaion', {
        invoiceid: pendingPayment.invoiceId,
        amount: 3630,
        terminalid: 'E1016682',
      });
      expect(settlement.settlePaidOrder).toHaveBeenCalled();
    });

    it('refuses to capture more than 110%', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...pendingPayment, status: 'REQUIRES_ACTION' });

      await expect(service.completePreauthorization('pay-1', 3631)).rejects.toThrow('between 1 and 3630');
      expect(client.invoke).not.toHaveBeenCalled();
    });
  });

  describe('reconcilePayment', () => {
    it('settles a payment the bank confirms went through', async () => {
      client.invoke.mockResolvedValueOnce(PAYMENT_OK);

      const result = await service.reconcilePayment(pendingPayment as never);

      expect(client.invoke).toHaveBeenCalledWith('CheckOperation', {
        invoiceid: pendingPayment.invoiceId,
        amount: 3300,
      });
      expect(result.status).toBe('SUCCEEDED');
      expect(settlement.settlePaidOrder).toHaveBeenCalled();
    });

    it('fails a payment the bank has no record of', async () => {
      client.invoke.mockRejectedValueOnce(new AgroprombankError('CheckOperation', 404, 'Операция не найдена'));

      const result = await service.reconcilePayment(pendingPayment as never);

      expect(result.status).toBe('FAILED');
      expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    });

    it('leaves a payment alone while the bank is still unreachable', async () => {
      client.invoke.mockRejectedValueOnce(new AgroprombankTransportError('CheckOperation', 'timed out'));

      await expect(service.reconcilePayment(pendingPayment as never)).rejects.toThrow(AgroprombankTransportError);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });
});
