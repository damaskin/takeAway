import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Payment, PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { BANK_CURRENCY_CODES } from '../agroprombank/constants';
import { PaymentHoldsService } from '../agroprombank/payment-holds.service';
import { CARD_PROVIDERS } from '../card-providers';
import { OrderSettlementService } from '../order-settlement.service';
import { AgroprombankWebClient, AgroprombankWebError, AgroprombankWebTransportError } from './agroprombank-web.client';
import { AgroprombankWebConfig } from './agroprombank-web.config';
import { type ReturnTarget, WEB_STATE } from './constants';
import { type OperationState, bankDay, paymentDescription } from './protocol';

/** A pending invoice is given up on this long after the bank's page stops taking it. */
const ABANDON_GRACE_MS = 5 * 60_000;

export interface PaymentPageView {
  /** `POST` the fields to `action` from a form, or open `url` — the same request as a GET. */
  method: 'POST';
  action: string;
  fields: Record<string, string>;
  url: string;
}

export interface StartWebPaymentResult {
  paymentId: string;
  invoiceId: string;
  status: PaymentStatus;
  /** Where to send the customer; `null` when the order is already paid for. */
  page: PaymentPageView | null;
  /** When the bank's page stops accepting this invoice. */
  expiresAt: string | null;
}

export interface WebPaymentView {
  paymentId: string;
  orderId: string;
  status: PaymentStatus;
  invoiceId: string;
  amountCents: number;
  refundedCents: number;
  rrn: string | null;
  lastDigits: string | null;
}

/**
 * ЗАО «Агропромбанк» «Web-платёж»: the customer types their card into the
 * bank's own page, the bank tells us the result.
 *
 * The bank's scheme, which this class follows to the letter: a notification
 * (ResultURL) or the customer coming back (SuccessURL / FailURL) is only a
 * hint. Whatever it says, the payment's state is taken from the admin web
 * service's GetState, whose answer the bank signs — a forged callback can
 * at most make us ask the bank.
 *
 * With `AGROPROMBANK_WEB_HOLD_UNTIL_ACCEPTED` (on by default) the page runs
 * with `ispreauth=1`: the money is blocked at checkout, the payment sits in
 * `REQUIRES_ACTION`, and the kitchen accepting the order captures it with
 * ComplitionOperation. A cancel, a rejection or an expiry releases it with
 * CancelOperation through {@link PaymentHoldsService}.
 *
 * Money-safety rules:
 *  - the `nivid` is allocated before the customer leaves, from the same
 *    sequence as the bound-card flow, and never reused;
 *  - a state change is claimed with a conditional update, so a callback and a
 *    redirect arriving together settle the order once;
 *  - money that arrives for an order that can no longer use it — cancelled,
 *    expired, or already paid by another invoice — is given straight back.
 */
