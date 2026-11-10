import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Order, Payment, Prisma } from '@prisma/client';
import type {
  AgroprombankQrErrorBody,
  AgroprombankQrErrorCode,
  AgroprombankQrPaymentDto,
  AgroprombankQrPaymentStatus,
} from '@takeaway/shared-types';

import { PrismaService } from '../../prisma/prisma.service';
import { withFreshInvoiceId } from '../agroprombank/invoice-ids';
import { PaymentHoldsService } from '../agroprombank/payment-holds.service';
import { CARD_PROVIDERS } from '../card-providers';
import { OrderSettlementService } from '../order-settlement.service';
import {
  AgroprombankQrClient,
  AgroprombankQrError,
  AgroprombankQrTransportError,
  type QrPaymentRefs,
} from './agroprombank-qr.client';
import { AgroprombankQrConfig } from './agroprombank-qr.config';
import { QR_CURRENCY, QR_CURRENCY_CODE, QR_STATE } from './constants';
import { type QrPaymentRecord, formatAppLink, formatQrCode, matchPaidAmount, parseQrPayments } from './protocol';
import { qrPaymentRefs } from './payment-refs';

/** The customer's screen polls every 3 s; the bank is asked no more often than that per payment. */
const STATUS_CHECK_INTERVAL_MS = 3_000;

/** An invoice nobody asks about is closed this long after it stopped being offered. */
export const QR_LAPSE_GRACE_MS = 2 * 60_000;

/** A CreatePaymentID that has not answered within its timeout plus this is over, one way or the other. */
const CREATE_SETTLE_MS = 5_000;

/** Back-office view of a QR payment. */
export interface QrPaymentAdminView {
  paymentId: string;
  orderId: string;
  status: Payment['status'];
  invoiceId: string;
  amountCents: number;
  refundedCents: number;
  qrPaymentId: string | null;
  rrn: string | null;
}

type RefundAudit = { actorId?: string; reason?: string | null; note?: string | null; source?: string };

/**
 * ЗАО «Агропромбанк» «Мобильный платёж»: we issue an invoice on our QR
 * terminal, the customer pays it from the bank's own app — by scanning the
 * code, or, on the phone itself, through a link that opens the app.
 *
 * There is no hold: a paid invoice is money taken. To keep the rule that the
 * kitchen only sees paid orders and an order it turns down costs the
 * customer nothing, a paid invoice is parked on the order like a card hold —
 * `REQUIRES_ACTION` until the kitchen accepts, which settles it with no bank
 * call; a cancel, a rejection or an expiry gives the money back with
 * `ReversePayment` through {@link PaymentHoldsService}.
 *
 * Money-safety rules:
 *  - the invoice's external id is allocated before the call, from the same
 *    sequence as every other flow, and never reused;
 *  - paid means `state = 2` in `GetPaymentStateExtId` and nothing else — the
 *    callback is not signed and is only a reason to ask;
 *  - every state change is claimed with a conditional update, so the
 *    callback, the customer's poll and the cron settle an order once;
 *  - money that arrives for an order that cannot use it — cancelled,
 *    expired, already paid, or not the invoiced sum — is given straight back;
 *  - a transport failure never marks anything failed.
 */
