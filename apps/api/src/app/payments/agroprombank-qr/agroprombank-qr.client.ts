import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios, { type AxiosError } from 'axios';

import { AgroprombankQrConfig } from './agroprombank-qr.config';
import { QR_CURRENCY_CODE, type QrServiceFunction } from './constants';
import {
  type QrCredentials,
  QrFault,
  type QrPaymentRecord,
  QrProtocolError,
  buildQrRequest,
  parseQrPaymentsResult,
  readPaymentId,
  readQrResponse,
  selectPaymentRecord,
  soapAction,
} from './protocol';

/** The bank answered and refused — a SOAP fault. A definitive answer about this call. */
export class AgroprombankQrError extends Error {
  constructor(
    readonly fn: QrServiceFunction,
    readonly description: string,
  ) {
    super(`${fn} refused: ${description}`);
    this.name = 'AgroprombankQrError';
  }
}

/** No usable answer: transport, timeout, or a response that could not be read. */
export class AgroprombankQrTransportError extends Error {
  constructor(
    readonly fn: QrServiceFunction,
    message: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = 'AgroprombankQrTransportError';
  }
}

/** The bank's handles on a paid invoice that `ReversePayment` needs. */
export interface QrPaymentRefs {
  qrPaymentId: string | null;
  rrn: string | null;
}

type Args = ReadonlyArray<readonly [string, string]>;

/**
 * Talks to the bank's QR web service (`QRMobileService.asmx`): SOAP 1.1 with
 * the `QRMCredentials` header on every call. Money meaning lives in
 * `AgroprombankQrService`; this class owns the wire.
 *
 * Nothing the service answers is signed — TLS and our login are what make the
 * answers trustworthy, which is why the outcome of a payment is always read
 * from here and never from the callback.
 */
@Injectable()
export class AgroprombankQrClient {
  constructor(private readonly config: AgroprombankQrConfig) {}

  /**
   * `CreatePaymentID`: an invoice for `amountKopecks` in рубль ПМР under our
   * external id. Returns the bank's id of the payment.
   */
  async createPaymentId(extid: string, amountKopecks: number): Promise<string> {
    const result = await this.call('CreatePaymentID', (terminal) => [
      ['terminalid', terminal],
      ['amount', String(amountKopecks)],
      ['currencycode', QR_CURRENCY_CODE],
      ['extid', extid],
    ]);
    try {
      return readPaymentId('CreatePaymentID', result);
    } catch (err) {
      throw translate('CreatePaymentID', err);
    }
  }

  /** `ClosePaymentExtId`: the invoice is no longer offered. Returns nothing. */
  async closePaymentExtId(extid: string): Promise<void> {
    await this.call('ClosePaymentExtId', (terminal) => [
      ['terminalid', terminal],
      ['externalid', extid],
    ]);
  }

  /** `GetPaymentStateExtId`: the bank's record of our invoice, or `null` when it returns none. */
  async getPaymentStateExtId(extid: string): Promise<QrPaymentRecord | null> {
    const result = await this.call('GetPaymentStateExtId', (terminal) => [
      ['terminalid', terminal],
      ['externalid', extid],
    ]);
    try {
      return selectPaymentRecord(parseQrPaymentsResult('GetPaymentStateExtId', result), extid);
    } catch (err) {
      throw translate('GetPaymentStateExtId', err);
    }
  }

  /**
   * `ReversePayment`: gives a paid invoice's money back. The arguments carry
   * the bank's own names — `qrterminal`, `paymetid` (sic), `rrn`. Returns
   * nothing; a fault is a refusal.
   */
  async reversePayment(qrPaymentId: string, rrn: string): Promise<void> {
    await this.call('ReversePayment', (terminal) => [
      ['qrterminal', terminal],
      ['paymetid', qrPaymentId],
      ['rrn', rrn],
    ]);
  }

  /**
   * Gives the money of our invoice back. The bank's payment id and RRN come
   * from `known`, or from the bank's record when we do not have them.
   *
   * `ReversePayment` answers nothing, so the invoice is read back afterwards
   * and returned — for the log, until the bank says which `state` a reversal
   * leaves (question 6). `null` when that read did not work; the reversal
   * itself went through either way.
   */
  async reverseInvoice(extid: string, known: QrPaymentRefs): Promise<QrPaymentRecord | null> {
    let { qrPaymentId, rrn } = known;
    if (!qrPaymentId || !rrn) {
      const record = await this.getPaymentStateExtId(extid);
      qrPaymentId = qrPaymentId ?? record?.qrPaymentId ?? null;
      rrn = rrn ?? record?.rrn ?? null;
    }
    if (!qrPaymentId || !rrn) {
      throw new AgroprombankQrError('ReversePayment', `the bank has no paid payment with an RRN for invoice ${extid}`);
    }
    await this.reversePayment(qrPaymentId, rrn);
    return this.getPaymentStateExtId(extid).catch(() => null);
  }

  private async call(
    fn: QrServiceFunction,
    args: (terminal: string) => Args,
  ): Promise<ReturnType<typeof readQrResponse>> {
    const { terminal, credentials } = this.requireSettings();
    let body: string;
    try {
      const response = await axios.post<string>(
        this.config.serviceUrl,
        buildQrRequest(fn, this.config.namespace, credentials, args(terminal)),
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: soapAction(this.config.namespace, fn),
          },
          timeout: this.config.timeoutMs,
          responseType: 'text',
          transitional: { silentJSONParsing: false, forcedJSONParsing: false, clarifyTimeoutError: true },
          // A SOAP fault arrives as HTTP 500 with a body worth reading.
          validateStatus: (status) => status < 600,
        },
      );
      body = response.data;
      if (response.status >= 400 && !/Fault/i.test(body)) {
        throw new AgroprombankQrTransportError(fn, `HTTP ${response.status} from the bank`);
      }
    } catch (err) {
      if (err instanceof AgroprombankQrTransportError) throw err;
      throw new AgroprombankQrTransportError(fn, describeAxiosError(err));
    }

    try {
      return readQrResponse(fn, body);
    } catch (err) {
      throw translate(fn, err);
    }
  }

  private requireSettings(): { terminal: string; credentials: QrCredentials } {
    const missing = this.config.missingSettings();
    if (missing.length > 0) {
      throw new ServiceUnavailableException(`The QR payment is not configured: missing ${missing.join(', ')}`);
    }
    return {
      terminal: this.config.terminalId as string,
      credentials: {
        login: this.config.login ?? '',
        password: this.config.password ?? '',
        externalToken: this.config.externalToken ?? '',
      },
    };
  }
}

function translate(fn: QrServiceFunction, err: unknown): Error {
  if (err instanceof QrFault) return new AgroprombankQrError(fn, err.faultString);
  if (err instanceof QrProtocolError) return new AgroprombankQrTransportError(fn, err.message);
  return err instanceof Error ? err : new AgroprombankQrTransportError(fn, String(err));
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