@Injectable()
export class AgroprombankWebService {
  private readonly logger = new Logger(AgroprombankWebService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AgroprombankWebConfig,
    private readonly client: AgroprombankWebClient,
    private readonly settlement: OrderSettlementService,
    private readonly holds: PaymentHoldsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Checkout
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Opens a bank page for an order. Idempotent per order: an order already
   * held or paid for gets no new page, and an earlier invoice is checked with
   * the bank first — if the customer paid it in another tab, that is the
   * payment, and nothing new is issued.
   *
   * Every call that does need a page issues a fresh invoice. Re-presenting an
   * invoice the bank has already opened is not something the documentation
   * promises to allow; a second invoice is always safe, because a payment for
   * an order already paid for is cancelled on arrival.
   */
  async startPayment(
    userId: string,
    input: { orderId: string; returnTo: ReturnTarget },
  ): Promise<StartWebPaymentResult> {
    this.assertEnabled();

    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');

    const settled = await this.findActive(order.id);
    if (settled) return this.toStartResult(settled, null);

    const pending = await this.prisma.payment.findMany({
      where: { orderId: order.id, provider: 'AGROPROMBANK_WEB', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    for (const earlier of pending) {
      let resolved: Payment;
      try {
        resolved = await this.reconcilePayment(earlier);
      } catch (err) {
        // The bank cannot tell us whether the earlier invoice was paid. A new
        // one now could take the money twice.
        this.logger.warn(`Could not check invoice ${earlier.invoiceId} for order=${order.id}: ${messageOf(err)}`);
        throw new BadGatewayException('A previous payment for this order is still being verified');
      }
      if (resolved.status === 'REQUIRES_ACTION' || resolved.status === 'SUCCEEDED') {
        return this.toStartResult(resolved, null);
      }
    }

    if (order.status !== 'CREATED') {
      throw new BadRequestException(`Cannot start payment for an order in status ${order.status}`);
    }
    if (order.totalCents <= 0) throw new BadRequestException('Nothing to pay for this order');

    const currencyCode = BANK_CURRENCY_CODES[order.currency];
    if (!currencyCode) throw new BadRequestException(`Agroprombank does not settle in ${order.currency}`);

    const preauth = this.config.holdUntilAccepted;
    const expiresAt = new Date(Date.now() + this.config.lifetimeMinutes * 60_000);
    const payment = await this.createPendingPayment(order.id, {
      amountCents: order.totalCents,
      currency: order.currency,
      raw: {
        requestedPreauth: preauth,
        returnTo: input.returnTo,
        currencyCode,
        expiresAt: expiresAt.toISOString(),
      },
    });

    const page = this.client.paymentPage({
      nivid: payment.invoiceId,
      sum: order.totalCents,
      currencyCode,
      description: paymentDescription(order.orderCode),
      preauth,
    });
    this.logger.log(
      `Opened Web-платёж invoice=${payment.invoiceId} for order=${order.id} (${preauth ? 'hold' : 'charge'})`,
    );
    return this.toStartResult(payment, { method: 'POST', ...page }, expiresAt);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bank → us
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * ResultURL: the bank's notification about one invoice.
   *
   * The signature and the amount are checked first, so a forged or tampered
   * notification is turned away before it costs a call to the bank; then the
   * outcome is taken from GetState and only from there. Idempotent — the
   * same notification twice, or after the customer's redirect already
   * reconciled the payment, changes nothing.
   *
   * Returns `false` for a notification that did not verify.
   */
  async handleNotification(params: Record<string, string>): Promise<boolean> {
    const invoiceId = params['invoiceid'];
    if (!invoiceId) {
      this.logger.warn('Web-платёж notification without invoiceid ignored');
      return false;
    }
    if (!this.client.verifyNotification(params)) {
      this.logger.error(`Web-платёж notification for invoice=${invoiceId} failed the signature check`);
      return false;
    }

    const payment = await this.findByInvoice(invoiceId);
    if (!payment) {
      this.logger.warn(`Web-платёж notification for unknown invoice=${invoiceId}`);
      return true;
    }

    if (params['status'] === 'paid') {
      const expectedCurrency = rawOf(payment)['currencyCode'];
      const sum = Number(params['paymentsum']);
      if (
        sum !== payment.amountCents ||
        (typeof expectedCurrency === 'string' && params['paymentcurrency'] !== expectedCurrency)
      ) {
        // GetState below has the last word; this is for the logs, because a
        // mismatch here means someone edited the request on the way.
        this.logger.error(
          `Web-платёж invoice=${invoiceId}: notified ${params['paymentsum']} ${params['paymentcurrency']}, ` +
            `expected ${payment.amountCents} ${String(expectedCurrency)}`,
        );
      }
    }

    try {
      await this.reconcilePayment(payment);
    } catch (err) {
      // The bank's own word is what counts and it did not answer. The cron
      // asks again; the notification has done its job.
      this.logger.warn(`Could not confirm invoice=${invoiceId} with the bank: ${messageOf(err)}`);
    }
    return true;
  }

  /**
   * SuccessURL / FailURL: the customer is coming back from the bank's page.
   * Nothing the redirect says is trusted — the payment is reconciled with
   * the bank, and the customer goes to their order, which shows the result.
   * Never throws: a customer must always land somewhere.
   */
  async handleReturn(outcome: 'success' | 'fail', params: Record<string, string>): Promise<string> {
    const invoiceId = params['invoiceid'];
    const payment = invoiceId ? await this.findByInvoice(invoiceId).catch(() => null) : null;
    if (!payment) {
      return this.config.returnBase('web') ?? '/';
    }

    let current = payment;
    if (payment.status === 'PENDING') {
      try {
        current = await this.reconcilePayment(payment);
      } catch (err) {
        this.logger.warn(`Could not reconcile invoice=${invoiceId} on the customer's return: ${messageOf(err)}`);
      }
    }
    const paid = current.status === 'REQUIRES_ACTION' || current.status === 'SUCCEEDED';
    return this.returnUrl(current, paid ? 'success' : outcome === 'success' ? 'pending' : 'fail');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Money after checkout
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Captures a held payment — the kitchen accepted the order. The held
   * amount is captured as held, never the order's current total: the
   * customer agreed to the figure they saw at checkout.
   */
  async complete(paymentId: string, amountCents: number): Promise<WebPaymentView> {
    this.assertEnabled();
    const payment = await this.requirePayment(paymentId);
    if (payment.status !== 'REQUIRES_ACTION') {
      throw new BadRequestException('Only a held payment can be captured');
    }
    const ceiling = Math.floor(payment.amountCents * 1.1);
    if (amountCents <= 0 || amountCents > ceiling) {
      throw new BadRequestException(`Amount must be between 1 and ${ceiling} (110% of the held amount)`);
    }

    try {
      await this.client.complete(payment.invoiceId, amountCents);
    } catch (err) {
      throw this.toHttpException(err);
    }

    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'REQUIRES_ACTION' },
      data: {
        status: 'SUCCEEDED',
        amountCents,
        rawJson: { ...rawOf(payment), capturedAt: new Date().toISOString(), capturedAmount: amountCents },
      },
    });
    if (claimed.count > 0) {
      await this.settlement.settlePaidOrder(payment.orderId, {
        event: {
          type: 'PAYMENT_SUCCEEDED',
          payload: {
            provider: 'AGROPROMBANK_WEB',
            invoiceId: payment.invoiceId,
            amount: amountCents,
            rrn: payment.providerRef,
            preauthCompleted: true,
          } satisfies Prisma.InputJsonValue,
        },
      });
    }
    return this.toView(await this.requirePayment(paymentId));
  }

  /**
   * Cancels an operation outright (CancelOperation) — a hold, or a charge on
   * the day it was made. Irreversible.
   */
  async cancel(paymentId: string, audit: { actorId?: string; reason?: string } = {}): Promise<WebPaymentView> {
    this.assertEnabled();
    const payment = await this.requirePayment(paymentId);
    if (payment.status === 'REFUNDED') throw new ConflictException('This payment has already been given back');
    if (payment.status !== 'REQUIRES_ACTION' && payment.status !== 'SUCCEEDED') {
      throw new BadRequestException(`Cannot cancel a payment in status ${payment.status}`);
    }
    try {
      await this.client.cancel(payment.invoiceId);
    } catch (err) {
      throw this.toHttpException(err);
    }
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedCents: payment.amountCents },
    });
    await this.recordRefund(payment, payment.amountCents, 'cancellation', audit);
    return this.toView(updated);
  }

