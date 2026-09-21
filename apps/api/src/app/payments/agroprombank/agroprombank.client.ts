import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { AgroprombankConfig } from './agroprombank.config';
import {
  type XmlElement,
  type XmlFieldValue,
  buildElement,
  child,
  num,
  parseXml,
  serializeDocument,
  text,
  textOf,
} from './xml';
import { signXml, verifyXml } from './xmldsig';

/** Operations exposed by MerchantCAPService.asmx, spelled as in the WSDL. */
export type AgroFunction =
  | 'NewTokenRequest'
  | 'ProcessTokenRequest'
  | 'CheckToken'
  | 'ProcessCardAutoPayment'
  | 'DeactivateToken'
  | 'ReverseOperation'
  | 'RefundOperation'
  // The bank's WSDL really does misspell this one; do not "fix" it.
  | 'CompletePreAuthorizaion'
  | 'GetOperations'
  | 'GetOperation'
  | 'CheckOperation';

const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

/** `result` is `1` on success; anything else is a bank-side error code. */
export const AGRO_RESULT_OK = 1;

export class AgroprombankError extends Error {
  constructor(
    readonly fn: AgroFunction,
    readonly code: number,
    readonly description: string,
  ) {
    super(`${fn} failed with code ${code}: ${description}`);
    this.name = 'AgroprombankError';
  }
}

/** Transport, signature or protocol failure — as opposed to a business error. */
export class AgroprombankTransportError extends Error {
  constructor(
    readonly fn: AgroFunction,
    message: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = 'AgroprombankTransportError';
  }
}

/**
 * Low-level client for the Agroprombank merchant service.
 *
 * Every operation has the same shape — `Fn(merchantId, request)` where
 * `request` is a signed XML document and the result is another signed XML
 * document. This class owns that envelope: signing, transport, signature
 * verification and the `result` code check. Business meaning lives in
 * {@link AgroprombankService}.
 */
@Injectable()
export class AgroprombankClient {
  private readonly logger = new Logger(AgroprombankClient.name);

  constructor(private readonly config: AgroprombankConfig) {}

  /**
   * Signs `fields`, calls `fn` and returns the verified response root.
   * Throws {@link AgroprombankError} when the bank reports `result != 1`.
   */
  async invoke(fn: AgroFunction, fields: Record<string, XmlFieldValue>): Promise<XmlElement> {
    const root = await this.invokeRaw(fn, fields);
    const result = num(root, 'result');
    if (result !== AGRO_RESULT_OK) {
      const code = num(root, 'errorcode') ?? result ?? 0;
      const description = text(root, 'error')?.trim() || describeResult(result);
      throw new AgroprombankError(fn, code, description);
    }
    return root;
  }

  /**
   * Same as {@link invoke} but returns the response even when `result != 1`.
   * Used by reconciliation, which needs to record a refusal rather than throw.
   */
  async invokeRaw(fn: AgroFunction, fields: Record<string, XmlFieldValue>): Promise<XmlElement> {
    const { merchantId, privateKeyPem } = this.requireCredentials();

    const request = signXml(buildElement('root', fields), {
      privateKeyPem,
      certificatePem: this.config.certificatePem,
      includeKeyInfo: this.config.includeKeyInfo,
    });

    const responseXml = await this.post(fn, merchantId, request);
    let root: XmlElement;
    try {
      root = parseXml(responseXml);
    } catch (err) {
      throw new AgroprombankTransportError(fn, `response is not well-formed XML: ${messageOf(err)}`);
    }

    this.assertResponseSignature(fn, responseXml);
    return root;
  }

  /** Throws unless the deployment holds everything needed for a live call. */
  private requireCredentials(): { merchantId: string; privateKeyPem: string } {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Agroprombank payments are disabled on this deployment');
    }
    const missing = this.config.missingSettings();
    if (missing.length > 0) {
      throw new ServiceUnavailableException(`Agroprombank is not configured: missing ${missing.join(', ')}`);
    }
    return {
      merchantId: this.config.merchantId as string,
      privateKeyPem: this.config.privateKeyPem as string,
    };
  }

  private assertResponseSignature(fn: AgroFunction, responseXml: string): void {
    const bankCertificate = this.config.bankCertificatePem;
    if (!this.config.verifyResponses) {
      this.logger.warn(`[${fn}] response signature check is disabled (AGROPROMBANK_VERIFY_RESPONSES=false)`);
      return;
    }
    if (!bankCertificate) {
      throw new AgroprombankTransportError(fn, 'bank certificate is missing, cannot verify the response signature');
    }
    const verdict = verifyXml(responseXml, bankCertificate);
    if (!verdict.valid) {
      throw new AgroprombankTransportError(fn, `response signature is invalid: ${verdict.reason}`);
    }
  }

  /** Wraps the signed request in a SOAP 1.1 envelope and unwraps the result. */
  private async post(fn: AgroFunction, merchantId: string, request: string): Promise<string> {
    const envelope = serializeDocument({
      type: 'element',
      name: 'soap:Envelope',
      attrs: [{ name: 'xmlns:soap', value: SOAP_ENVELOPE_NS }],
      children: [
        {
          type: 'element',
          name: 'soap:Body',
          attrs: [],
          children: [buildElement(fn, { merchantId, request }, [{ name: 'xmlns', value: this.config.namespace }])],
        },
      ],
    });

    let body: string;
    try {
      const response = await axios.post<string>(this.config.endpoint, envelope, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `${this.config.namespace}/${fn}`,
        },
        timeout: this.config.timeoutMs,
        responseType: 'text',
        transitional: { silentJSONParsing: false, forcedJSONParsing: false, clarifyTimeoutError: true },
      });
      body = response.data;
    } catch (err) {
      throw new AgroprombankTransportError(fn, describeAxiosError(err));
    }

    return unwrapSoapResult(fn, body);
  }
}

/** Extracts `<FnResult>` from a SOAP envelope, surfacing faults as errors. */
export function unwrapSoapResult(fn: AgroFunction, envelopeXml: string): string {
  let envelope: XmlElement;
  try {
    envelope = parseXml(envelopeXml);
  } catch (err) {
    throw new AgroprombankTransportError(fn, `SOAP envelope is not well-formed XML: ${messageOf(err)}`);
  }

  const body = child(envelope, 'soap:Body') ?? child(envelope, 'Body') ?? child(envelope, 'soap12:Body');
  if (!body) throw new AgroprombankTransportError(fn, 'SOAP response has no <Body>');

  const fault = child(body, 'soap:Fault') ?? child(body, 'Fault') ?? child(body, 'soap12:Fault');
  if (fault) {
    const reason = text(fault, 'faultstring') ?? text(fault, 'Reason') ?? textOf(fault).trim();
    throw new AgroprombankTransportError(fn, `SOAP fault: ${reason || 'no detail'}`);
  }

  const responseNode = body.children.find((node): node is XmlElement => node.type === 'element');
  if (!responseNode) throw new AgroprombankTransportError(fn, 'SOAP <Body> is empty');

  const result = text(responseNode, `${fn}Result`);
  if (result === null) {
    throw new AgroprombankTransportError(fn, `SOAP response has no <${fn}Result>`);
  }
  return result;
}

function describeResult(result: number | null): string {
  if (result === null) return 'response carries no <result> element';
  return `bank returned result=${result}`;
}

function describeAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const axiosError = err as AxiosError;
    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') return 'request timed out';
    if (axiosError.response) {
      return `HTTP ${axiosError.response.status} from the bank gateway`;
    }
    return axiosError.message;
  }
  return messageOf(err);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
