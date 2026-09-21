import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';

import { DEFAULT_ENDPOINT, DEFAULT_NAMESPACE } from './constants';

// Re-exported so existing imports keep working; the definitions live in a
// framework-free module that standalone tooling can also import.
export { CARD_INSTITUTES, DEFAULT_ENDPOINT, DEFAULT_NAMESPACE, type CardInstituteCode } from './constants';

/**
 * Configuration for the Agroprombank («Клевер») recurring-payments gateway.
 *
 * Credentials arrive as PEM either inline (`*_PRIVATE_KEY`, escaped `\n`
 * allowed so it survives a one-line env var) or as a path (`*_PRIVATE_KEY_FILE`)
 * for deployments that mount secrets as files. Files are read once at
 * startup — a rotated key needs a restart, same as every other secret here.
 */
@Injectable()
export class AgroprombankConfig {
  private readonly logger = new Logger(AgroprombankConfig.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.bool('AGROPROMBANK_ENABLED');
  }

  get endpoint(): string {
    return this.config.get<string>('AGROPROMBANK_ENDPOINT')?.trim() || DEFAULT_ENDPOINT;
  }

  get namespace(): string {
    return this.config.get<string>('AGROPROMBANK_NAMESPACE')?.trim() || DEFAULT_NAMESPACE;
  }

  get merchantId(): string | null {
    return this.config.get<string>('AGROPROMBANK_MERCHANT_ID')?.trim() || null;
  }

  /** Terminal id issued by the bank; required by payment and preauth calls. */
  get terminalId(): string | null {
    return this.config.get<string>('AGROPROMBANK_TERMINAL_ID')?.trim() || null;
  }

  get privateKeyPem(): string | null {
    return this.pem('AGROPROMBANK_PRIVATE_KEY');
  }

  /** Merchant certificate — only needed when the bank wants `<KeyInfo>`. */
  get certificatePem(): string | null {
    return this.pem('AGROPROMBANK_CERTIFICATE');
  }

  /** Bank certificate used to verify the signature on every response. */
  get bankCertificatePem(): string | null {
    return this.pem('AGROPROMBANK_BANK_CERTIFICATE');
  }

  get includeKeyInfo(): boolean {
    return this.bool('AGROPROMBANK_INCLUDE_KEYINFO');
  }

  /**
   * Response-signature verification. On by default — turning it off leaves
   * only TLS between us and a forged "payment succeeded", so it is meant for
   * the integration-test window before the bank hands over its certificate.
   */
  get verifyResponses(): boolean {
    const raw = this.config.get<string>('AGROPROMBANK_VERIFY_RESPONSES');
    if (raw === undefined || raw.trim() === '') return true;
    return this.bool('AGROPROMBANK_VERIFY_RESPONSES');
  }

  get timeoutMs(): number {
    return this.int('AGROPROMBANK_TIMEOUT_MS', 30_000);
  }

  /** `istest` flag echoed into payment requests. The bank ignores it for now. */
  get isTest(): boolean {
    return this.bool('AGROPROMBANK_IS_TEST');
  }

  /** How long a customer has to type the SMS one-time password. */
  get bindingTtlMinutes(): number {
    return this.int('AGROPROMBANK_BINDING_TTL_MINUTES', 10);
  }

  /** Max one-time-password attempts before a binding request is burned. */
  get bindingMaxAttempts(): number {
    return this.int('AGROPROMBANK_BINDING_MAX_ATTEMPTS', 3);
  }

  /**
   * Prefix for the `invoiceid` we send to the bank. The identifier must stay
   * unique for the entire life of the merchant contract, so a per-environment
   * prefix keeps a staging deployment from colliding with production.
   */
  get invoicePrefix(): string {
    return this.config.get<string>('AGROPROMBANK_INVOICE_PREFIX')?.trim() ?? '';
  }

  /** True when every mandatory setting for live calls is present. */
  get isConfigured(): boolean {
    return Boolean(this.enabled && this.merchantId && this.terminalId && this.privateKeyPem);
  }

  /** Human-readable list of what is still missing — surfaced in health/logs. */
  missingSettings(): string[] {
    const missing: string[] = [];
    if (!this.merchantId) missing.push('AGROPROMBANK_MERCHANT_ID');
    if (!this.terminalId) missing.push('AGROPROMBANK_TERMINAL_ID');
    if (!this.privateKeyPem) missing.push('AGROPROMBANK_PRIVATE_KEY (or _FILE)');
    if (this.verifyResponses && !this.bankCertificatePem) {
      missing.push('AGROPROMBANK_BANK_CERTIFICATE (or _FILE), or AGROPROMBANK_VERIFY_RESPONSES=false');
    }
    return missing;
  }

  private pem(baseKey: string): string | null {
    const inline = this.config.get<string>(baseKey);
    if (inline && inline.trim()) return inline.replace(/\\n/g, '\n');

    const path = this.config.get<string>(`${baseKey}_FILE`);
    if (!path || !path.trim()) return null;
    try {
      return readFileSync(path.trim(), 'utf8');
    } catch (err) {
      this.logger.error(`Could not read ${baseKey}_FILE at ${path}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private bool(key: string): boolean {
    const raw = this.config.get<string>(key);
    if (!raw) return false;
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
