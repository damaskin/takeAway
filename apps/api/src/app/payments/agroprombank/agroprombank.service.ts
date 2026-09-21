import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CardToken, Currency, Payment, Prisma } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';

import { SecretCipher } from '../../common/crypto/secret-cipher';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderSettlementService } from '../order-settlement.service';
import { AgroprombankClient, AgroprombankError, AgroprombankTransportError } from './agroprombank.client';
import { AgroprombankConfig, CARD_INSTITUTES } from './agroprombank.config';
import { type XmlElement, children, num, text, toPlainObject } from './xml';

/**
 * Currency codes from the ПРБ directory the bank uses. `000` is the
 * Transnistrian rouble — the only currency the «Клевер» scheme settles in
 * today; the rest are listed so a misconfigured brand fails loudly instead of
 * silently charging in the wrong currency.
 */
const BANK_CURRENCY_CODES: Partial<Record<Currency, string>> = {
  RUP: '000',
  USD: '840',
  EUR: '978',
  MDL: '498',
};

export interface BoundCardView {
  id: string;
  maskedPan: string | null;
  embossing: string | null;
  institute: string | null;
  instituteName: string | null;
  label: string | null;
  isDefault: boolean;
  cardState: number | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface StartBindingResult {
  bindingId: string;
  /** `true` when the bank issued the token straight away (prepaid cards). */
  completed: boolean;
  card: BoundCardView | null;
  expiresAt: string;
}

export interface ChargeOptions {
  orderId: string;
  cardId: string;
  tipCents?: number;
  /** Hold the funds instead of capturing them; complete later. */
  preauth?: boolean;
  /** Route the tip to an employee token (patent) rather than the company. */
  recipientToken?: string;
  recipientName?: string;
}

export interface ChargeResult {
  paymentId: string;
  status: Payment['status'];
  operationId: string | null;
  invoiceId: string;
  amountCents: number;
  tipCents: number;
  /** `0` when only part of a composite (payment + tip) transaction went through. */
  compositeStatus: number | null;
  authCode: string | null;
  rrn: string | null;
}

/**
 * Agroprombank («Клевер») tokenized card payments.
 *
 * The customer binds a card once — last four digits, phone, issuer — and
 * confirms with an SMS one-time password. From then on the bank charges that
 * card against a 64-character token with no further customer interaction,
 * which is what makes one-tap checkout in the Telegram mini app possible.
 *
 * Money-safety rules that shape this class:
 *  - the merchant-side `invoiceid` is allocated *before* the call and never
 *    reused, so a retry can be recognised by the bank;
 *  - a transport failure leaves the payment PENDING rather than FAILED — the
 *    charge may well have gone through, and {@link reconcilePendingPayments}
 *    resolves it against the bank rather than us guessing;
 *  - only a verified `result=1` response flips the order to PAID.
 */
@Injectable()
export class AgroprombankService {
  private readonly logger = new Logger(AgroprombankService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AgroprombankConfig,
    private readonly client: AgroprombankClient,
    private readonly cipher: SecretCipher,
    private readonly settlement: OrderSettlementService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Card binding
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Step 1 of binding: hands the card hint to the bank, which SMSes a one-time
   * password to the customer. Nothing the customer typed is persisted beyond
   * the last four digits and the phone number.
   */
  async startBinding(
    userId: string,
    input: {
      lastDigits: string;
      phone: string;
      institute: string;
      fio?: string;
      deactivateOld?: boolean;
      label?: string;
    },
  ): Promise<StartBindingResult> {
    this.assertEnabled();
    const lastDigits = input.lastDigits.trim();
    const phone = input.phone.replace(/[\s()-]/g, '');
    if (!/^\d{4}$/.test(lastDigits)) throw new BadRequestException('lastDigits must be exactly 4 digits');
    if (!/^\d{6,12}$/.test(phone)) throw new BadRequestException('phone must be 6-12 digits');
    if (!CARD_INSTITUTES.some((i) => i.code === input.institute)) {
      throw new BadRequestException(`institute must be one of ${CARD_INSTITUTES.map((i) => i.code).join(', ')}`);
    }

    // The bank shows this text to the customer when they review their bindings.
    const description = truncate(`Оплата заказов в takeAway. Пользователь ${userId}`, 128);
    const deactivateOld = input.deactivateOld ?? false;

    const response = await this.client.invoke('NewTokenRequest', {
      LastDigit: lastDigits,
      Phone: phone,
      deactivateold: deactivateOld ? 1 : 0,
      description,
      fio: input.fio?.trim() || null,
      institute: input.institute,
    });

    const expiresAt = new Date(Date.now() + this.config.bindingTtlMinutes * 60_000);

    // Prepaid cards skip the one-time password entirely — the bank answers
    // NewTokenRequest with the token itself.
    const immediateToken = text(response, 'token')?.trim();
    if (immediateToken) {
      const card = await this.persistToken(userId, immediateToken, {
        institute: input.institute,
        label: input.label,
        deactivateOld,
      });
      const binding = await this.prisma.cardBindingRequest.create({
        data: {
          userId,
          bankRequestId: text(response, 'requestid')?.trim() ?? `direct-${card.id}`,
          lastDigits,
          phone,
          institute: input.institute,
          deactivateOld,
          status: 'CONFIRMED',
          cardTokenId: card.id,
          expiresAt,
        },
      });
      return {
        bindingId: binding.id,
        completed: true,
        card: this.toCardView(card),
        expiresAt: expiresAt.toISOString(),
      };
    }

    const bankRequestId = text(response, 'requestid')?.trim();
    if (!bankRequestId) {
      throw new BadGatewayException('Bank did not return a token request id');
    }

    const binding = await this.prisma.cardBindingRequest.create({
      data: { userId, bankRequestId, lastDigits, phone, institute: input.institute, deactivateOld, expiresAt },
    });
    return { bindingId: binding.id, completed: false, card: null, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Step 2 of binding: exchanges the SMS one-time password for a token.
   *
   * A wrong code burns an attempt; running out of attempts (or out of time)
   * kills the request so a stolen phone cannot be brute-forced.
   */
  async confirmBinding(userId: string, bindingId: string, code: string): Promise<BoundCardView> {
    this.assertEnabled();
    const binding = await this.prisma.cardBindingRequest.findUnique({ where: { id: bindingId } });
    if (!binding || binding.userId !== userId) throw new NotFoundException('Card binding request not found');
    if (binding.status === 'CONFIRMED') throw new ConflictException('This card is already bound');
    if (binding.status !== 'PENDING') throw new BadRequestException('This binding request is no longer usable');

    if (binding.expiresAt.getTime() < Date.now()) {
      await this.prisma.cardBindingRequest.update({
        where: { id: binding.id },
        data: { status: 'EXPIRED', failureReason: 'One-time password expired' },
      });
      throw new BadRequestException('The one-time password has expired — start again');
    }

    if (binding.attempts >= this.config.bindingMaxAttempts) {
      await this.prisma.cardBindingRequest.update({
        where: { id: binding.id },
        data: { status: 'FAILED', failureReason: 'Too many attempts' },
      });
      throw new BadRequestException('Too many attempts — start again');
    }

    let response: XmlElement;
    try {
      response = await this.client.invoke('ProcessTokenRequest', {
        requestid: binding.bankRequestId,
        code: code.trim(),
      });
    } catch (err) {
      const attempts = binding.attempts + 1;
      const exhausted = attempts >= this.config.bindingMaxAttempts;
      await this.prisma.cardBindingRequest.update({
        where: { id: binding.id },
        data: {
          attempts,
          status: exhausted ? 'FAILED' : 'PENDING',
          failureReason: err instanceof Error ? truncate(err.message, 250) : 'Unknown error',
        },
      });
      throw this.toHttpException(err);
    }

    const token = text(response, 'token')?.trim();
    if (!token) throw new BadGatewayException('Bank confirmed the code but returned no token');

    const card = await this.persistToken(userId, token, {
      institute: binding.institute,
      deactivateOld: binding.deactivateOld,
    });
    await this.prisma.cardBindingRequest.update({
      where: { id: binding.id },
      data: { status: 'CONFIRMED', attempts: binding.attempts + 1, cardTokenId: card.id, failureReason: null },
    });

    // Best-effort enrichment: the masked PAN makes the card recognisable in
    // the UI, but a failure here must not undo a successful binding.
    const enriched = await this.refreshCardSafely(card);
    return this.toCardView(enriched);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Card management
  // ───────────────────────────────────────────────────────────────────────────

  async listCards(userId: string): Promise<BoundCardView[]> {
    const cards = await this.prisma.cardToken.findMany({
      where: { userId, provider: 'AGROPROMBANK', status: 'ACTIVE' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return cards.map((card) => this.toCardView(card));
  }

  /** Re-reads the card state from the bank; a revoked token is retired locally. */
  async refreshCard(userId: string, cardId: string): Promise<BoundCardView> {
    this.assertEnabled();
    const card = await this.requireCard(userId, cardId);
    const response = await this.client.invoke('CheckToken', { token: this.revealToken(card) });
    return this.toCardView(await this.applyCheckTokenResponse(card, response));
  }

  /**
   * Unbinds a card: the bank drops the token, we retire the row.
   *
   * The token belongs to the card + merchant pair, so unbinding a card two
   * accounts share revokes it for both. That is the bank's model, not ours.
   */
  async deleteCard(userId: string, cardId: string): Promise<void> {
    const card = await this.requireCard(userId, cardId);

    if (this.config.isConfigured) {
      try {
        await this.client.invoke('DeactivateToken', { token: this.revealToken(card) });
      } catch (err) {
        // A token the bank already considers dead still has to disappear from
        // the customer's card list, so we log and retire it locally.
        this.logger.warn(`DeactivateToken failed for card=${card.id}: ${messageOf(err)}`);
      }
    }

    await this.prisma.cardToken.update({
      where: { id: card.id },
      data: { status: 'DEACTIVATED', isDefault: false, deactivatedAt: new Date() },
    });
    await this.promoteDefaultCard(card.userId);
  }

  async setDefaultCard(userId: string, cardId: string): Promise<BoundCardView> {
    const card = await this.requireCard(userId, cardId);
    await this.prisma.$transaction([
      this.prisma.cardToken.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
      this.prisma.cardToken.update({ where: { id: card.id }, data: { isDefault: true } }),
    ]);
    return this.toCardView({ ...card, isDefault: true });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Payments
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Charges a bound card for an order and settles the order on success.
   *
   * Idempotent per order: an order already paid returns the existing payment
   * instead of charging twice, and a payment left PENDING by an earlier
   * transport failure is resolved against the bank before anything new is sent.
   */
  async charge(userId: string, options: ChargeOptions): Promise<ChargeResult> {
    this.assertEnabled();

    const order = await this.prisma.order.findUnique({ where: { id: options.orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');

    const settled = await this.prisma.payment.findFirst({
      where: { orderId: order.id, provider: 'AGROPROMBANK', status: 'SUCCEEDED' },
    });
    if (settled) return this.toChargeResult(settled);

    const stale = await this.prisma.payment.findFirst({
      where: { orderId: order.id, provider: 'AGROPROMBANK', status: { in: ['PENDING', 'REQUIRES_ACTION'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (stale?.status === 'REQUIRES_ACTION') {
      // Funds are already held against this order. Reconciling would read the
      // hold as a completed payment and settle the order for money that has
      // not been captured yet — capture it explicitly instead.
      return this.toChargeResult(stale);
    }
    if (stale) {
      let resolved: Payment;
      try {
        resolved = await this.reconcilePayment(stale);
      } catch (err) {
        // Still no answer about the earlier attempt. Charging again could
        // double-debit the customer, so refuse until reconciliation resolves it.
        this.logger.warn(`Could not resolve in-flight payment=${stale.id}: ${messageOf(err)}`);
        throw new BadGatewayException('A previous payment for this order is still being verified');
      }
      if (resolved.status === 'SUCCEEDED') return this.toChargeResult(resolved);
    }

    if (order.status !== 'CREATED') {
      throw new BadRequestException(`Cannot start payment for an order in status ${order.status}`);
    }

    const currencyCode = BANK_CURRENCY_CODES[order.currency];
    if (!currencyCode) {
      throw new BadRequestException(`Agroprombank does not settle in ${order.currency}`);
    }

    const card = await this.requireCard(userId, options.cardId);
    const token = this.revealToken(card);

    // The bank documents a token check before every payment: a customer can
    // revoke a token in their banking app and we would otherwise only find out
    // from a failed charge.
    const checked = await this.applyCheckTokenResponse(card, await this.client.invoke('CheckToken', { token }));
    if (checked.status !== 'ACTIVE') {
      throw new BadRequestException('This card is no longer active — bind it again');
    }

    const tipCents = Math.max(0, Math.trunc(options.tipCents ?? 0));
    const payment = await this.createPendingPayment(order.id, {
      amountCents: order.totalCents,
      tipCents,
      currency: order.currency,
      cardTokenId: card.id,
    });

    let response: XmlElement;
    try {
      response = await this.client.invoke('ProcessCardAutoPayment', {
        invoiceid: payment.invoiceId,
        token,
        amount: order.totalCents,
        tipamount: tipCents,
        currencycode: currencyCode,
        istest: this.config.isTest ? '1' : '0',
        description: truncate(`Оплата заказа №${order.orderCode}`, 128),
        recipienttoken: options.recipientToken ?? null,
        recipient: options.recipientToken ? (options.recipientName ?? null) : null,
        terminalid: this.config.terminalId,
        preauth: options.preauth ? 1 : 0,
      });
    } catch (err) {
      if (err instanceof AgroprombankError) {
        // The bank refused the charge — a definitive answer, safe to record.
        await this.markPaymentFailed(payment, err);
        throw new BadRequestException(err.description || 'The bank declined the payment');
      }
      // Unknown outcome: the charge may have gone through. Leave the payment
      // PENDING for reconciliation rather than guessing.
      this.logger.error(`ProcessCardAutoPayment did not complete for payment=${payment.id}: ${messageOf(err)}`);
      throw new BadGatewayException('The bank did not answer in time — the payment is being verified');
    }

    const applied = await this.applyPaymentResponse(payment, response, { preauth: options.preauth ?? false });
    await this.prisma.cardToken.update({ where: { id: card.id }, data: { lastUsedAt: new Date() } });
    return this.toChargeResult(applied);
  }

  /**
   * Captures a preauthorized payment. The bank allows completing up to 110% of
   * the held amount, so a delivery whose final total grew slightly still works.
   */
  async completePreauthorization(paymentId: string, amountCents: number): Promise<ChargeResult> {
    this.assertEnabled();
    const payment = await this.requirePayment(paymentId);
    if (payment.status !== 'REQUIRES_ACTION') {
      throw new BadRequestException('Only a preauthorized payment can be completed');
    }
    const ceiling = Math.floor(payment.amountCents * 1.1);
    if (amountCents <= 0 || amountCents > ceiling) {
      throw new BadRequestException(`Amount must be between 1 and ${ceiling} (110% of the held amount)`);
    }

    await this.client.invoke('CompletePreAuthorizaion', {
      invoiceid: payment.invoiceId,
      amount: amountCents,
      terminalid: this.config.terminalId,
    });

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCEEDED', amountCents },
    });
    await this.settlement.settlePaidOrder(payment.orderId, {
      event: {
        type: 'PAYMENT_SUCCEEDED',
        payload: {
          provider: 'AGROPROMBANK',
          invoiceId: payment.invoiceId,
          operationId: payment.providerRef,
          amount: amountCents,
          preauthCompleted: true,
        } satisfies Prisma.InputJsonValue,
      },
    });
    return this.toChargeResult(updated);
  }

  /**
   * Cancels a payment outright. Irreversible on the bank side, and only
   * possible before the operation settles — use {@link refund} afterwards.
   */
  async reverse(paymentId: string): Promise<ChargeResult> {
    this.assertEnabled();
    const payment = await this.requirePayment(paymentId);
    if (payment.status === 'REFUNDED') throw new ConflictException('This payment has already been reversed');

    await this.client.invoke('ReverseOperation', {
      invoiceid: payment.invoiceId,
      amount: payment.amountCents,
    });

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedCents: payment.amountCents },
    });
    await this.prisma.orderEvent.create({
      data: {
        orderId: payment.orderId,
        type: 'REFUND_ISSUED',
        payload: {
          provider: 'AGROPROMBANK',
          invoiceId: payment.invoiceId,
          amount: payment.amountCents,
          kind: 'reversal',
        } satisfies Prisma.InputJsonValue,
      },
    });
    return this.toChargeResult(updated);
  }

  /** Full or partial refund of a settled payment. Irreversible. */
  async refund(paymentId: string, refundCents: number): Promise<ChargeResult> {
    this.assertEnabled();
    const payment = await this.requirePayment(paymentId);
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new BadRequestException(`Cannot refund a payment in status ${payment.status}`);
    }
    const remaining = payment.amountCents - payment.refundedCents;
    if (refundCents <= 0 || refundCents > remaining) {
      throw new BadRequestException(`Refund must be between 1 and ${remaining}`);
    }

    await this.client.invoke('RefundOperation', {
      invoiceid: payment.invoiceId,
      amount: payment.amountCents,
      refundamount: refundCents,
    });

    const refundedCents = payment.refundedCents + refundCents;
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedCents,
        status: refundedCents >= payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      },
    });
    await this.prisma.orderEvent.create({
      data: {
        orderId: payment.orderId,
        type: 'REFUND_ISSUED',
        payload: {
          provider: 'AGROPROMBANK',
          invoiceId: payment.invoiceId,
          amount: refundCents,
          kind: 'refund',
        } satisfies Prisma.InputJsonValue,
      },
    });
    return this.toChargeResult(updated);
  }

  /** Pulls the bank's own record of an operation — used by support and the cron. */
  async describeOperation(paymentId: string): Promise<Record<string, unknown>> {
    this.assertEnabled();
    const payment = await this.requirePayment(paymentId);
    const response = await this.client.invoke('GetOperation', {
      terminalid: this.config.terminalId,
      invoiceid: payment.invoiceId,
    });
    const operation = children(response, 'operation')[0];
    return operation ? toPlainObject(operation) : {};
  }

  /**
   * Resolves payments whose outcome we never learned — the bank timed out, the
   * process died mid-call, the response failed verification. Called by the
   * reconciliation cron and before any retry of the same order.
   */
  async reconcilePendingPayments(olderThanMs = 60_000, limit = 50): Promise<{ checked: number; settled: number }> {
    if (!this.config.isConfigured) return { checked: 0, settled: 0 };
    const cutoff = new Date(Date.now() - olderThanMs);
    const pending = await this.prisma.payment.findMany({
      where: {
        provider: 'AGROPROMBANK',
        status: 'PENDING',
        invoiceId: { not: null },
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let settled = 0;
    for (const payment of pending) {
      try {
        const resolved = await this.reconcilePayment(payment);
        if (resolved.status === 'SUCCEEDED') settled += 1;
      } catch (err) {
        this.logger.warn(`Reconciliation failed for payment=${payment.id}: ${messageOf(err)}`);
      }
    }
    return { checked: pending.length, settled };
  }

  /**
   * Asks the bank what happened to one payment and brings our row in line.
   * A bank error means "no such operation" — the charge never landed, so the
   * payment is failed rather than left dangling.
   */
  async reconcilePayment(payment: Payment): Promise<Payment> {
    if (!payment.invoiceId) return payment;

    let response: XmlElement;
    try {
      response = await this.client.invoke('CheckOperation', {
        invoiceid: payment.invoiceId,
        amount: payment.amountCents,
      });
    } catch (err) {
      if (err instanceof AgroprombankError) {
        return this.markPaymentFailed(payment, err);
      }
      // Still unknown — leave it for the next pass.
      throw err;
    }

    return this.applyPaymentResponse(payment, response, { preauth: false });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Agroprombank payments are disabled on this deployment');
    }
    const missing = this.config.missingSettings();
    if (missing.length > 0) {
      throw new ServiceUnavailableException(`Agroprombank is not configured: missing ${missing.join(', ')}`);
    }
  }

  /**
   * Records the outcome of ProcessCardAutoPayment / CheckOperation and settles
   * the order when the money actually moved.
   */
  private async applyPaymentResponse(
    payment: Payment,
    response: XmlElement,
    options: { preauth: boolean },
  ): Promise<Payment> {
    const operationId = text(response, 'operationid')?.trim() ?? null;
    const compositeStatus = num(response, 'cos');
    const raw = toPlainObject(response) as Prisma.InputJsonValue;
    const status: Payment['status'] = options.preauth ? 'REQUIRES_ACTION' : 'SUCCEEDED';

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status, providerRef: operationId ?? payment.providerRef, rawJson: raw },
    });

    if (compositeStatus === 0) {
      // Composite transaction (payment + tip payout) only partly went through.
      // The customer was charged, so the order is still paid — but ops needs to
      // know the tip leg is outstanding.
      this.logger.warn(
        `Composite transaction incomplete for payment=${payment.id} invoice=${payment.invoiceId} (cos=0)`,
      );
    }

    if (status === 'SUCCEEDED') {
      const primary = children(response, 'trx').find((trx) => (text(trx, 'type') ?? '').toLowerCase() === 'debet');
      await this.settlement.settlePaidOrder(payment.orderId, {
        event: {
          type: 'PAYMENT_SUCCEEDED',
          payload: {
            provider: 'AGROPROMBANK',
            invoiceId: payment.invoiceId,
            operationId,
            amount: payment.amountCents,
            tipAmount: payment.tipCents,
            compositeStatus,
            rrn: primary ? text(primary, 'rrn') : null,
            authCode: primary ? text(primary, 'authcode') : null,
          } satisfies Prisma.InputJsonValue,
        },
      });
    }

    return updated;
  }

  private async markPaymentFailed(payment: Payment, err: AgroprombankError): Promise<Payment> {
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        rawJson: { errorCode: err.code, error: err.description } satisfies Prisma.InputJsonValue,
      },
    });
    await this.prisma.orderEvent.create({
      data: {
        orderId: payment.orderId,
        type: 'PAYMENT_FAILED',
        payload: {
          provider: 'AGROPROMBANK',
          invoiceId: payment.invoiceId,
          errorCode: err.code,
          reason: err.description,
        } satisfies Prisma.InputJsonValue,
      },
    });
    return updated;
  }

  /**
   * Allocates the merchant-side operation id and its Payment row.
   *
   * `invoiceid` must stay unique for the entire life of the merchant contract,
   * so the value is timestamp + random and the DB's unique index is the actual
   * guarantee — we retry rather than trust the generator.
   */
  private async createPendingPayment(
    orderId: string,
    data: { amountCents: number; tipCents: number; currency: Currency; cardTokenId: string },
  ): Promise<Payment & { invoiceId: string }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invoiceId = `${this.config.invoicePrefix}${Date.now()}${randomInt(1000, 9999)}`;
      try {
        const payment = await this.prisma.payment.create({
          data: {
            orderId,
            provider: 'AGROPROMBANK',
            status: 'PENDING',
            invoiceId,
            amountCents: data.amountCents,
            tipCents: data.tipCents,
            currency: data.currency,
            cardTokenId: data.cardTokenId,
          },
        });
        return payment as Payment & { invoiceId: string };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new ConflictException('Could not allocate a unique invoice id');
  }

  /** Stores a freshly issued token, encrypted, and makes it the default if it is the first. */
  private async persistToken(
    userId: string,
    token: string,
    options: { institute: string; label?: string; deactivateOld: boolean },
  ): Promise<CardToken> {
    const fingerprint = fingerprintOf(token);

    if (options.deactivateOld) {
      // The bank already dropped the customer's other tokens; mirror that
      // locally so we never charge a card the bank no longer honours.
      await this.prisma.cardToken.updateMany({
        where: { userId, provider: 'AGROPROMBANK', status: 'ACTIVE' },
        data: { status: 'DEACTIVATED', isDefault: false, deactivatedAt: new Date() },
      });
    }

    const activeCount = await this.prisma.cardToken.count({
      where: { userId, provider: 'AGROPROMBANK', status: 'ACTIVE' },
    });

    // Re-binding the same card returns the same token; revive the row instead
    // of tripping the unique index.
    return this.prisma.cardToken.upsert({
      where: { userId_tokenFingerprint: { userId, tokenFingerprint: fingerprint } },
      create: {
        userId,
        provider: 'AGROPROMBANK',
        tokenCipher: this.cipher.encrypt(token),
        tokenFingerprint: fingerprint,
        institute: options.institute,
        label: options.label?.trim() || null,
        isDefault: activeCount === 0,
      },
      update: {
        tokenCipher: this.cipher.encrypt(token),
        institute: options.institute,
        label: options.label?.trim() || undefined,
        status: 'ACTIVE',
        deactivatedAt: null,
      },
    });
  }

  private async applyCheckTokenResponse(card: CardToken, response: XmlElement): Promise<CardToken> {
    const cardState = num(response, 'cardstate');
    const revoked = cardState !== null && cardState < 0;
    return this.prisma.cardToken.update({
      where: { id: card.id },
      data: {
        maskedPan: text(response, 'pan')?.trim() ?? card.maskedPan,
        embossing: text(response, 'embossing')?.trim() ?? card.embossing,
        cardState,
        status: revoked ? 'REVOKED' : card.status,
        isDefault: revoked ? false : card.isDefault,
        lastCheckedAt: new Date(),
      },
    });
  }

  /** CheckToken that never throws — used where a failure must not undo a binding. */
  private async refreshCardSafely(card: CardToken): Promise<CardToken> {
    try {
      return await this.applyCheckTokenResponse(
        card,
        await this.client.invoke('CheckToken', { token: this.revealToken(card) }),
      );
    } catch (err) {
      this.logger.warn(`CheckToken failed for card=${card.id}: ${messageOf(err)}`);
      return card;
    }
  }

  private async requireCard(userId: string, cardId: string): Promise<CardToken> {
    const card = await this.prisma.cardToken.findUnique({ where: { id: cardId } });
    if (!card || card.userId !== userId || card.provider !== 'AGROPROMBANK') {
      throw new NotFoundException('Card not found');
    }
    if (card.status === 'DEACTIVATED') throw new BadRequestException('This card has been unbound');
    return card;
  }

  private async requirePayment(paymentId: string): Promise<Payment & { invoiceId: string }> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.provider !== 'AGROPROMBANK') throw new NotFoundException('Payment not found');
    if (!payment.invoiceId) throw new BadRequestException('Payment has no bank invoice id');
    return payment as Payment & { invoiceId: string };
  }

  /** Picks a new default after the current one is unbound. */
  private async promoteDefaultCard(userId: string): Promise<void> {
    const existing = await this.prisma.cardToken.findFirst({
      where: { userId, provider: 'AGROPROMBANK', status: 'ACTIVE', isDefault: true },
    });
    if (existing) return;
    const candidate = await this.prisma.cardToken.findFirst({
      where: { userId, provider: 'AGROPROMBANK', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (candidate) {
      await this.prisma.cardToken.update({ where: { id: candidate.id }, data: { isDefault: true } });
    }
  }

  private revealToken(card: CardToken): string {
    try {
      return this.cipher.decrypt(card.tokenCipher);
    } catch (err) {
      this.logger.error(`Could not decrypt token for card=${card.id}: ${messageOf(err)}`);
      throw new ServiceUnavailableException('Stored card credentials are unreadable on this deployment');
    }
  }

  private toCardView(card: CardToken): BoundCardView {
    return {
      id: card.id,
      maskedPan: card.maskedPan,
      embossing: card.embossing,
      institute: card.institute,
      instituteName: CARD_INSTITUTES.find((i) => i.code === card.institute)?.name ?? null,
      label: card.label,
      isDefault: card.isDefault,
      cardState: card.cardState,
      createdAt: card.createdAt.toISOString(),
      lastUsedAt: card.lastUsedAt?.toISOString() ?? null,
    };
  }

  private toChargeResult(payment: Payment): ChargeResult {
    const raw = (payment.rawJson ?? {}) as Record<string, unknown>;
    const trx = Array.isArray(raw['trx']) ? (raw['trx'][0] as Record<string, unknown> | undefined) : undefined;
    const single = !Array.isArray(raw['trx']) ? (raw['trx'] as Record<string, unknown> | undefined) : undefined;
    const primary = trx ?? single;
    return {
      paymentId: payment.id,
      status: payment.status,
      operationId: payment.providerRef,
      invoiceId: payment.invoiceId ?? '',
      amountCents: payment.amountCents,
      tipCents: payment.tipCents,
      compositeStatus: typeof raw['cos'] === 'string' ? Number(raw['cos']) : null,
      authCode: typeof primary?.['authcode'] === 'string' ? primary['authcode'] : null,
      rrn: typeof primary?.['rrn'] === 'string' ? primary['rrn'] : null,
    };
  }

  private toHttpException(err: unknown): Error {
    if (err instanceof AgroprombankError) return new BadRequestException(err.description || err.message);
    if (err instanceof AgroprombankTransportError) return new BadGatewayException('The bank gateway is unavailable');
    return err instanceof Error ? err : new BadGatewayException('Unexpected bank error');
  }
}

function fingerprintOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
