import { Injectable } from '@nestjs/common';
import type { Payment } from '@prisma/client';

import { AgroprombankQrService } from './agroprombank-qr/agroprombank-qr.service';
import { AgroprombankWebService } from './agroprombank-web/agroprombank-web.service';
import { AgroprombankService } from './agroprombank/agroprombank.service';
import { PaymentHoldsService } from './agroprombank/payment-holds.service';
import { isDeferredCharge } from './card-providers';

export interface RefundAudit {
  actorId?: string;
  reason?: string | null;
  note?: string | null;
  source?: string;
}

/**
 * The money operations that do not care which Agroprombank flow took the
 * money — capture on accept, refund from the admin — routed to the service
 * that speaks to the bank for that payment.
 */
@Injectable()
export class CardPaymentsService {
  constructor(
    private readonly holds: PaymentHoldsService,
    private readonly token: AgroprombankService,
    private readonly web: AgroprombankWebService,
    private readonly qr: AgroprombankQrService,
  ) {}

  /**
   * Captures whatever is held against an order, the moment the store takes
   * it on. Returns `null` when there is nothing held — an order charged
   * outright, or one with nothing to pay — so the caller can treat "no hold"
   * and "captured" alike.
   *
   * The held amount is captured as held, never the order's current total: the
   * customer agreed to the figure they saw at checkout, and anything the store
   * changed afterwards is a conversation, not a silent larger debit. A charge
   * that was put off until now (no preauthorization on the terminal) is made
   * here for that same amount. A paid QR invoice was money taken at payment:
   * it is settled with no bank call.
   */
  async captureHoldForOrder(orderId: string): Promise<Payment | null> {
    const hold = await this.holds.findHold(orderId);
    if (!hold) return null;
    if (isDeferredCharge(hold)) {
      await this.token.captureDeferred(hold.id);
    } else if (hold.provider === 'AGROPROMBANK_WEB') {
      await this.web.complete(hold.id, hold.amountCents);
    } else if (hold.provider === 'AGROPROMBANK_QR') {
      await this.qr.settleOnAccept(hold.id);
    } else {
      await this.token.completePreauthorization(hold.id, hold.amountCents);
    }
    return hold;
  }

  /**
   * Full or partial refund of a captured card payment; returns the bank-side
   * reference. A QR payment goes back in full only (`ReversePayment` takes no
   * amount) — a partial refund is a 400 `QR_PARTIAL_REFUND_UNSUPPORTED`.
   */
  async refund(payment: Payment, amountCents: number, audit: RefundAudit): Promise<string> {
    if (payment.provider === 'AGROPROMBANK_QR') {
      const result = await this.qr.refund(payment.id, amountCents, audit);
      return result.rrn ?? result.invoiceId;
    }
    if (payment.provider === 'AGROPROMBANK_WEB') {
      const result = await this.web.refund(payment.id, amountCents, audit);
      return result.rrn ?? result.invoiceId;
    }
    const result = await this.token.refund(payment.id, amountCents, audit);
    return result.operationId ?? result.invoiceId;
  }
}