  /**
   * Full or partial refund of a captured payment. A full refund on the day of
   * payment goes as CancelOperation first — the operation simply disappears
   * from the customer's statement — and falls back to RefundOperation when
   * the bank will not cancel.
   */
  async refund(
    paymentId: string,
    refundCents: number,
    audit: { actorId?: string; reason?: string | null; note?: string | null; source?: string } = {},
  ): Promise<WebPaymentView> {
    this.assertEnabled();
    const payment = await this.requirePayment(paymentId);
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new BadRequestException(`Cannot refund a payment in status ${payment.status}`);
    }
    const remaining = payment.amountCents - payment.refundedCents;
    if (!Number.isInteger(refundCents) || refundCents <= 0 || refundCents > remaining) {
      throw new BadRequestException(`Refund must be between 1 and ${remaining}`);
    }

    let kind: 'cancellation' | 'refund' = 'refund';
    const fullAndSameDay =
      payment.refundedCents === 0 &&
      refundCents === payment.amountCents &&
      bankDay(paidAt(payment)) === bankDay(new Date());
    try {
      if (fullAndSameDay) {
        try {
          await this.client.cancel(payment.invoiceId);
          kind = 'cancellation';
        } catch (err) {
          if (!(err instanceof AgroprombankWebError)) throw err;
          this.logger.warn(`CancelOperation refused for invoice=${payment.invoiceId}, refunding: ${err.description}`);
          await this.client.refund(payment.invoiceId, refundCents);
        }
      } else {
        await this.client.refund(payment.invoiceId, refundCents);
      }
    } catch (err) {
      throw this.toHttpException(err);
    }

