import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';

import {
  type CardPaymentFlow,
  DEFAULT_WEB_NAMESPACE,
  DEFAULT_WEB_PAYMENT_URL,
  DEFAULT_WEB_SERVICE_URL,
  type ReturnTarget,
  resolveCardPaymentFlow,
} from './constants';

/**
 * Configuration for ЗАО «Агропромбанк» «Web-платёж» — the bank's hosted
 * payment page.
 *
 * A separate merchant registration from the tokenized flow: the bank issues a
 * MerchantLogin and a MerchantPass for it, and the pass is the whole security
 * of the page — every request and every callback is an MD5 over the fields and
 * the pass. Treat it as a secret on a par with a private key, which is why it
 * can come from a file as well as from the environment.
 */
@Injectable()
export class AgroprombankWebConfig {
  private readonly logger = new Logger(AgroprombankWebConfig.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.bool('AGROPROMBANK_WEB_ENABLED', false);
  }

  /** `MerchantLogin` on the payment page. */
  get merchantLogin(): string | null {
    return this.str('AGROPROMBANK_WEB_MERCHANT_LOGIN');
  }

  /**
   * `MerchantId` in the admin web service. The documentation describes it as
   * "the login received at registration", so it defaults to the login.
   */
  get merchantId(): string | null {
    return this.str('AGROPROMBANK_WEB_MERCHANT_ID') ?? this.merchantLogin;
  }

  get merchantPass(): string | null {
    const inline = this.config.get<string>('AGROPROMBANK_WEB_MERCHANT_PASS');
    if (inline && inline.trim()) return inline.trim();
    return this.file('AGROPROMBANK_WEB_MERCHANT_PASS_FILE')?.trim() || null;
  }

  get paymentUrl(): string {
    return this.str('AGROPROMBANK_WEB_PAYMENT_URL') ?? DEFAULT_WEB_PAYMENT_URL;
  }

  /** `APB.SV.WebPayment.AgentService.asmx` — GetState, cancel, refund, completion. */
  get serviceUrl(): string {
    return this.str('AGROPROMBANK_WEB_SERVICE_URL') ?? DEFAULT_WEB_SERVICE_URL;
  }

  /**
   * Target namespace of the admin web service, also the SOAPAction prefix.
   * The WSDL is not reachable from outside the bank, so the default is the
   * namespace the bank's other service uses — to be confirmed against the WSDL.
   */
  get namespace(): string {
    return this.str('AGROPROMBANK_WEB_NAMESPACE') ?? DEFAULT_WEB_NAMESPACE;
  }

  /** `IsTest=1`: the bank runs the page in test mode and money does not move. */
  get isTest(): boolean {
    return this.bool('AGROPROMBANK_WEB_IS_TEST', false);
  }

  /**
   * `LifeTime` of an invoice on the bank's page, in minutes. Kept no longer
   * than the unpaid-order TTL by default, so an order is not expired while its
   * customer is still typing their card in.
   */
  get lifetimeMinutes(): number {
    return this.int('AGROPROMBANK_WEB_LIFETIME_MINUTES', 15);
  }

  /**
   * `ispreauth=1`: block the amount at checkout and take it when the store
   * accepts the order. On by default; a merchant whose contract has no
   * preauthorization turns it off and is charged at checkout.
   */
  get holdUntilAccepted(): boolean {
    return this.bool('AGROPROMBANK_WEB_HOLD_UNTIL_ACCEPTED', true);
  }

  /** Bank certificate the admin web service's signatures are checked against. */
  get bankCertificatePem(): string | null {
    const inline = this.config.get<string>('AGROPROMBANK_WEB_BANK_CERT');
    if (inline && inline.trim()) return inline.replace(/\\n/g, '\n');
    return this.file('AGROPROMBANK_WEB_BANK_CERT_FILE');
  }

  /**
   * Check the bank's signature on every admin web-service response. On by
   * default. The documentation names the certificate («сертификат сайта») but
   * not the algorithm, so the verifier accepts RSA-SHA256 or RSA-SHA1 over the
   * response; switching it off leaves only TLS between us and a forged
   * "paid", and every call then logs a warning.
   */
  get verifyResponses(): boolean {
    return this.bool('AGROPROMBANK_WEB_VERIFY_RESPONSES', true);
  }

  get timeoutMs(): number {
    return this.int('AGROPROMBANK_WEB_TIMEOUT_MS', 20_000);
  }

  /**
   * Same prefix and sequence as the tokenized flow: one numbering for every
   * invoice we ever send the bank, digits only.
   */
  get invoicePrefix(): string {
    return this.config.get<string>('AGROPROMBANK_INVOICE_PREFIX')?.trim() ?? '';
  }

  /** Which checkout clients run — see {@link resolveCardPaymentFlow}. */
  get cardPaymentFlow(): CardPaymentFlow {
    return resolveCardPaymentFlow({
      wanted: this.config.get<string>('CARD_PAYMENT_FLOW'),
      tokenEnabled: this.bool('AGROPROMBANK_ENABLED', false),
      webEnabled: this.enabled,
    });
  }

  /** Where the customer lands after the bank's page, per client. */
  returnBase(target: ReturnTarget): string | null {
    switch (target) {
      case 'web':
        return this.str('PUBLIC_WEB_URL');
      case 'tma':
        return this.str('PUBLIC_TMA_URL');
      case 'mobile':
        return this.str('MOBILE_PAYMENT_RETURN_URL') ?? 'takeaway://pay';
    }
  }

  get isConfigured(): boolean {
    return this.enabled && this.missingSettings().length === 0;
  }

  missingSettings(): string[] {
    const missing: string[] = [];
    if (!this.merchantLogin) missing.push('AGROPROMBANK_WEB_MERCHANT_LOGIN');
    if (!this.merchantPass) missing.push('AGROPROMBANK_WEB_MERCHANT_PASS (or _FILE)');
    if (this.verifyResponses && !this.bankCertificatePem) {
      missing.push('AGROPROMBANK_WEB_BANK_CERT_FILE, or AGROPROMBANK_WEB_VERIFY_RESPONSES=false');
    }
    if (!/^\d*$/.test(this.invoicePrefix)) {
      missing.push('AGROPROMBANK_INVOICE_PREFIX of digits only');
    }
    return missing;
  }

  private str(key: string): string | null {
    return this.config.get<string>(key)?.trim() || null;
  }

  private file(key: string): string | null {
    const path = this.config.get<string>(key)?.trim();
    if (!path) return null;
    try {
      return readFileSync(path, 'utf8');
    } catch (err) {
      this.logger.error(`Could not read ${key} at ${path}: ${err instanceof Error ? err.message : err}`);
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
