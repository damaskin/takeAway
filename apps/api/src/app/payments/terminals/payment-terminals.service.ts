import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentTerminal } from '@prisma/client';

import { SecretCipher } from '../../common/crypto/secret-cipher';
import { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankQrConfig } from '../agroprombank-qr/agroprombank-qr.config';
import { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import { AgroprombankConfig } from '../agroprombank/agroprombank.config';
import type { CardTerminal, QrTerminal, WebTerminal } from './terminal-types';

/**
 * How a brand's customers can pay online: by card in the card flow the
 * deployment runs (`CARD_PAYMENT_FLOW` — bound cards or the bank's page), and
 * by QR in the bank's app. Each needs the flow switched on AND the brand's own
 * terminal carrying that flow's section. Without either the brand's orders go
 * to the kitchen at once and are paid at the store.
 */
export interface BrandOnlinePayment {
  card: boolean;
  qr: boolean;
}

export const NO_ONLINE_PAYMENT: BrandOnlinePayment = Object.freeze({ card: false, qr: false });

/** The flows a terminal row can have a section for. */
export type TerminalFlow = 'card' | 'web' | 'qr';

/** Whether a row carries the section for a flow — its identifying field is set. */
export function hasSection(row: PaymentTerminal, flow: TerminalFlow): boolean {
  switch (flow) {
    case 'card':
      return !!row.cardMerchantId;
    case 'web':
      return !!row.webMerchantLogin;
    case 'qr':
      return !!row.qrTerminalId;
  }
}

/**
 * Which Agroprombank terminal a bank call goes through.
 *
 * - A new payment for a brand uses the brand's own active terminal, for the
 *   flows its row has a section for (`*ForBrand`). A brand without one takes
 *   no online payment for that flow at all — null — and never falls back to
 *   takeAway's default terminal: the money of a brand's guests lands on the
 *   brand's own account or is paid at the store (owner, 2026-11-27).
 * - Everything after that — capture, status, cancel, refund, reconciliation,
 *   a callback — uses the terminal recorded on the payment (or card token),
 *   retired or not (`*For(id)`): the money goes back the way it came.
 *
 * Decrypts the secrets for the duration of one call; nothing is cached, so a
 * replaced key is used from the next call on.
 */
@Injectable()
export class PaymentTerminalsService {
  private readonly logger = new Logger(PaymentTerminalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly card: AgroprombankConfig,
    private readonly web: AgroprombankWebConfig,
    private readonly qr: AgroprombankQrConfig,
  ) {}

  /** The brand's terminal in use — the latest one not retired — or null. */
  activeRow(brandId: string): Promise<PaymentTerminal | null> {
    return this.prisma.paymentTerminal.findFirst({
      where: { brandId, retiredAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The brand an order belongs to, through its store. */
  async brandOfOrder(orderId: string): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { store: { select: { brandId: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order.store.brandId;
  }

  /** The brand's own bound-card terminal; null — the brand takes no card payment. */
  async cardForBrand(brandId: string): Promise<CardTerminal | null> {
    const row = await this.activeRow(brandId);
    return row && hasSection(row, 'card') ? this.cardOf(row) : null;
  }

  /** The brand's own Web-платёж registration; null — none. */
  async webForBrand(brandId: string): Promise<WebTerminal | null> {
    const row = await this.activeRow(brandId);
    return row && hasSection(row, 'web') ? this.webOf(row) : null;
  }

  /** The brand's own QR terminal; null — the brand takes no QR payment. */
  async qrForBrand(brandId: string): Promise<QrTerminal | null> {
    const row = await this.activeRow(brandId);
    return row && hasSection(row, 'qr') ? this.qrOf(row) : null;
  }

  /** {@link onlinePaymentByBrand} for one brand. */
  async onlinePayment(brandId: string): Promise<BrandOnlinePayment> {
    return (await this.onlinePaymentByBrand([brandId])).get(brandId) ?? NO_ONLINE_PAYMENT;
  }

  /**
   * How each brand's customers can pay online, in one query and without
   * decrypting anything: the flow switched on for the deployment, and the
   * brand's active terminal carrying its section. The QR payment is RUP only —
   * the caller checks the store's currency against `qrPaymentCurrencies`.
   */
  async onlinePaymentByBrand(brandIds: ReadonlyArray<string>): Promise<Map<string, BrandOnlinePayment>> {
    const wanted = [...new Set(brandIds)];
    const out = new Map<string, BrandOnlinePayment>(wanted.map((id) => [id, NO_ONLINE_PAYMENT]));
    const flow = this.web.cardPaymentFlow;
    const qrOn = this.qr.enabled;
    if (wanted.length === 0 || (flow === 'none' && !qrOn)) return out;
    const rows = await this.prisma.paymentTerminal.findMany({
      where: { brandId: { in: wanted }, retiredAt: null },
      orderBy: { createdAt: 'desc' },
      select: { brandId: true, cardMerchantId: true, webMerchantLogin: true, qrTerminalId: true },
    });
    const seen = new Set<string>();
    for (const row of rows) {
      // The latest active row is the brand's terminal, as in activeRow().
      if (seen.has(row.brandId)) continue;
      seen.add(row.brandId);
      out.set(row.brandId, {
        card: flow === 'token' ? !!row.cardMerchantId : flow === 'web' ? !!row.webMerchantLogin : false,
        qr: qrOn && !!row.qrTerminalId,
      });
    }
    return out;
  }

  /** The terminal a payment or card token went through; null — the default one. */
  async cardFor(id: string | null): Promise<CardTerminal> {
    return id ? this.cardOf(await this.requireRow(id, 'card')) : this.card.defaultTerminal();
  }

  async webFor(id: string | null): Promise<WebTerminal> {
    return id ? this.webOf(await this.requireRow(id, 'web')) : this.web.defaultTerminal();
  }

  async qrFor(id: string | null): Promise<QrTerminal> {
    return id ? this.qrOf(await this.requireRow(id, 'qr')) : this.qr.defaultTerminal();
  }

  /**
   * The bound-card merchant of each terminal id (null — the default
   * terminal), without decrypting anything. A card token belongs to the
   * merchant it was bound at, so it can pay only where the merchant matches.
   */
  async cardMerchantIds(ids: ReadonlyArray<string | null>): Promise<Map<string | null, string | null>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    const rows = wanted.length
      ? await this.prisma.paymentTerminal.findMany({
          where: { id: { in: wanted } },
          select: { id: true, cardMerchantId: true },
        })
      : [];
    const out = new Map<string | null, string | null>([[null, this.card.merchantId]]);
    for (const row of rows) out.set(row.id, row.cardMerchantId);
    return out;
  }

  /**
   * The bound-card section of a row. The bank certificate falls back to the
   * env one — the bank signs with one certificate for every merchant unless
   * it says otherwise.
   */
  cardOf(row: PaymentTerminal): CardTerminal {
    return {
      id: row.id,
      brandId: row.brandId,
      merchantId: row.cardMerchantId,
      terminalId: row.cardTerminalId,
      privateKeyPem: this.reveal(row, 'cardPrivateKeyCipher'),
      certificatePem: row.cardCertificatePem,
      bankCertificatePem: row.cardBankCertificatePem ?? this.card.bankCertificatePem,
      isTest: row.isTest,
      holdUntilAccepted: row.holdUntilAccepted,
    };
  }

  webOf(row: PaymentTerminal): WebTerminal {
    return {
      id: row.id,
      brandId: row.brandId,
      merchantLogin: row.webMerchantLogin,
      merchantId: row.webMerchantId ?? row.webMerchantLogin,
      merchantPass: this.reveal(row, 'webMerchantPassCipher'),
      bankCertificatePem: row.webBankCertificatePem ?? this.web.bankCertificatePem,
      isTest: row.isTest,
      holdUntilAccepted: row.holdUntilAccepted,
    };
  }

  qrOf(row: PaymentTerminal): QrTerminal {
    return {
      id: row.id,
      brandId: row.brandId,
      terminalId: row.qrTerminalId,
      login: row.qrLogin,
      password: this.reveal(row, 'qrPasswordCipher'),
      externalToken: this.reveal(row, 'qrExternalTokenCipher'),
      deviceId: row.qrDeviceId,
    };
  }

  private async requireRow(id: string, flow: TerminalFlow): Promise<PaymentTerminal> {
    const row = await this.prisma.paymentTerminal.findUnique({ where: { id } });
    // A payment's terminal row is never deleted (FK `Restrict`) and never
    // loses the section it took the payment with (changing it retires the
    // row instead), so this is a broken invariant, not a fallback case:
    // sending the call through another merchant would be worse than failing.
    if (!row || !hasSection(row, flow)) {
      throw new ServiceUnavailableException(`Payment terminal ${id} has no ${flow} section`);
    }
    return row;
  }

  private reveal(
    row: PaymentTerminal,
    field: 'cardPrivateKeyCipher' | 'webMerchantPassCipher' | 'qrPasswordCipher' | 'qrExternalTokenCipher',
  ): string | null {
    const value = row[field];
    if (!value) return null;
    try {
      return this.cipher.decrypt(value);
    } catch (err) {
      this.logger.error(
        `Could not decrypt ${field} of payment terminal ${row.id}: ${err instanceof Error ? err.message : err}`,
      );
      throw new ServiceUnavailableException('Stored terminal credentials are unreadable on this deployment');
    }
  }
}

/**
 * A new payment for a brand that takes none online in this flow: its orders
 * go to the kitchen unpaid and are paid at the store. `409` with
 * `ONLINE_PAYMENT_UNAVAILABLE`, so a client that offered the payment anyway
 * (an older build) can say so instead of a generic failure.
 */
export function onlinePaymentUnavailable(flow: TerminalFlow): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'ONLINE_PAYMENT_UNAVAILABLE',
    message: `This brand takes no ${flow === 'card' ? 'bound-card' : flow === 'web' ? 'Web-платёж' : 'QR'} payment: it has no terminal of its own for it`,
  });
}