    const refundedCents = payment.refundedCents + refundCents;
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { refundedCents, status: refundedCents >= payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });
    await this.recordRefund(payment, refundCents, kind, audit);
    return this.toView(updated);
  }

  /** The bank's own record of the operation — support and disputes. */
  async describe(paymentId: string): Promise<OperationState> {
    this.assertEnabled();
    const payment = await this.requirePayment(paymentId);
    try {
      return await this.client.getState(payment.invoiceId);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reconciliation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Pending invoices whose outcome we have not heard: the notification got
   * lost, the customer closed the tab. Asked of the bank until it answers,
   * and given up once the page has stopped taking the invoice.
   */
  async reconcilePendingPayments(olderThanMs = 2 * 60_000, limit = 50): Promise<{ checked: number; settled: number }> {
    if (!this.config.isConfigured) return { checked: 0, settled: 0 };
    const pending = await this.prisma.payment.findMany({
      where: {
        provider: 'AGROPROMBANK_WEB',
        status: 'PENDING',
        invoiceId: { not: null },
        createdAt: { lt: new Date(Date.now() - olderThanMs) },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let settled = 0;
    for (const payment of pending) {
      try {
        const resolved = await this.reconcilePayment(payment);
        if (resolved.status === 'REQUIRES_ACTION' || resolved.status === 'SUCCEEDED') settled += 1;
      } catch (err) {
        this.logger.warn(`Reconciliation failed for invoice=${payment.invoiceId}: ${messageOf(err)}`);
      }
    }
    return { checked: pending.length, settled };
  }

  /**
   * Asks the bank about one invoice and brings our row in line. A bank error
   * means it has no such invoice — the customer never reached the page — which
   * reads the same as "not paid yet". Throws only when the bank is unreachable.
   */
  async reconcilePayment(payment: Payment): Promise<Payment> {
    if (!payment.invoiceId) return payment;
    let state: OperationState | null;
    try {
      state = await this.client.getState(payment.invoiceId);
    } catch (err) {
      if (!(err instanceof AgroprombankWebError)) throw err;
      state = null;
    }
    return this.applyState(payment, state);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private async applyState(payment: Payment, state: OperationState | null): Promise<Payment> {
    const code = state?.state ?? WEB_STATE.NOT_PAID;

    if (code === WEB_STATE.PAID && state) return this.applyPaid(payment, state);

    if (code === WEB_STATE.NOT_PAID) {
      if (payment.status === 'PENDING' && Date.now() > invoiceExpiry(payment).getTime() + ABANDON_GRACE_MS) {
        return this.markFailed(payment, 'abandoned', state?.stateDescription ?? 'The invoice was never paid');
      }
      return payment;
    }

    // Cancelled, error, expired.
    if (payment.status === 'PENDING') {
      return this.markFailed(payment, `state-${code}`, state?.stateDescription ?? `Bank state ${code}`);
    }
    if (payment.status === 'REQUIRES_ACTION' && code === WEB_STATE.CANCELLED) {
      // Released at the bank — by us in a call whose answer we lost, or by
      // the bank itself. Either way the customer has their money back.
      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED', refundedCents: payment.amountCents },
      });
      await this.recordRefund(payment, payment.amountCents, 'hold-released', { reason: 'bank-cancelled' });
      return updated;
    }
    return payment;
  }

  private async applyPaid(payment: Payment, state: OperationState): Promise<Payment> {
    if (payment.status !== 'PENDING' && payment.status !== 'FAILED') return payment;

    const held = state.usePreauth ?? requestedPreauth(payment);
    const status: PaymentStatus = held ? 'REQUIRES_ACTION' : 'SUCCEEDED';
    const amountMismatch = state.sum !== null && state.sum !== payment.amountCents;
    const raw = {
      ...rawOf(payment),
      bankState: state.state,
      rrn: state.rrn,
      lastdgt: state.lastDigits,
      pan: state.pan,
      authcode: state.authCode,
      paidSum: state.sum,
      usepreauth: state.usePreauth,
      paidAt: new Date().toISOString(),
    } satisfies Record<string, Prisma.InputJsonValue | null>;

    // Claimed conditionally: the notification and the customer's return can
    // land in the same second, and the order must be settled exactly once.
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: { status, providerRef: state.rrn ?? payment.providerRef, rawJson: raw },
    });
    const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (claimed.count === 0) return updated;

    const order = await this.prisma.order.findUnique({ where: { id: payment.orderId } });
    const other = await this.prisma.payment.findFirst({
      where: {
        orderId: payment.orderId,
        id: { not: payment.id },
        provider: { in: [...CARD_PROVIDERS] },
        status: { in: ['REQUIRES_ACTION', 'SUCCEEDED'] },
      },
      select: { id: true },
    });

    if (!order || order.status !== 'CREATED' || other || amountMismatch) {
      const why = amountMismatch
        ? `the bank took ${state.sum} instead of ${payment.amountCents}`
        : other
          ? 'the order is already paid for'
          : `the order is ${order?.status ?? 'gone'}`;
      this.logger.error(`Web-платёж invoice=${payment.invoiceId} paid but unusable (${why}) — giving the money back`);
      return this.giveBack(updated, why);
    }

    if (status === 'REQUIRES_ACTION') {
      await this.settlement.announceHeld(payment.orderId);
    } else {
      await this.settlement.settlePaidOrder(payment.orderId, {
        event: {
          type: 'PAYMENT_SUCCEEDED',
          payload: {
            provider: 'AGROPROMBANK_WEB',
            invoiceId: payment.invoiceId,
            amount: payment.amountCents,
            rrn: state.rrn,
            authCode: state.authCode,
          } satisfies Prisma.InputJsonValue,
        },
      });
    }
    return updated;
  }

  /**
   * Money arrived for an order that cannot use it. A hold is released like
   * any other — and retried by the cron if the bank refuses now. A capture is
   * cancelled the same day; failing that, it is left for ops to refund, loudly.
   */
  private async giveBack(payment: Payment, why: string): Promise<Payment> {
    if (payment.status === 'REQUIRES_ACTION') {
      const flagged = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { rawJson: { ...rawOf(payment), releaseRequired: true, releaseReason: why } },
      });
      return (await this.holds.release(flagged, 'unusable-payment')) ?? flagged;
    }
    try {
      await this.client.cancel(payment.invoiceId as string);
    } catch (err) {
      this.logger.error(
        `REFUND NEEDED: invoice=${payment.invoiceId} order=${payment.orderId} was charged (${why}) ` +
          `and CancelOperation failed: ${messageOf(err)}. Refund it from the admin.`,
      );
      return payment;
    }
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedCents: payment.amountCents },
    });
    await this.recordRefund(payment, payment.amountCents, 'cancellation', { reason: why });
    return updated;
  }

  private async markFailed(payment: Payment, code: string, reason: string): Promise<Payment> {
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'FAILED', rawJson: { ...rawOf(payment), failure: code, failureReason: reason } },
    });
    if (claimed.count > 0) {
      await this.prisma.orderEvent.create({
        data: {
          orderId: payment.orderId,
          type: 'PAYMENT_FAILED',
          payload: {
            provider: 'AGROPROMBANK_WEB',
            invoiceId: payment.invoiceId,
            errorCode: code,
            reason,
          } satisfies Prisma.InputJsonValue,
        },
      });
    }
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  private async recordRefund(
    payment: Payment,
    amount: number,
    kind: 'cancellation' | 'refund' | 'hold-released',
    audit: { actorId?: string; reason?: string | null; note?: string | null; source?: string },
  ): Promise<void> {
    await this.prisma.orderEvent.create({
      data: {
        orderId: payment.orderId,
        type: 'REFUND_ISSUED',
        ...(audit.actorId ? { actorId: audit.actorId } : {}),
        payload: {
          provider: 'AGROPROMBANK_WEB',
          invoiceId: payment.invoiceId,
          amount,
          kind,
          reason: audit.reason ?? null,
          note: audit.note ?? null,
          source: audit.source ?? null,
        } satisfies Prisma.InputJsonValue,
      },
    });
  }

  private findActive(orderId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { orderId, provider: { in: [...CARD_PROVIDERS] }, status: { in: ['REQUIRES_ACTION', 'SUCCEEDED'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findByInvoice(invoiceId: string): Promise<Payment | null> {
    const payment = await this.prisma.payment.findUnique({ where: { invoiceId } });
    return payment?.provider === 'AGROPROMBANK_WEB' ? payment : null;
  }

  /** Same numbering as the bound-card flow — see AgroprombankService.createPendingPayment. */
  private async createPendingPayment(
    orderId: string,
    data: { amountCents: number; currency: Payment['currency']; raw: Record<string, Prisma.InputJsonValue> },
  ): Promise<Payment & { invoiceId: string }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invoiceId = `${this.config.invoicePrefix}${await this.nextInvoiceNumber()}`;
      try {
        const payment = await this.prisma.payment.create({
          data: {
            orderId,
            provider: 'AGROPROMBANK_WEB',
            status: 'PENDING',
            invoiceId,
            amountCents: data.amountCents,
            currency: data.currency,
            rawJson: data.raw,
          },
        });
        return payment as Payment & { invoiceId: string };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new ConflictException('Could not allocate a unique invoice id');
  }

  private async nextInvoiceNumber(): Promise<string> {
    const rows = await this.prisma.$queryRaw<
      Array<{ value: bigint }>
    >`SELECT nextval('agroprombank_invoice_seq') AS value`;
    const value = rows[0]?.value;
    if (value === undefined) throw new Error('agroprombank_invoice_seq returned no value');
    return value.toString();
  }

  private async requirePayment(paymentId: string): Promise<Payment & { invoiceId: string }> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.provider !== 'AGROPROMBANK_WEB') throw new NotFoundException('Payment not found');
    if (!payment.invoiceId) throw new BadRequestException('Payment has no bank invoice id');
    return payment as Payment & { invoiceId: string };
  }

  /**
   * Where the customer goes after the bank: their order, in the client they
   * paid from. Built from configuration and our own ids only — nothing from
   * the redirect — so it cannot be turned into an open redirect.
   */
  private returnUrl(payment: Payment, outcome: 'success' | 'pending' | 'fail'): string {
    const raw = rawOf(payment);
    const target: ReturnTarget = raw['returnTo'] === 'tma' || raw['returnTo'] === 'mobile' ? raw['returnTo'] : 'web';
    const base = this.config.returnBase(target) ?? this.config.returnBase('web');
    const orderId = encodeURIComponent(payment.orderId);
    if (!base) return '/';

    if (target === 'mobile') {
      const separator = base.includes('?') ? '&' : '?';
      return `${base}${separator}orderId=${orderId}&status=${outcome}`;
    }
    if (target === 'tma' && /(^|\/\/)t\.me\//i.test(base)) {
      // A t.me link reopens the mini app inside Telegram; the start parameter
      // carries the order (letters, digits, `_` and `-` only).
      const separator = base.includes('?') ? '&' : '?';
      return `${base}${separator}startapp=order_${orderId}`;
    }
    return `${base.replace(/\/$/, '')}/orders/${orderId}?payment=${outcome}`;
  }

  private toStartResult(
    payment: Payment,
    page: PaymentPageView | null,
    expiresAt: Date | null = null,
  ): StartWebPaymentResult {
    return {
      paymentId: payment.id,
      invoiceId: payment.invoiceId ?? '',
      status: payment.status,
      page,
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  }

  private toView(payment: Payment): WebPaymentView {
    const raw = rawOf(payment);
    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      status: payment.status,
      invoiceId: payment.invoiceId ?? '',
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      rrn: typeof raw['rrn'] === 'string' ? raw['rrn'] : null,
      lastDigits: typeof raw['lastdgt'] === 'string' ? raw['lastdgt'] : null,
    };
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Web-платёж is disabled on this deployment');
    }
    const missing = this.config.missingSettings();
    if (missing.length > 0) {
      throw new ServiceUnavailableException(`Web-платёж is not configured: missing ${missing.join(', ')}`);
    }
  }

  private toHttpException(err: unknown): Error {
    if (err instanceof AgroprombankWebError) return new BadRequestException(err.description || err.message);
    if (err instanceof AgroprombankWebTransportError) return new BadGatewayException('The bank did not answer');
    return err instanceof Error ? err : new BadGatewayException('Unexpected bank error');
  }
}

function rawOf(payment: Payment): Record<string, Prisma.InputJsonValue> {
  const raw = payment.rawJson;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Prisma.InputJsonValue>) : {};
}

function requestedPreauth(payment: Payment): boolean {
  return rawOf(payment)['requestedPreauth'] === true;
}

function invoiceExpiry(payment: Payment): Date {
  const raw = rawOf(payment)['expiresAt'];
  const parsed = typeof raw === 'string' ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : payment.createdAt;
}

function paidAt(payment: Payment): Date {
  const raw = rawOf(payment)['paidAt'];
  const parsed = typeof raw === 'string' ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : payment.updatedAt;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
