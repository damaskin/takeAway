import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';

import { type XmlElement, buildElement, child, num, parseXml, serializeDocument, text } from '../agroprombank/xml';
import { WEB_RESULT_OK, type WebServiceFunction } from './constants';

/**
 * The Web-платёж wire protocol, framework-free: the MD5 signatures, the
 * payment-page fields, the SOAP envelope of the admin web service and its
 * base64-in-XML-in-base64 responses. Shared by the client and by the sandbox
 * bank, so both sides of the test speak exactly the same dialect.
 */

const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

/**
 * `MD5(p1:p2:…:pN)` as lowercase hex. Every signature in the scheme is this
 * over a fixed order of fields with the MerchantPass last; the bank's sample
 * hashes the UTF-8 bytes. We keep `Desc` ASCII regardless, so the encoding
 * question never decides whether a payment goes through.
 */
export function md5Signature(...parts: Array<string | number>): string {
  return createHash('md5')
    .update(parts.map((p) => String(p)).join(':'), 'utf8')
    .digest('hex');
}

/** Constant-time comparison of two hex signatures, case-insensitive. */
export function signaturesMatch(expected: string, received: string | null | undefined): boolean {
  if (!received) return false;
  const a = Buffer.from(expected.toLowerCase(), 'utf8');
  const b = Buffer.from(received.trim().toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PaymentPageRequest {
  merchantLogin: string;
  merchantPass: string;
  nivid: string;
  /** Minor units (kopecks). */
  sum: number;
  currencyCode: string;
  description: string;
  isTest: boolean;
  lifetimeMinutes: number;
  preauth: boolean;
}

/**
 * Fields for `PaymentStart`, signed
 * `MD5(MerchantLogin:nivid:istest:RequestSum:RequestCurrCode:Desc:MerchantPass)`.
 * Order matters to the hash only; the bank reads the fields by name.
 */
export function paymentPageFields(request: PaymentPageRequest): Record<string, string> {
  const isTest = request.isTest ? '1' : '0';
  return {
    MerchantLogin: request.merchantLogin,
    RequestSum: String(request.sum),
    RequestCurrCode: request.currencyCode,
    nivid: request.nivid,
    Desc: request.description,
    IsTest: isTest,
    LifeTime: String(request.lifetimeMinutes),
    SignatureValue: md5Signature(
      request.merchantLogin,
      request.nivid,
      isTest,
      request.sum,
      request.currencyCode,
      request.description,
      request.merchantPass,
    ),
    ispreauth: request.preauth ? '1' : '0',
  };
}

/** The same request as a GET link — what the TMA and the mobile app open. */
export function paymentPageUrl(paymentUrl: string, fields: Record<string, string>): string {
  const url = new URL(paymentUrl);
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * Description shown on the bank's page and signed into the request. ASCII
 * on purpose: the documentation's sample signs Cyrillic, but does not say in
 * which encoding, and a mismatch would refuse every payment.
 */
export function paymentDescription(orderCode: string): string {
  return `takeAway order ${orderCode}`.replace(/[^\x20-\x7E]/g, '').slice(0, 250);
}

/** Lower-cased, trimmed copy of whatever the bank sent — query string or form. */
export function normalizeParams(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined || first === null) continue;
    out[key.toLowerCase()] = String(first).trim();
  }
  return out;
}

/**
 * Checks the signature on a ResultURL notification:
 * - paid: `MD5(invoiceid:status:paymentsum:paymentcurrency:date:MerchantPass)`
 * - fail: `MD5(invoiceid:status:date:MerchantPass)`
 */
export function verifyResultSignature(params: Record<string, string>, merchantPass: string): boolean {
  const status = params['status'] ?? '';
  const invoiceId = params['invoiceid'] ?? '';
  const date = params['date'] ?? '';
  const expected =
    status === 'paid'
      ? md5Signature(invoiceId, status, params['paymentsum'] ?? '', params['paymentcurrency'] ?? '', date, merchantPass)
      : md5Signature(invoiceId, status, date, merchantPass);
  return signaturesMatch(expected, params['signature'] ?? params['signaturevalue']);
}

/** Signature of an admin web-service call: `MD5(MerchantId:…args:MerchantPass)`. */
export function serviceSignature(merchantId: string, args: Array<string | number>, merchantPass: string): string {
  return md5Signature(merchantId, ...args, merchantPass);
}

/** SOAP 1.1 document/literal call: `<Fn xmlns=ns><Field>…</Field>…</Fn>`. */
export function buildSoapRequest(fn: WebServiceFunction, namespace: string, fields: Record<string, string>): string {
  return serializeDocument({
    type: 'element',
    name: 'soap:Envelope',
    attrs: [{ name: 'xmlns:soap', value: SOAP_ENVELOPE_NS }],
    children: [
      {
        type: 'element',
        name: 'soap:Body',
        attrs: [],
        children: [buildElement(fn, fields, [{ name: 'xmlns', value: namespace }])],
      },
    ],
  });
}

export class WebServiceProtocolError extends Error {
  constructor(
    readonly fn: WebServiceFunction,
    message: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = 'WebServiceProtocolError';
  }
}

/** Matches an element by local name, whatever prefix the bank put on it. */
function localChild(el: XmlElement, localName: string): XmlElement | null {
  const lower = localName.toLowerCase();
  for (const node of el.children) {
    if (node.type !== 'element') continue;
    const name = node.name.toLowerCase();
    if (name === lower || name.endsWith(`:${lower}`)) return node;
  }
  return null;
}

/** `<FnResult>` text out of a SOAP envelope; a fault becomes an error. */
export function unwrapSoapResult(fn: WebServiceFunction, envelopeXml: string): string {
  let envelope: XmlElement;
  try {
    envelope = parseXml(envelopeXml);
  } catch (err) {
    throw new WebServiceProtocolError(fn, `SOAP envelope is not well-formed XML: ${messageOf(err)}`);
  }
  const body = localChild(envelope, 'Body');
  if (!body) throw new WebServiceProtocolError(fn, 'SOAP response has no <Body>');

  const fault = localChild(body, 'Fault');
  if (fault) {
    const reason = text(fault, 'faultstring') ?? text(fault, 'Reason') ?? '';
    throw new WebServiceProtocolError(fn, `SOAP fault: ${reason.trim() || 'no detail'}`);
  }

  const response = body.children.find((n): n is XmlElement => n.type === 'element');
  if (!response) throw new WebServiceProtocolError(fn, 'SOAP <Body> is empty');
  const result = localChild(response, `${fn}Result`);
  if (!result) throw new WebServiceProtocolError(fn, `SOAP response has no <${fn}Result>`);
  return textOfDeep(result).trim();
}

export interface DecodedServiceResponse {
  /** The response document itself — `OperationStateResponse` and the like. */
  document: XmlElement;
  /** Exactly the bytes the bank signed: the decoded content of `<response>`. */
  signedBytes: Buffer | null;
  /** The base64 text of `<response>` as it arrived, for the other signing guess. */
  signedText: string | null;
  /** The bank's signature over `<response>`, decoded. */
  signature: Buffer | null;
}

/**
 * Unpacks a `…Result`: a base64 string carrying
 * `<envelope><response>base64 XML</response><signature>base64</signature></envelope>`.
 *
 * Lenient about the layers, because only the documentation describes them:
 * the outer string may already be XML rather than base64, and a bare response
 * document without the signing envelope is passed through unsigned — the
 * signature check then decides whether that is acceptable.
 */
export function decodeServiceResult(fn: WebServiceFunction, result: string): DecodedServiceResponse {
  const outer = looksLikeXml(result) ? result : decodeBase64Xml(fn, result, 'result');
  let root: XmlElement;
  try {
    root = parseXml(outer);
  } catch (err) {
    throw new WebServiceProtocolError(fn, `result is not well-formed XML: ${messageOf(err)}`);
  }

  if (root.name.toLowerCase() !== 'envelope') {
    return { document: root, signedBytes: null, signedText: null, signature: null };
  }

  const responseText = text(root, 'response')?.trim();
  if (!responseText) throw new WebServiceProtocolError(fn, 'signed envelope carries no <response>');
  const signedBytes = Buffer.from(responseText, 'base64');
  let document: XmlElement;
  try {
    document = parseXml(signedBytes.toString('utf8'));
  } catch (err) {
    throw new WebServiceProtocolError(fn, `<response> is not well-formed XML: ${messageOf(err)}`);
  }
  const signatureText = text(root, 'signature')?.trim();
  return {
    document,
    signedBytes,
    signedText: responseText,
    signature: signatureText ? Buffer.from(signatureText, 'base64') : null,
  };
}

/**
 * Verifies the bank's signature over `<response>` with its certificate.
 *
 * The documentation says what is signed («содержимое узла Response») and
 * with which certificate («сертификат сайта»), not how. This accepts RSA
 * with SHA-256 or SHA-1, over the decoded document or over its base64 text —
 * each is still a signature only the holder of the bank's key can make, so
 * trying the plausible variants does not weaken the check. Returns which one
 * matched, so the logs can pin the real one down after the first live call.
 */
export function verifyServiceSignature(
  decoded: DecodedServiceResponse,
  certificatePem: string,
): { valid: true; variant: string } | { valid: false; reason: string } {
  if (!decoded.signature || !decoded.signedBytes) {
    return { valid: false, reason: 'response is not signed' };
  }
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey(certificatePem);
  } catch (err) {
    return { valid: false, reason: `bank certificate is unreadable: ${messageOf(err)}` };
  }
  const payloads: Array<[string, Buffer]> = [['document', decoded.signedBytes]];
  if (decoded.signedText) payloads.push(['base64', Buffer.from(decoded.signedText, 'utf8')]);
  for (const algorithm of ['sha256', 'sha1']) {
    for (const [label, data] of payloads) {
      try {
        if (verifySignature(algorithm, data, key, decoded.signature)) {
          return { valid: true, variant: `rsa-${algorithm} over ${label}` };
        }
      } catch {
        // An algorithm the key type cannot do — try the next one.
      }
    }
  }
  return { valid: false, reason: 'signature does not match the bank certificate' };
}