@Injectable()
export class AgroprombankQrService {
  private readonly logger = new Logger(AgroprombankQrService.name);
  /** When the bank was last asked about a payment on the customer's behalf. */
  private readonly lastChecked = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AgroprombankQrConfig,
    private readonly client: AgroprombankQrClient,
    private readonly settlement: OrderSettlementService,
    private readonly holds: PaymentHoldsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Customer
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * An invoice to pay an order by QR. Idempotent per order: an order already
   * paid answers its payment; an invoice still on offer is checked with the
   * bank and answered again, same code — a reload never issues a second one.
   * A lapsed invoice is closed and checked once more, so money that landed in
   * its last second is not lost, before a new one is issued.
   */
  async startPayment(userId: string, orderId: string): Promise<AgroprombankQrPaymentDto> {
    this.assertOffered();

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (order.currency !== QR_CURRENCY) {
      throw qrError(409, 'QR_CURRENCY_UNSUPPORTED', `The QR payment takes ${QR_CURRENCY} only`);
    }

    const paid = await this.findPaid(order.id);
    if (paid) return this.toDto(paid);

    const pending = await this.prisma.payment.findMany({
      where: { orderId: order.id, provider: 'AGROPROMBANK_QR', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    for (const earlier of pending) {
      const current = await this.askingTheBank(earlier, async () => {
        const checked = await this.reconcile(earlier, 0);
        if (checked.status !== 'PENDING' || this.stillOffered(checked, order)) return checked;
        // The order cannot use it any more, or its total moved: off the table.
        return this.closeInvoice(checked, order.status === 'CREATED' ? 'superseded' : 'order-closed');
      });
      if (current.status === 'PENDING' || isHeldOrPaid(current)) return this.toDto(current);
    }

    if (order.status !== 'CREATED') {
      throw qrError(409, 'ORDER_NOT_PAYABLE', `The order is ${order.status} and cannot be paid`);
    }
    if (order.totalCents <= 0) throw qrError(409, 'ORDER_NOT_PAYABLE', 'Nothing to pay for this order');

    return this.toDto(await this.issueInvoice(order));
  }

  /**
   * The payment as it stands. While it waits to be paid the bank is asked —
   * at most once every three seconds per payment, whatever the client polls —
   * and an invoice past its lifetime is closed.
   */
  async getPayment(userId: string, paymentId: string): Promise<AgroprombankQrPaymentDto> {
    const payment = await this.requireOwnPayment(userId, paymentId);
    if (payment.status !== 'PENDING' || !this.config.canCallBank || !this.dueForCheck(payment.id)) {
      return this.toDto(payment);
    }
    try {
      return this.toDto(await this.reconcile(payment, 0));
    } catch (err) {
      this.logger.warn(`Could not check QR invoice ${payment.invoiceId}: ${messageOf(err)}`);
      return this.toDto(payment);
    }
  }

  /**
   * The customer closed the QR screen: the invoice is closed at the bank and
   * checked once more. Unpaid, it reads `EXPIRED` and the order stays, to be
   * paid again by QR or by card.
   */
  async cancelPayment(userId: string, paymentId: string): Promise<AgroprombankQrPaymentDto> {
    const payment = await this.requireOwnPayment(userId, paymentId);
    if (payment.status !== 'PENDING') return this.toDto(payment);
    const closed = await this.askingTheBank(payment, () => this.closeInvoice(payment, 'cancelled-by-customer'));
    return this.toDto(closed);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bank → us
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The callback the bank sends when an invoice is paid: `payments`, the
   * `Payments` XML, and `trx`, the card transaction. It is not signed, so
   * nothing in it is believed — every invoice it names is checked with
   * `GetPaymentStateExtId`, as the status poll does. Never throws: a bad body
   * or a bank that is down is a log line, and the cron asks again.
   */
  async handleCallback(fields: { payments: string | null; trx: string | null }): Promise<void> {
    let records: QrPaymentRecord[];
    try {
      records = parseQrPayments('callback', fields.payments);
    } catch (err) {
      this.logger.warn(`QR callback with unreadable payments: ${messageOf(err)}`);
      return;
    }
    if (records.length === 0) {
      this.logger.warn('QR callback named no payment');
      return;
    }
    if (!this.config.canCallBank) {
      this.logger.warn('QR callback arrived, but the QR payment is not configured — ignored');
      return;
    }

    for (const record of records) {
      const extid = record.externalId;
      if (!extid) {
        this.logger.warn(`QR callback for bank payment ${record.qrPaymentId ?? '?'} without an external id`);
        continue;
      }
      if (record.terminalId && record.terminalId !== this.config.terminalId) {
        this.logger.warn(`QR callback for extid=${extid} on terminal ${record.terminalId}, not ours — ignored`);
        continue;
      }
      const payment = await this.prisma.payment.findUnique({ where: { invoiceId: extid } });
      if (!payment || payment.provider !== 'AGROPROMBANK_QR') {
        this.logger.warn(`QR callback for unknown extid=${extid}`);
        continue;
      }
      // FAILED too: an invoice we closed may still have been paid in the bank's app.
      if (payment.status !== 'PENDING' && payment.status !== 'FAILED') continue;
      try {
        await this.reconcile(payment, QR_LAPSE_GRACE_MS);
      } catch (err) {
        this.logger.warn(`Could not confirm QR invoice extid=${extid} with the bank: ${messageOf(err)}`);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Money after payment
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The kitchen accepted the order: the money taken at payment is the
   * order's now. No bank call — the invoice was paid in full when the
   * customer paid it. Claimed conditionally, so a release that got there
   * first wins and the accept fails rather than settling money given back.
   */
  async settleOnAccept(paymentId: string): Promise<Payment> {
    const payment = await this.requirePayment(paymentId);
    if (payment.status !== 'REQUIRES_ACTION') {
      throw new BadRequestException(`Only a QR payment waiting for the kitchen can be settled (${payment.status})`);
    }
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'REQUIRES_ACTION' },
      data: { status: 'SUCCEEDED', rawJson: { ...rawOf(payment), settledAt: new Date().toISOString() } },
    });
    if (claimed.count === 0) throw new BadRequestException('The QR payment changed while the order was being accepted');

    const refs = qrPaymentRefs(payment);
    await this.settlement.settlePaidOrder(payment.orderId, {
      event: {
        type: 'PAYMENT_SUCCEEDED',
        payload: {
          provider: 'AGROPROMBANK_QR',
          invoiceId: payment.invoiceId,
          amount: payment.amountCents,
          qrPaymentId: refs.qrPaymentId,
          rrn: refs.rrn,
        } satisfies Prisma.InputJsonValue,
      },
      announced: true,
    });
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  /**
   * Back office: settle a QR payment by hand, as the kitchen's accept would.
   * The money was taken in full at payment, so there is no other amount to
   * settle for.
   */
  async complete(paymentId: string, amountCents: number): Promise<QrPaymentAdminView> {
    const payment = await this.requirePayment(paymentId);
    if (amountCents !== payment.amountCents) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'QR_PARTIAL_CAPTURE_UNSUPPORTED',
        message: `A QR payment was taken in full; it settles for exactly ${payment.amountCents}`,
      });
    }
    return this.toAdminView(await this.settleOnAccept(paymentId));
  }

  /**
   * Back office: gives a QR payment back with `ReversePayment` — waiting for
   * the kitchen or already settled. Irreversible.
   */
  async reverse(paymentId: string, audit: RefundAudit = {}): Promise<QrPaymentAdminView> {
    const payment = await this.requirePayment(paymentId);
    if (payment.status === 'REFUNDED') throw new ConflictException('This payment has already been given back');
    if (payment.status !== 'REQUIRES_ACTION' && payment.status !== 'SUCCEEDED') {
      throw new BadRequestException(`Cannot reverse a payment in status ${payment.status}`);
    }
    return this.toAdminView(await this.reverseNow(payment, audit));
  }

  /**
   * Back office: refund a settled QR payment. `ReversePayment` takes no
   * amount, so it is all or nothing; a partial refund is refused with
   * `QR_PARTIAL_REFUND_UNSUPPORTED`.
   */
  async refund(paymentId: string, refundCents: number, audit: RefundAudit = {}): Promise<QrPaymentAdminView> {
    const payment = await this.requirePayment(paymentId);
    if (payment.status !== 'SUCCEEDED') {
      throw new BadRequestException(`Cannot refund a payment in status ${payment.status}`);
    }
    if (refundCents !== payment.amountCents - payment.refundedCents) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'QR_PARTIAL_REFUND_UNSUPPORTED',
        message: `A QR payment can only be refunded in full (${payment.amountCents - payment.refundedCents})`,
      });
    }
    return this.toAdminView(await this.reverseNow(payment, audit));
  }

  /** The bank's own record of the invoice — support and disputes. */
  async describe(paymentId: string): Promise<QrPaymentRecord | null> {
    const payment = await this.requirePayment(paymentId);
    try {
      return await this.client.getPaymentStateExtId(payment.invoiceId);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reconciliation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Invoices nobody has told us about: the callback got lost, the customer
   * closed the app. Asked of the bank, closed once past their lifetime (plus
   * a grace) — or at once when their order can no longer be paid.
   */
  async reconcilePendingPayments(olderThanMs = 60_000, limit = 50): Promise<{ checked: number; settled: number }> {
    if (!this.config.canCallBank) return { checked: 0, settled: 0 };
    const pending = await this.prisma.payment.findMany({
      where: {
        provider: 'AGROPROMBANK_QR',
        status: 'PENDING',
        invoiceId: { not: null },
        createdAt: { lt: new Date(Date.now() - olderThanMs) },
      },
      include: { order: { select: { status: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let settled = 0;
    for (const payment of pending) {
      try {
        const resolved =
          payment.order.status === 'CREATED'
            ? await this.reconcile(payment, QR_LAPSE_GRACE_MS)
            : await this.closeInvoice(payment, 'order-closed');
        if (isHeldOrPaid(resolved)) settled += 1;
      } catch (err) {
        this.logger.warn(`Reconciliation failed for QR invoice ${payment.invoiceId}: ${messageOf(err)}`);
      }
    }
    return { checked: pending.length, settled };
  }

  /**
   * Asks the bank about one invoice and brings our row in line: paid → the
   * money goes on the order; still unpaid → nothing, until it is past its
   * lifetime plus `lapseGraceMs`, when it is closed. Throws only when the
   * bank could not be reached.
   */
  async reconcile(payment: Payment, lapseGraceMs: number): Promise<Payment> {
    if (!payment.invoiceId) return payment;
    const record = await this.readState(payment);
    if (record?.state === QR_STATE.PAID) return this.applyPaid(payment, record);
    if (payment.status !== 'PENDING') return payment;

    let current = payment;
    if (record?.qrPaymentId && !payment.providerRef) {
      // CreatePaymentID did not answer, but the bank has the invoice.
      current = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerRef: record.qrPaymentId },
      });
    }
    if (!record && !current.providerRef && Date.now() - current.createdAt.getTime() > this.createSettleMs()) {
      // CreatePaymentID never answered and the bank knows of no such invoice.
      // Closed anyway, in case the bank only lists invoices once they are paid.
      return this.closeInvoice(current, 'not-issued');
    }
    if (Date.now() > invoiceExpiry(current, this.config.lifetimeMinutes).getTime() + lapseGraceMs) {
      return this.closeInvoice(current, 'lapsed');
    }
    return current;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private async issueInvoice(order: Order): Promise<Payment> {
    const terminal = this.config.terminalId as string;
    const expiresAt = new Date(Date.now() + this.config.lifetimeMinutes * 60_000);
    const payment = await withFreshInvoiceId(this.prisma, this.config.invoicePrefix, (extid) =>
      this.prisma.payment.create({
        data: {
          orderId: order.id,
          provider: 'AGROPROMBANK_QR',
          status: 'PENDING',
          invoiceId: extid,
          amountCents: order.totalCents,
          currency: order.currency,
          rawJson: {
            terminalId: terminal,
            currencyCode: QR_CURRENCY_CODE,
            expiresAt: expiresAt.toISOString(),
            qrCode: formatQrCode(this.config.codeFormat, { terminal, amountKopecks: order.totalCents, extid }),
          } satisfies Prisma.InputJsonValue,
        },
      }),
    );
    const extid = payment.invoiceId as string;

    let bankId: string;
    try {
      bankId = await this.client.createPaymentId(extid, order.totalCents);
    } catch (err) {
      if (err instanceof AgroprombankQrError) {
        this.logger.warn(`CreatePaymentID refused extid=${extid} for order=${order.id}: ${err.description}`);
        return this.markFailed(payment, { failure: 'create-refused', failureReason: err.description });
      }
      // The invoice may or may not exist at the bank. The row stays PENDING:
      // the next start or the cron finds out, and closes it if need be.
      this.logger.warn(`CreatePaymentID for extid=${extid} order=${order.id} did not complete: ${messageOf(err)}`);
      throw qrError(503, 'QR_BANK_UNAVAILABLE', 'The bank could not be reached; try again');
    }

    this.logger.log(`Issued QR invoice extid=${extid} (bank id ${bankId}) for order=${order.id}, ${order.totalCents}`);
    return this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerRef: bankId, rawJson: { ...rawOf(payment), qrPaymentId: bankId } },
    });
  }

  /**
   * `ClosePaymentExtId`, then the state once more — a payment that landed in
   * the same second is still found. Unpaid, the row is closed as `FAILED`
   * with `rawJson.closed`, which reads `EXPIRED`. Throws when the bank could
   * not be reached for either call: the invoice may still be payable.
   */
  private async closeInvoice(payment: Payment, reason: string): Promise<Payment> {
    const extid = payment.invoiceId as string;
    try {
      await this.client.closePaymentExtId(extid);
    } catch (err) {
      if (!(err instanceof AgroprombankQrError)) throw err;
      // Already closed, never issued, or refused: the state below decides.
      this.logger.warn(`ClosePaymentExtId refused for extid=${extid}: ${err.description}`);
    }
    const record = await this.readState(payment);
    if (record?.state === QR_STATE.PAID) return this.applyPaid(payment, record);

    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        rawJson: { ...rawOf(payment), closed: true, closeReason: reason, bankState: record?.state ?? null },
      },
    });
    if (claimed.count > 0) {
      this.logger.log(`Closed QR invoice extid=${extid} unpaid (${reason})`);
      await this.recordEvent(payment, 'PAYMENT_FAILED', { errorCode: 'closed', reason });
    }
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  /**
   * The bank says the invoice is paid. The row is claimed (`PENDING` — or
   * `FAILED`, for an invoice paid after we closed it — to `REQUIRES_ACTION`),
   * then the money goes on the order: it reaches the kitchen board and the
   * staff hear of it. Money the order cannot use is given straight back.
   */
  private async applyPaid(payment: Payment, record: QrPaymentRecord): Promise<Payment> {
    if (payment.status !== 'PENDING' && payment.status !== 'FAILED') return payment;

    const amount = matchPaidAmount(record, payment.amountCents, QR_CURRENCY_CODE);
    const raw = {
      ...rawOf(payment),
      qrPaymentId: record.qrPaymentId ?? qrPaymentRefs(payment).qrPaymentId,
      rrn: record.rrn,
      bankState: record.state,
      paidAmount: record.amount,
      paidTransactionAmount: record.transactionAmount,
      amountReadings: amount.matches ? amount.readings : null,
      paymentDate: record.paymentDate,
      paidAt: new Date().toISOString(),
    } satisfies Record<string, Prisma.InputJsonValue | null>;

    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: { status: 'REQUIRES_ACTION', providerRef: record.qrPaymentId ?? payment.providerRef, rawJson: raw },
    });
    const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (claimed.count === 0) return updated;

    if (amount.matches) {
      const readings = Object.entries(amount.readings).map(([field, unit]) => `${field} in ${unit}`);
      this.logger.log(
        `QR invoice extid=${payment.invoiceId} paid (bank id ${record.qrPaymentId ?? '?'}, ` +
          `rrn ${record.rrn ?? '?'}; ${readings.length > 0 ? readings.join(', ') : 'no amount in the record'})`,
      );
    }

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

    if (!order || order.status !== 'CREATED' || other || !amount.matches) {
      const why = !amount.matches
        ? `paid amount does not match: ${amount.reason}`
        : other
          ? 'the order is already paid for'
          : `the order is ${order?.status ?? 'gone'}`;
      this.logger.error(`QR invoice extid=${payment.invoiceId} paid but unusable (${why}) — giving the money back`);
      return this.giveBack(updated, why);
    }

    await this.settlement.announceHeld(payment.orderId);
    return updated;
  }

  /**
   * Money the order cannot use goes back at once with `ReversePayment`. A
   * refusal leaves the row flagged for release, and the reconciliation cron
   * retries it ({@link PaymentHoldsService.retryPendingReleases}), loudly
   * after the last try. A cancelled or expired order records where its money is.
   */
  private async giveBack(payment: Payment, why: string): Promise<Payment> {
    const flagged = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { rawJson: { ...rawOf(payment), releaseRequired: true, releaseReason: why } },
    });
    const released = await this.holds.release(flagged, 'unusable-payment');
    await this.prisma.order.updateMany({
      where: {
        id: payment.orderId,
        status: { in: ['CANCELLED', 'EXPIRED'] },
        OR: [{ cancelMoney: null }, { cancelMoney: 'PENDING' }],
      },
      data: { cancelMoney: released ? 'REFUNDED' : 'PENDING' },
    });
    return released ?? flagged;
  }

  private async reverseNow(payment: Payment & { invoiceId: string }, audit: RefundAudit): Promise<Payment> {
    let after: QrPaymentRecord | null;
    try {
      after = await this.client.reverseInvoice(payment.invoiceId, qrPaymentRefs(payment));
    } catch (err) {
      throw toHttpException(err);
    }
    this.logger.log(
      `Reversed QR invoice extid=${payment.invoiceId}; the bank now says state ${after?.state ?? '?'} ` +
        `(${after?.stateDescription ?? 'no record'})`,
    );
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedCents: payment.amountCents },
    });
    await this.recordEvent(
      payment,
      'REFUND_ISSUED',
      {
        amount: payment.amountCents - payment.refundedCents,
        kind: 'reversal',
        reason: audit.reason ?? null,
        note: audit.note ?? null,
        source: audit.source ?? null,
      },
      audit.actorId,
    );
    return updated;
  }

  private async markFailed(payment: Payment, details: { failure: string; failureReason: string }): Promise<Payment> {
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'FAILED', rawJson: { ...rawOf(payment), ...details } },
    });
    if (claimed.count > 0) {
      await this.recordEvent(payment, 'PAYMENT_FAILED', { errorCode: details.failure, reason: details.failureReason });
    }
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  /** The bank's record of the invoice; a refusal to answer reads as "no such paid invoice". */
  private async readState(payment: Payment): Promise<QrPaymentRecord | null> {
    try {
      return await this.client.getPaymentStateExtId(payment.invoiceId as string);
    } catch (err) {
      if (!(err instanceof AgroprombankQrError)) throw err;
      this.logger.debug(`GetPaymentStateExtId refused for extid=${payment.invoiceId}: ${err.description}`);
      return null;
    }
  }

  private async recordEvent(
    payment: Payment,
    type: 'PAYMENT_FAILED' | 'REFUND_ISSUED',
    payload: Record<string, Prisma.InputJsonValue | null>,
    actorId?: string,
  ): Promise<void> {
    await this.prisma.orderEvent.create({
      data: {
        orderId: payment.orderId,
        type,
        ...(actorId ? { actorId } : {}),
        payload: { provider: 'AGROPROMBANK_QR', invoiceId: payment.invoiceId, ...payload },
      },
    });
  }

  /** Paid already: a card hold or capture, or money taken by any provider. */
  private async findPaid(orderId: string): Promise<Payment | null> {
    return (
      (await this.prisma.payment.findFirst({
        where: { orderId, provider: { in: [...CARD_PROVIDERS] }, status: { in: ['REQUIRES_ACTION', 'SUCCEEDED'] } },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await this.prisma.payment.findFirst({
        where: { orderId, status: 'SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
      }))
    );
  }

  /** A pending invoice the start may answer again: the order still takes it, for the same sum. */
  private stillOffered(payment: Payment, order: Order): boolean {
    if (order.status !== 'CREATED' || payment.amountCents !== order.totalCents) return false;
    // Without the bank's id the invoice is either still being issued or lost.
    return !!payment.providerRef || Date.now() - payment.createdAt.getTime() <= this.createSettleMs();
  }

  /** Runs a bank-bound step for the customer; a bank that cannot be reached is a 503 they can retry. */
  private async askingTheBank(payment: Payment, step: () => Promise<Payment>): Promise<Payment> {
    try {
      return await step();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`QR invoice ${payment.invoiceId}: the bank could not be reached: ${messageOf(err)}`);
      throw qrError(
        503,
        'QR_BANK_UNAVAILABLE',
        'The bank could not be reached; the QR invoice is being verified — try again',
      );
    }
  }

  private dueForCheck(paymentId: string): boolean {
    const now = Date.now();
    const last = this.lastChecked.get(paymentId);
    if (last !== undefined && now - last < STATUS_CHECK_INTERVAL_MS) return false;
    this.lastChecked.set(paymentId, now);
    if (this.lastChecked.size > 1_000) {
      for (const [id, at] of this.lastChecked) {
        if (now - at > 60_000) this.lastChecked.delete(id);
      }
    }
    return true;
  }

  private createSettleMs(): number {
    return this.config.timeoutMs + CREATE_SETTLE_MS;
  }

  /** A QR payment of the customer's own order; anything else is not found. */
  private async requireOwnPayment(userId: string, paymentId: string): Promise<Payment & { invoiceId: string }> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, provider: 'AGROPROMBANK_QR', order: { userId } },
    });
    if (!payment?.invoiceId) throw new NotFoundException('Payment not found');
    return payment as Payment & { invoiceId: string };
  }

  private async requirePayment(paymentId: string): Promise<Payment & { invoiceId: string }> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.provider !== 'AGROPROMBANK_QR') throw new NotFoundException('Payment not found');
    if (!payment.invoiceId) throw new BadRequestException('Payment has no invoice id');
    return payment as Payment & { invoiceId: string };
  }

  private assertOffered(): void {
    if (this.config.isConfigured) return;
    const missing = this.config.missingSettings();
    throw qrError(
      409,
      'QR_PAYMENT_DISABLED',
      !this.config.enabled
        ? 'The QR payment is switched off on this deployment'
        : `The QR payment is not configured: missing ${missing.join(', ')}`,
    );
  }

  private toDto(payment: Payment): AgroprombankQrPaymentDto {
    const status = qrStatusOf(payment);
    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      status,
      amountCents: payment.amountCents,
      currency: QR_CURRENCY,
      qr: status === 'PENDING' && payment.provider === 'AGROPROMBANK_QR' ? this.qrOf(payment) : null,
    };
  }

  private qrOf(payment: Payment): AgroprombankQrPaymentDto['qr'] {
    const raw = rawOf(payment);
    const extid = payment.invoiceId ?? '';
    const terminal = typeof raw['terminalId'] === 'string' ? raw['terminalId'] : (this.config.terminalId ?? '');
    const code =
      typeof raw['qrCode'] === 'string'
        ? raw['qrCode']
        : formatQrCode(this.config.codeFormat, { terminal, amountKopecks: payment.amountCents, extid });
    return {
      code,
      appLink: formatAppLink(this.config.appLink, { code, extid, terminal }),
      expiresAt: invoiceExpiry(payment, this.config.lifetimeMinutes).toISOString(),
    };
  }

  private toAdminView(payment: Payment): QrPaymentAdminView {
    const refs: QrPaymentRefs = qrPaymentRefs(payment);
    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      status: payment.status,
      invoiceId: payment.invoiceId ?? '',
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      qrPaymentId: refs.qrPaymentId,
      rrn: refs.rrn,
    };
  }
}

