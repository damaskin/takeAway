import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PaymentTerminal, Prisma } from '@prisma/client';
import type {
  DefaultPaymentTerminal,
  PaymentTerminalCertificate,
  PaymentTerminalCheck,
  PaymentTerminalCheckResult,
  PaymentTerminalFlow,
  PaymentTerminalSecret,
  PaymentTerminalStatus,
  PaymentTerminalView,
  UpsertPaymentTerminalRequest,
} from '@takeaway/shared-types';
import { X509Certificate, createPrivateKey } from 'node:crypto';

import { SecretCipher } from '../../common/crypto/secret-cipher';
import { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankQrClient, AgroprombankQrError } from '../agroprombank-qr/agroprombank-qr.client';
import { AgroprombankQrConfig } from '../agroprombank-qr/agroprombank-qr.config';
import { QR_TERMINAL_PATTERN } from '../agroprombank-qr/constants';
import { AgroprombankWebClient, AgroprombankWebError } from '../agroprombank-web/agroprombank-web.client';
import { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import { AgroprombankClient, AgroprombankError } from '../agroprombank/agroprombank.client';
import { AgroprombankConfig } from '../agroprombank/agroprombank.config';
import { PaymentTerminalsService, hasSection } from './payment-terminals.service';

/** Columns a section is identified by: changing one on a used terminal starts a new record. */
const IDENTITY_FIELDS = [
  'cardMerchantId',
  'cardTerminalId',
  'webMerchantLogin',
  'webMerchantId',
  'qrTerminalId',
] as const;

/** Plain columns as the request names them. */
const PLAIN_FIELDS = {
  cardMerchantId: 'cardMerchantId',
  cardTerminalId: 'cardTerminalId',
  webMerchantLogin: 'webMerchantLogin',
  webMerchantId: 'webMerchantId',
  qrTerminalId: 'qrTerminalId',
  qrLogin: 'qrLogin',
  qrDeviceId: 'qrDeviceId',
} as const;

/** Certificates (public, stored as PEM) as the request names them. */
const CERT_FIELDS = {
  cardCertificate: 'cardCertificatePem',
  cardBankCertificate: 'cardBankCertificatePem',
  webBankCertificate: 'webBankCertificatePem',
} as const;

/** Secrets (encrypted at rest, never returned) as the request names them. */
const SECRET_FIELDS = {
  cardPrivateKey: 'cardPrivateKeyCipher',
  webMerchantPass: 'webMerchantPassCipher',
  qrPassword: 'qrPasswordCipher',
  qrExternalToken: 'qrExternalTokenCipher',
} as const;

type TerminalData = Omit<
  PaymentTerminal,
  'id' | 'brandId' | 'retiredAt' | 'createdById' | 'updatedById' | 'createdAt' | 'updatedAt'
>;

const EMPTY: TerminalData = {
  cardMerchantId: null,
  cardTerminalId: null,
  cardPrivateKeyCipher: null,
  cardCertificatePem: null,
  cardBankCertificatePem: null,
  webMerchantLogin: null,
  webMerchantId: null,
  webMerchantPassCipher: null,
  webBankCertificatePem: null,
  qrTerminalId: null,
  qrLogin: null,
  qrPasswordCipher: null,
  qrExternalTokenCipher: null,
  qrDeviceId: null,
  holdUntilAccepted: false,
  isTest: false,
  note: null,
};

/** A made-up invoice for the connection check: the status lookup of something that is not there. */
const PROBE_INVOICE = '1';

/**
 * «Платёжный терминал» on a brand's card, for the platform team: enter,
 * replace or remove the brand's own Agroprombank registration, and check it.
 *
 * Secrets go in encrypted (SecretCipher, `POS_CREDENTIALS_KEY`) and never
 * come back out — the view says whether one is stored and its last four
 * characters. Rows are never rewritten under payments that went through
 * them: a change of what identifies a section starts a new row and retires
 * the old one, which keeps serving those payments' refunds.
 */
@Injectable()
export class PaymentTerminalsAdminService {
  private readonly logger = new Logger(PaymentTerminalsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly terminals: PaymentTerminalsService,
    private readonly cardConfig: AgroprombankConfig,
    private readonly webConfig: AgroprombankWebConfig,
    private readonly qrConfig: AgroprombankQrConfig,
    private readonly cardClient: AgroprombankClient,
    private readonly webClient: AgroprombankWebClient,
    private readonly qrClient: AgroprombankQrClient,
  ) {}

  async view(brandId: string): Promise<PaymentTerminalView> {
    await this.requireBrand(brandId);
    const row = await this.prisma.paymentTerminal.findFirst({
      where: { brandId, retiredAt: null },
      orderBy: { createdAt: 'desc' },
      include: { updatedBy: { select: { name: true, email: true } } },
    });
    return this.toView(brandId, row, row?.updatedBy ? (row.updatedBy.name ?? row.updatedBy.email) : null);
  }

  /** What the brand's own roles may know: whether money lands on their own terminal. */
  async status(brandId: string): Promise<PaymentTerminalStatus> {
    const row = await this.terminals.activeRow(brandId);
    const flows = {
      card: row && hasSection(row, 'card') ? 'BRAND' : 'DEFAULT',
      web: row && hasSection(row, 'web') ? 'BRAND' : 'DEFAULT',
      qr: row && hasSection(row, 'qr') ? 'BRAND' : 'DEFAULT',
    } as const;
    return { connected: Object.values(flows).includes('BRAND'), flows };
  }

  async upsert(brandId: string, input: UpsertPaymentTerminalRequest, actorId: string): Promise<PaymentTerminalView> {
    await this.requireBrand(brandId);
    const current = await this.terminals.activeRow(brandId);
    const next = this.merge(current ?? EMPTY, input);
    this.assertSectionsComplete(brandId, next);
    if (!['card', 'web', 'qr'].some((flow) => hasSection(next as PaymentTerminal, flow as PaymentTerminalFlow))) {
      throw new BadRequestException('Fill in at least one section, or remove the terminal');
    }

    await this.prisma.$transaction(async (tx) => {
      if (!current) {
        await tx.paymentTerminal.create({ data: { ...next, brandId, createdById: actorId, updatedById: actorId } });
        return;
      }
      const reidentified = IDENTITY_FIELDS.some((f) => (current[f] ?? null) !== (next[f] ?? null));
      if (reidentified && (await this.isUsed(tx, current.id))) {
        // Payments already went through the old identity: they keep it.
        await tx.paymentTerminal.update({ where: { id: current.id }, data: { retiredAt: new Date() } });
        await tx.paymentTerminal.create({ data: { ...next, brandId, createdById: actorId, updatedById: actorId } });
        return;
      }
      await tx.paymentTerminal.update({ where: { id: current.id }, data: { ...next, updatedById: actorId } });
    });
    this.logger.log(`Payment terminal of brand ${brandId} saved by ${actorId}`);
    return this.view(brandId);
  }

  /**
   * «Убрать терминал»: the brand goes back to takeAway's default terminal for
   * new payments. A terminal that took payments (or bound cards) is retired,
   * not deleted — its refunds still go back through it; an unused one is
   * deleted with its secrets.
   */
  async remove(brandId: string, actorId: string): Promise<PaymentTerminalView> {
    await this.requireBrand(brandId);
    const current = await this.terminals.activeRow(brandId);
    if (!current) return this.view(brandId);
    await this.prisma.$transaction(async (tx) => {
      if (await this.isUsed(tx, current.id)) {
        await tx.paymentTerminal.update({
          where: { id: current.id },
          data: { retiredAt: new Date(), updatedById: actorId },
        });
      } else {
        await tx.paymentTerminal.delete({ where: { id: current.id } });
      }
    });
    this.logger.log(`Payment terminal of brand ${brandId} removed by ${actorId}`);
    return this.view(brandId);
  }

  /**
   * «Проверить подключение»: one read-only call per section of the brand's
   * terminal — the status of a made-up invoice (GetOperation / GetState /
   * GetPaymentStateExtId). Nothing is created, held or moved. A signed answer
   * that the invoice does not exist means the bank accepted our credentials.
   */
  async check(brandId: string): Promise<PaymentTerminalCheckResult> {
    await this.requireBrand(brandId);
    const row = await this.terminals.activeRow(brandId);
    if (!row) throw new BadRequestException('The brand has no terminal of its own to check');
    const checks: PaymentTerminalCheck[] = [];
    if (hasSection(row, 'card')) checks.push(await this.checkCard(row));
    if (hasSection(row, 'web')) checks.push(await this.checkWeb(row));
    if (hasSection(row, 'qr')) checks.push(await this.checkQr(row));
    return { checks };
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async checkCard(row: PaymentTerminal): Promise<PaymentTerminalCheck> {
    const terminal = this.terminals.cardOf(row);
    const missing = this.cardConfig.enabled ? this.cardConfig.missingFor(terminal) : ['AGROPROMBANK_ENABLED'];
    if (missing.length) return { flow: 'card', outcome: 'FAILED', message: `Не хватает: ${missing.join(', ')}` };
    try {
      await this.cardClient.invoke(
        'GetOperation',
        { terminalid: terminal.terminalId, invoiceid: PROBE_INVOICE },
        terminal,
      );
      return { flow: 'card', outcome: 'OK', message: 'Банк ответил, подпись ответа проверена' };
    } catch (err) {
      if (err instanceof AgroprombankError) {
        return { flow: 'card', outcome: 'ANSWERED', message: `Банк ответил: ${err.description} (код ${err.code})` };
      }
      return { flow: 'card', outcome: 'FAILED', message: messageOf(err) };
    }
  }

  private async checkWeb(row: PaymentTerminal): Promise<PaymentTerminalCheck> {
    const terminal = this.terminals.webOf(row);
    const missing = this.webConfig.enabled ? this.webConfig.missingFor(terminal) : ['AGROPROMBANK_WEB_ENABLED'];
    if (missing.length) return { flow: 'web', outcome: 'FAILED', message: `Не хватает: ${missing.join(', ')}` };
    try {
      const state = await this.webClient.getState(PROBE_INVOICE, terminal);
      return { flow: 'web', outcome: 'OK', message: `Банк ответил: ${state.stateDescription ?? state.state}` };
    } catch (err) {
      if (err instanceof AgroprombankWebError) {
        return { flow: 'web', outcome: 'ANSWERED', message: `Банк ответил: ${err.description} (код ${err.code})` };
      }
      return { flow: 'web', outcome: 'FAILED', message: messageOf(err) };
    }
  }

  private async checkQr(row: PaymentTerminal): Promise<PaymentTerminalCheck> {
    const terminal = this.terminals.qrOf(row);
    const missing = this.qrConfig.missingFor(terminal);
    if (missing.length) return { flow: 'qr', outcome: 'FAILED', message: `Не хватает: ${missing.join(', ')}` };
    try {
      const record = await this.qrClient.getPaymentStateExtId(PROBE_INVOICE, terminal);
      return {
        flow: 'qr',
        outcome: 'OK',
        message: record ? `Банк ответил: ${record.stateDescription ?? record.state}` : 'Банк ответил: счёта нет',
      };
    } catch (err) {
      if (err instanceof AgroprombankQrError) {
        return { flow: 'qr', outcome: 'ANSWERED', message: `Банк ответил: ${err.description}` };
      }
      return { flow: 'qr', outcome: 'FAILED', message: messageOf(err) };
    }
  }

  /** Applies a request to the stored values: left out — kept, null/'' — cleared, a value — set. */
  private merge(base: TerminalData, input: UpsertPaymentTerminalRequest): TerminalData {
    const next: TerminalData = { ...pickData(base) };
    for (const [key, column] of Object.entries(PLAIN_FIELDS)) {
      const value = input[key as keyof typeof PLAIN_FIELDS];
      if (value !== undefined) next[column] = clean(value);
    }
    const qrTerminal = next.qrTerminalId;
    if (qrTerminal && !QR_TERMINAL_PATTERN.test(qrTerminal)) {
      throw new BadRequestException('The QR terminal is QRT and fifteen digits');
    }
    for (const [key, column] of Object.entries(CERT_FIELDS)) {
      const value = input[key as keyof typeof CERT_FIELDS];
      if (value === undefined) continue;
      const pem = cleanPem(value);
      if (pem) assertCertificate(pem, key);
      next[column] = pem;
    }
    for (const [key, column] of Object.entries(SECRET_FIELDS)) {
      const value = input[key as keyof typeof SECRET_FIELDS];
      if (value === undefined) continue;
      const secret = key === 'cardPrivateKey' ? cleanPem(value) : clean(value);
      if (secret && key === 'cardPrivateKey') assertPrivateKey(secret);
      next[column] = secret ? this.cipher.encrypt(secret) : null;
    }
    if (input.holdUntilAccepted !== undefined) next.holdUntilAccepted = input.holdUntilAccepted;
    if (input.isTest !== undefined) next.isTest = input.isTest;
    if (input.note !== undefined) next.note = clean(input.note);
    return next;
  }

  /** A section that is there must be complete — half a terminal would fail every payment of the brand. */
  private assertSectionsComplete(brandId: string, data: TerminalData): void {
    const row = { ...data, id: 'draft', brandId } as PaymentTerminal;
    const problems: string[] = [];
    const sectionTouched = {
      card: !!(data.cardMerchantId || data.cardTerminalId || data.cardPrivateKeyCipher || data.cardCertificatePem),
      web: !!(data.webMerchantLogin || data.webMerchantId || data.webMerchantPassCipher),
      qr: !!(data.qrTerminalId || data.qrLogin || data.qrPasswordCipher || data.qrExternalTokenCipher),
    };
    if (sectionTouched.card) {
      const t = this.terminals.cardOf(row);
      if (!t.merchantId) problems.push('card merchant id');
      problems.push(...this.cardConfig.missingFor(t).filter((m) => !m.startsWith('AGROPROMBANK_INVOICE_PREFIX')));
    }
    if (sectionTouched.web) {
      const t = this.terminals.webOf(row);
      problems.push(...this.webConfig.missingFor(t).filter((m) => !m.startsWith('AGROPROMBANK_INVOICE_PREFIX')));
    }
    if (sectionTouched.qr) {
      const t = this.terminals.qrOf(row);
      problems.push(...this.qrConfig.missingFor(t).filter((m) => !m.startsWith('AGROPROMBANK_INVOICE_PREFIX')));
    }
    const unique = [...new Set(problems)];
    if (unique.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PAYMENT_TERMINAL_INCOMPLETE',
        message: `Не хватает: ${unique.join(', ')}`,
        missing: unique,
      });
    }
  }

  private async isUsed(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const [payments, tokens, bindings] = await Promise.all([
      tx.payment.count({ where: { paymentTerminalId: id } }),
      tx.cardToken.count({ where: { paymentTerminalId: id } }),
      tx.cardBindingRequest.count({ where: { paymentTerminalId: id } }),
    ]);
    return payments + tokens + bindings > 0;
  }

  private async requireBrand(brandId: string): Promise<void> {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) throw new NotFoundException('Brand not found');
  }

  private toView(brandId: string, row: PaymentTerminal | null, updatedByName: string | null): PaymentTerminalView {
    const card = row && hasSection(row, 'card');
    const web = row && hasSection(row, 'web');
    const qr = row && hasSection(row, 'qr');
    return {
      brandId,
      id: row?.id ?? null,
      card: {
        source: card ? 'BRAND' : 'DEFAULT',
        merchantId: row?.cardMerchantId ?? null,
        terminalId: row?.cardTerminalId ?? null,
        privateKey: this.secretState(row?.cardPrivateKeyCipher ?? null, true),
        certificate: certificateState(row?.cardCertificatePem ?? null),
        bankCertificate: certificateState(row?.cardBankCertificatePem ?? null),
      },
      web: {
        source: web ? 'BRAND' : 'DEFAULT',
        merchantLogin: row?.webMerchantLogin ?? null,
        merchantId: row?.webMerchantId ?? null,
        merchantPass: this.secretState(row?.webMerchantPassCipher ?? null),
        bankCertificate: certificateState(row?.webBankCertificatePem ?? null),
      },
      qr: {
        source: qr ? 'BRAND' : 'DEFAULT',
        terminalId: row?.qrTerminalId ?? null,
        login: row?.qrLogin ?? null,
        password: this.secretState(row?.qrPasswordCipher ?? null),
        externalToken: this.secretState(row?.qrExternalTokenCipher ?? null),
        deviceId: row?.qrDeviceId ?? null,
      },
      holdUntilAccepted: row?.holdUntilAccepted ?? false,
      isTest: row?.isTest ?? false,
      note: row?.note ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByName,
      defaultTerminal: this.defaultTerminal(),
    };
  }

  private defaultTerminal(): DefaultPaymentTerminal {
    return {
      card: {
        configured: this.cardConfig.isConfigured,
        merchantId: this.cardConfig.merchantId,
        terminalId: this.cardConfig.terminalId,
      },
      web: { configured: this.webConfig.isConfigured, merchantLogin: this.webConfig.merchantLogin },
      qr: { configured: this.qrConfig.canCallBank, terminalId: this.qrConfig.terminalId },
    };
  }

  /** Stored or not, and the last four characters — of a key, the last four of its body. */
  private secretState(cipher: string | null, pem = false): PaymentTerminalSecret {
    if (!cipher) return { set: false, last4: null };
    try {
      return { set: true, last4: lastFour(this.cipher.decrypt(cipher), pem) };
    } catch {
      return { set: true, last4: null };
    }
  }
}