export interface ServiceResult {
  code: number;
  description: string;
}

/** `Result/Code` and `Result/Description` of a response document. */
export function readResult(document: XmlElement): ServiceResult {
  const result = child(document, 'Result');
  return {
    code: result ? (num(result, 'Code') ?? 0) : 0,
    description: result ? (text(result, 'Description')?.trim() ?? '') : 'response carries no <Result>',
  };
}

export function isResultOk(result: ServiceResult): boolean {
  return result.code === WEB_RESULT_OK;
}

export interface OperationState {
  state: number | null;
  stateDescription: string | null;
  isTest: boolean;
  /** Minor units. */
  sum: number | null;
  currency: string | null;
  invoiceId: string | null;
  rrn: string | null;
  lastDigits: string | null;
  /** `usepreauth`; `null` when the bank left it out. */
  usePreauth: boolean | null;
  terminalId: string | null;
  authCode: string | null;
  pan: string | null;
}

/** `StateInfo` of GetState, or of the state every other operation returns. */
export function readOperationState(document: XmlElement): OperationState {
  const info = child(document, 'StateInfo') ?? child(document, 'Operation') ?? document;
  const trx = child(info, 'trx');
  return {
    state: num(info, 'state'),
    stateDescription: text(info, 'statedescription')?.trim() || null,
    isTest: num(info, 'istest') === 1,
    sum: num(info, 'sum'),
    currency: text(info, 'currency')?.trim() || null,
    invoiceId: text(info, 'invoiceid')?.trim() || null,
    rrn: text(info, 'rrn')?.trim() || (trx ? text(trx, 'rrn')?.trim() : null) || null,
    lastDigits: text(info, 'lastdgt')?.trim() || null,
    usePreauth: num(info, 'usepreauth') === null ? null : num(info, 'usepreauth') === 1,
    terminalId: text(info, 'terminalid')?.trim() || null,
    authCode: trx ? text(trx, 'authcode')?.trim() || null : null,
    pan: trx ? text(trx, 'pan')?.trim() || null : null,
  };
}

/** Calendar day in Transnistria — CancelOperation only works within the day of payment. */
export function bankDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Chisinau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function looksLikeXml(value: string): boolean {
  // trimStart() drops a byte-order mark too: U+FEFF is ECMAScript whitespace.
  return value.trimStart().startsWith('<');
}

function decodeBase64Xml(fn: WebServiceFunction, value: string, what: string): string {
  const decoded = Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (!looksLikeXml(decoded)) throw new WebServiceProtocolError(fn, `${what} is neither XML nor base64 XML`);
  return decoded;
}

function textOfDeep(el: XmlElement): string {
  let out = '';
  for (const node of el.children) {
    if (node.type === 'text') out += node.value;
    else if (node.type === 'element') out += textOfDeep(node);
  }
  return out;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
