import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_QR_CODE_FORMAT,
  DEFAULT_QR_NAMESPACE,
  DEFAULT_QR_SERVICE_URL,
  QR_CURRENCY,
  QR_TERMINAL_PATTERN,
} from './constants';

/**
 * Configuration for ЗАО «Агропромбанк» «Мобильный платёж» — invoices on a QR
 * terminal, paid from the bank's own app (docs/agroprombank-payments.md §12).
 *
 * A registration of its own: the bank issues a QR terminal and a login and
 * password for remote operations (or an `ExternalToken` instead). The password
 * and the token can come from a file, like every other bank secret.
 */
@Injectable()
export class AgroprombankQrConfig {
  private readonly logger = new Logger(AgroprombankQrConfig.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Offers the QR payment to customers. Offered next to the card flow
   * (`CARD_PAYMENT_FLOW`), not instead of it.
   */
  get enabled(): boolean {
    return this.bool('AGROPROMBANK_QR_ENABLED', false);
  }

  get serviceUrl(): string {
    return this.str('AGROPROMBANK_QR_SERVICE_URL') ?? DEFAULT_QR_SERVICE_URL;
  }

  /** Target namespace of the service; SOAPAction is this plus the function name. */
  get namespace(): string {
    return this.str('AGROPROMBANK_QR_NAMESPACE') ?? DEFAULT_QR_NAMESPACE;
  }

  get login(): string | null {
    return this.str('AGROPROMBANK_QR_LOGIN');
  }

  get password(): string | null {
    return this.secret('AGROPROMBANK_QR_PASSWORD');
  }

  /** Replaces login and password when the bank issues one; they then go out empty. */
  get externalToken(): string | null {
    return this.secret('AGROPROMBANK_QR_EXTERNAL_TOKEN');
  }

  /** The QR terminal, `QRT` and fifteen digits. */
  get terminalId(): string | null {
    return this.str('AGROPROMBANK_QR_TERMINAL_ID');
  }

  /** What the QR code says — see `formatQrCode`. */
  get codeFormat(): string {
    return this.str('AGROPROMBANK_QR_CODE_FORMAT') ?? DEFAULT_QR_CODE_FORMAT;
  }

  /** Opens the bank's app on the same phone — see `formatAppLink`. Unset: the QR code only. */
  get appLink(): string | null {
    return this.str('AGROPROMBANK_QR_APP_LINK');
  }

  /**
   * How long an invoice is offered before it is closed. Kept at or below the
   * unpaid-order TTL (`ORDER_PAYMENT_TTL_MINUTES`, 15) by default, so an order
   * is not expired while its customer is still paying.
   */
  get lifetimeMinutes(): number {
    return this.int('AGROPROMBANK_QR_LIFETIME_MINUTES', 10);
  }

  get timeoutMs(): number {
    return this.int('AGROPROMBANK_QR_TIMEOUT_MS', 15_000);
  }

  /**
   * Same prefix and sequence as the card flows: one numbering for every
   * invoice we ever send the bank, digits only. The QR invoice's external id
   * must stay unique for the terminal forever.
   */
  get invoicePrefix(): string {
    return this.config.get<string>('AGROPROMBANK_INVOICE_PREFIX')?.trim() ?? '';
  }

  /** Currencies an order can be paid in by QR — `GET /config/features` `qrPaymentCurrencies`. */
  get currencies(): string[] {
    return this.isConfigured ? [QR_CURRENCY] : [];
  }

  /** Switched on, and everything a call needs is there: new invoices can be issued. */
  get isConfigured(): boolean {
    return this.enabled && this.missingSettings().length === 0;
  }

  /**
   * Everything a call needs is there, switched on or not. Money already taken
   * by QR — a payment waiting for the kitchen, one to give back, an invoice to
   * close — is still looked after when the QR payment is switched off for new
   * orders.
   */
  get canCallBank(): boolean {
    return this.missingSettings().length === 0;
  }

  missingSettings(): string[] {
    const missing: string[] = [];
    const terminal = this.terminalId;
    if (!terminal) missing.push('AGROPROMBANK_QR_TERMINAL_ID');
    else if (!QR_TERMINAL_PATTERN.test(terminal)) missing.push('AGROPROMBANK_QR_TERMINAL_ID as QRT and 15 digits');
    if (!this.externalToken && !(this.login && this.password)) {
      missing.push('AGROPROMBANK_QR_LOGIN and AGROPROMBANK_QR_PASSWORD (or _FILE), or AGROPROMBANK_QR_EXTERNAL_TOKEN');
    }
    if (!/^\d*$/.test(this.invoicePrefix)) {
      missing.push('AGROPROMBANK_INVOICE_PREFIX of digits only');
    }
    return missing;
  }

  private str(key: string): string | null {
    return this.config.get<string>(key)?.trim() || null;
  }

  /** `KEY`, or the contents of the file `KEY_FILE` names. */
  private secret(key: string): string | null {
    const inline = this.config.get<string>(key);
    if (inline && inline.trim()) return inline.trim();
    const path = this.config.get<string>(`${key}_FILE`)?.trim();
    if (!path) return null;
    try {
      return readFileSync(path, 'utf8').trim() || null;
    } catch (err) {
      this.logger.error(`Could not read ${key}_FILE at ${path}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private bool(key: string, fallback: boolean): boolean {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw.trim() === '') return fallback;
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }

  private int(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