function pickData(row: TerminalData): TerminalData {
  const out = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as Array<keyof TerminalData>) {
    (out as Record<string, unknown>)[key] = row[key];
  }
  return out;
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A PEM pasted into a one-line field keeps its line breaks as `\n`. */
function cleanPem(value: string | null): string | null {
  const trimmed = value?.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  return trimmed ? `${trimmed}\n` : null;
}

function assertCertificate(pem: string, field: string): void {
  try {
    new X509Certificate(pem);
  } catch {
    throw new BadRequestException(`${field} is not a PEM certificate`);
  }
}

function assertPrivateKey(pem: string): void {
  try {
    createPrivateKey(pem);
  } catch {
    throw new BadRequestException('cardPrivateKey is not a PEM private key (an unencrypted one is needed)');
  }
}

export function lastFour(secret: string, pem = false): string | null {
  const body = pem ? secret.replace(/-----[^-]+-----/g, '').replace(/[\s=]/g, '') : secret;
  return body.length >= 8 ? body.slice(-4) : null;
}

export function certificateState(pem: string | null): PaymentTerminalCertificate {
  if (!pem) return { set: false, subject: null, validTo: null };
  try {
    const cert = new X509Certificate(pem);
    return { set: true, subject: cert.subject.replace(/\n/g, ', '), validTo: new Date(cert.validTo).toISOString() };
  } catch {
    return { set: true, subject: null, validTo: null };
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
