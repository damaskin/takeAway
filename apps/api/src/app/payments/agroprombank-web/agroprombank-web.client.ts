import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { type AxiosError } from 'axios';

import { AgroprombankWebConfig } from './agroprombank-web.config';
import type { WebServiceFunction } from './constants';
import {
  type OperationState,
  type PaymentPageRequest,
  WebServiceProtocolError,
  buildSoapRequest,
  decodeServiceResult,
  isResultOk,
  paymentPageFields,
  paymentPageUrl,
  readOperationState,
  readResult,
  serviceSignature,
  unwrapSoapResult,
  verifyResultSignature,
  verifyServiceSignature,
} from './protocol';

/** The bank answered and said no — `Result/Code` other than 1. A definitive answer. */
export class AgroprombankWebError extends Error {
  constructor(
    readonly fn: WebServiceFunction,
    readonly code: number,
    readonly description: string,
  ) {
    super(`${fn} failed with code ${code}: ${description}`);
    this.name = 'AgroprombankWebError';
  }
}

/** No usable answer: transport, SOAP fault, malformed or unverifiable response. */
export class AgroprombankWebTransportError extends Error {
  constructor(
    readonly fn: WebServiceFunction,
    message: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = 'AgroprombankWebTransportError';
  }
}

export interface PaymentPage {
  /** POST target for a form, and the base of {@link url}. */
  action: string;
  fields: Record<string, string>;
  /** The same request as a GET link. */
  url: string;
}

/**
 * Talks to Web-платёж: signs the payment-page request, checks the callback's
 * signature, and calls the admin web service (GetState, CancelOperation,
 * RefundOperation, ComplitionOperation).
 *
 * Money meaning lives in `AgroprombankWebService`; this class owns the wire.
 */
@Injectable()
export class AgroprombankWebClient {
  private readonly logger = new Logger(AgroprombankWebClient.name);

  constructor(private readonly config: AgroprombankWebConfig) {}

  paymentPage(
    request: Omit<PaymentPageRequest, 'merchantLogin' | 'merchantPass' | 'isTest' | 'lifetimeMinutes'>,
  ): PaymentPage {
    const { merchantLogin, merchantPass } = this.requireCredentials();
    const fields = paymentPageFields({
      ...request,
      merchantLogin,
      merchantPass,
      isTest: this.config.isTest,
      lifetimeMinutes: this.config.lifetimeMinutes,
    });
    return { action: this.config.paymentUrl, fields, url: paymentPageUrl(this.config.paymentUrl, fields) };
  }

  /** Whether a ResultURL notification really comes from someone holding our MerchantPass. */
  verifyNotification(params: Record<string, string>): boolean {
    const pass = this.config.merchantPass;
    return pass !== null && verifyResultSignature(params, pass);
  }

  getState(invoiceId: string): Promise<OperationState> {
    return this.call('GetState', invoiceId, []);
  }

  /** Cancels the operation outright — only within the day of payment, per the bank. */
  cancel(invoiceId: string): Promise<OperationState> {
    return this.call('CancelOperation', invoiceId, []);
  }

  refund(invoiceId: string, amountCents: number): Promise<OperationState> {
    return this.call('RefundOperation', invoiceId, [['refundAmount', amountCents]]);
  }

  /** Captures a preauthorization, for up to 110% of the amount held. */
  complete(invoiceId: string, amountCents: number): Promise<OperationState> {
    return this.call('ComplitionOperation', invoiceId, [['complitionAmount', amountCents]]);
  }

  /**
   * One admin web-service call. Every operation takes `MerchantId`,
   * `InvoiceId`, its own arguments and a `Signature` over the same values in
   * that order, and answers with the operation's state.
   */
  private async call(
    fn: WebServiceFunction,
    invoiceId: string,
    args: Array<[string, string | number]>,
  ): Promise<OperationState> {
    const { merchantId, merchantPass } = this.requireCredentials();
    const fields: Record<string, string> = { MerchantId: merchantId, InvoiceId: invoiceId };
    for (const [name, value] of args) fields[name] = String(value);
    fields['Signature'] = serviceSignature(merchantId, [invoiceId, ...args.map(([, value]) => value)], merchantPass);

    let body: string;
    try {
      const response = await axios.post<string>(
        this.config.serviceUrl,
        buildSoapRequest(fn, this.config.namespace, fields),
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            // Same shape the bank's other service accepts in production.
            SOAPAction: `${this.config.namespace.replace(/\/$/, '')}/${fn}`,
          },
          timeout: this.config.timeoutMs,
          responseType: 'text',
          transitional: { silentJSONParsing: false, forcedJSONParsing: false, clarifyTimeoutError: true },
          // A SOAP fault arrives as HTTP 500 with a body worth reading.
          validateStatus: (status) => status < 600,
        },
      );
      body = response.data;
    } catch (err) {
      throw new AgroprombankWebTransportError(fn, describeAxiosError(err));
    }

    let state: OperationState;
    try {
      const decoded = decodeServiceResult(fn, unwrapSoapResult(fn, body));
      this.assertSignature(fn, decoded);
      const result = readResult(decoded.document);
      if (!isResultOk(result)) {
        throw new AgroprombankWebError(fn, result.code, result.description || `bank returned code ${result.code}`);
      }
      state = readOperationState(decoded.document);
    } catch (err) {
      if (err instanceof AgroprombankWebError || err instanceof AgroprombankWebTransportError) throw err;
      if (err instanceof WebServiceProtocolError) throw new AgroprombankWebTransportError(fn, err.message);
      throw err;
    }
    return state;
  }

  private assertSignature(fn: WebServiceFunction, decoded: ReturnType<typeof decodeServiceResult>): void {
    if (!this.config.verifyResponses) {
      this.logger.warn(
        `[${fn}] bank signature check is OFF (AGROPROMBANK_WEB_VERIFY_RESPONSES=false) — ` +
          'only TLS stands between us and a forged payment state',
      );
      return;
    }
    const certificate = this.config.bankCertificatePem;
    if (!certificate) throw new AgroprombankWebTransportError(fn, 'bank certificate is missing');
    const verdict = verifyServiceSignature(decoded, certificate);
    if (!verdict.valid) throw new AgroprombankWebTransportError(fn, `bank signature: ${verdict.reason}`);
    this.logger.debug(`[${fn}] bank signature verified (${verdict.variant})`);
  }

  private requireCredentials(): { merchantLogin: string; merchantId: string; merchantPass: string } {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Web-платёж is disabled on this deployment');
    }
    const missing = this.config.missingSettings();
    if (missing.length > 0) {
      throw new ServiceUnavailableException(`Web-платёж is not configured: missing ${missing.join(', ')}`);
    }
    return {
      merchantLogin: this.config.merchantLogin as string,
      merchantId: this.config.merchantId as string,
      merchantPass: this.config.merchantPass as string,
    };
  }
}

function describeAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const axiosError = err as AxiosError;
    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') return 'request timed out';
    if (axiosError.response) return `HTTP ${axiosError.response.status} from the bank`;
    return axiosError.message;
  }
  return err instanceof Error ? err.message : String(err);
}