/** The customer's word for a payment row — see {@link AgroprombankQrPaymentDto}. */
export function qrStatusOf(payment: Pick<Payment, 'status' | 'rawJson'>): AgroprombankQrPaymentStatus {
  switch (payment.status) {
    case 'PENDING':
      return 'PENDING';
    case 'REQUIRES_ACTION':
    case 'SUCCEEDED':
      return 'PAID';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'REFUNDED';
    case 'FAILED':
      return isClosed(payment) ? 'EXPIRED' : 'FAILED';
  }
}

/** A QR invoice closed unpaid — by the customer, or once it lapsed. */
export function isClosed(payment: Pick<Payment, 'rawJson'>): boolean {
  const raw = payment.rawJson;
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>)['closed'] === true;
}

function isHeldOrPaid(payment: Pick<Payment, 'status'>): boolean {
  return payment.status === 'REQUIRES_ACTION' || payment.status === 'SUCCEEDED';
}

function invoiceExpiry(payment: Payment, lifetimeMinutes: number): Date {
  const raw = rawOf(payment)['expiresAt'];
  const parsed = typeof raw === 'string' ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed
    : new Date(payment.createdAt.getTime() + lifetimeMinutes * 60_000);
}

function qrError(status: 409 | 503, code: AgroprombankQrErrorCode, message: string): HttpException {
  return new HttpException(
    {
      statusCode: status,
      error: status === 409 ? 'Conflict' : 'Service Unavailable',
      code,
      message,
    } satisfies AgroprombankQrErrorBody,
    status,
  );
}

function toHttpException(err: unknown): Error {
  if (err instanceof AgroprombankQrError) return new BadRequestException(err.description || err.message);
  if (err instanceof AgroprombankQrTransportError) return new BadGatewayException('The bank did not answer');
  return err instanceof Error ? err : new BadGatewayException('Unexpected bank error');
}

function rawOf(payment: Payment): Record<string, Prisma.InputJsonValue> {
  const raw = payment.rawJson;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Prisma.InputJsonValue>) : {};
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
