import { type XmlElement, type XmlNode, parseXml, serializeDocument, textOf } from '../agroprombank/xml';
import { QR_NO_DEVICE, QR_STATE, type QrServiceFunction } from './constants';

/**
 * The «Мобильный платёж» wire protocol, framework-free: the SOAP 1.1 envelope
 * with its `QRMCredentials` header, the answers (a value, nothing, or a SOAP
 * fault), the `Payments/Payment` XML the state calls and the callback carry,
 * and the text of the QR code. Shared by the client and by the sandbox bank,
 * so both sides of the test speak exactly the same dialect.
 */

const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

/** Who we are to the bank: a login and password, or the token it may issue instead. */
export interface QrCredentials {
  login: string;
  password: string;
  externalToken: string;
}

/**
 * The `QRMCredentials` header as the documentation asks of a non-mobile
 * client: `DeviceId` and `PushId` `-1`; with an `ExternalToken` the login and
 * password go out empty, without one the token does.
 */
export function credentialsHeader(credentials: QrCredentials, namespace: string): XmlElement {
  const token = credentials.externalToken;
  return element(
    'QRMCredentials',
    [
      leaf('Login', token ? '' : credentials.login),
      leaf('Password', token ? '' : credentials.password),
      leaf('DeviceId', QR_NO_DEVICE),
      leaf('PushId', QR_NO_DEVICE),
      leaf('ExternalToken', token),
    ],
    [{ name: 'xmlns', value: namespace }],
  );
}

/**
 * SOAP 1.1 document/literal call. The arguments go out in the order given —
 * the order the documentation lists them in, which is what an ASMX service
 * expects — with the bank's own names, typos included (`paymetid`).
 */
export function buildQrRequest(
  fn: QrServiceFunction,
  namespace: string,
  credentials: QrCredentials,
  args: ReadonlyArray<readonly [string, string]>,
): string {
  return serializeDocument(
    element(
      'soap:Envelope',
      [
        element('soap:Header', [credentialsHeader(credentials, namespace)]),
        element('soap:Body', [
          element(
            fn,
            args.map(([name, value]) => leaf(name, value)),
            [{ name: 'xmlns', value: namespace }],
          ),
        ]),
      ],
      [{ name: 'xmlns:soap', value: SOAP_ENVELOPE_NS }],
    ),
  );
}

/** `SOAPAction`: the namespace and the function name, as an ASMX service names its operations. */
export function soapAction(namespace: string, fn: QrServiceFunction): string {
  return namespace.endsWith('/') ? `${namespace}${fn}` : `${namespace}/${fn}`;
}

/** The bank answered with a SOAP fault — it refused, and said why. */
export class QrFault extends Error {
  constructor(
    readonly fn: QrServiceFunction,
    readonly faultString: string,
  ) {
    super(`${fn}: ${faultString}`);
    this.name = 'QrFault';
  }
}

/** The answer could not be read: not XML, not SOAP, or not the response asked for. */
export class QrProtocolError extends Error {
  constructor(
    readonly fn: QrServiceFunction | 'callback',
    message: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = 'QrProtocolError';
  }
}

/**
 * Reads a SOAP answer. Returns the `<FnResult>` element, or `null` for the
 * functions that return nothing (`ClosePaymentExtId`, `ReversePayment`): their
 * success is an empty `<FnResponse/>`. A fault becomes {@link QrFault}.
 *
 * The result is looked for by name anywhere inside the response element: the
 * documentation itself wraps `CreatePaymentIDResult` in `CreatePaymentResponse`.
 */
export function readQrResponse(fn: QrServiceFunction, envelopeXml: string): XmlElement | null {
  let envelope: XmlElement;
  try {
    envelope = parseXml(envelopeXml);
  } catch (err) {
    throw new QrProtocolError(fn, `SOAP envelope is not well-formed XML: ${messageOf(err)}`);
  }
  const body = localChild(envelope, 'Body');
  if (!body) throw new QrProtocolError(fn, 'SOAP response has no <Body>');

  const fault = localChild(body, 'Fault');
  if (fault) {
    const reason = localChild(fault, 'faultstring') ?? localChild(fault, 'Reason');
    throw new QrFault(fn, (reason ? textOf(reason) : '').trim() || 'no detail');
  }

  const response = firstElement(body);
  if (!response) throw new QrProtocolError(fn, 'SOAP <Body> is empty');
  return findLocal(response, `${fn}Result`);
}

/** `CreatePaymentIDResult`: the bank's id of the new payment, a positive decimal. */
export function readPaymentId(fn: QrServiceFunction, result: XmlElement | null): string {
  const raw = result ? textOf(result).trim() : '';
  const match = /^(\d+)(?:[.,]0+)?$/.exec(raw);
  if (!match?.[1] || /^0+$/.test(match[1])) {
    throw new QrFault(
      fn,
      raw ? `the bank returned "${raw}" instead of a payment id` : 'the bank returned no payment id',
    );
  }
  return match[1].replace(/^0+/, '');
}

/** One `<Payment>` of the state XML or of the callback. */
export interface QrPaymentRecord {
  /** The bank's id of the payment (`qrpaymentid`) — `ReversePayment` takes it as `paymetid`. */
  qrPaymentId: string | null;
  terminalId: string | null;
  /** Our invoice id (`externalid`). */
  externalId: string | null;
  /** {@link QR_STATE}. */
  state: number | null;
  stateDescription: string | null;
  /** As the bank wrote it; rubles or kopecks — see {@link matchPaidAmount}. */
  amount: string | null;
  transactionAmount: string | null;
  currencyCode: string | null;
  transactionCurrency: string | null;
  /** RRN of the card transaction (`trxreferencenumber`) — `ReversePayment` needs it. */
  rrn: string | null;
  paymentDate: string | null;
  createDate: string | null;
}

/**
 * Parses the `Payments` XML of `GetPaymentState*`, `GetPayments` and the
 * callback. Lenient about the wrapping — a bare `<Payment>`, or `<Payment>`
 * elements deeper down — and an empty answer is no payments at all. Not
 * well-formed XML is a {@link QrProtocolError}.
 */
export function parseQrPayments(fn: QrServiceFunction | 'callback', xml: string | null | undefined): QrPaymentRecord[] {
  const source = xml?.trim();
  if (!source) return [];
  let root: XmlElement;
  try {
    root = parseXml(source);
  } catch (err) {
    throw new QrProtocolError(fn, `payment state is not well-formed XML: ${messageOf(err)}`);
  }
  return collectPayments(root).map(readPaymentRecord);
}

/**
 * The state XML of a `Result` element: the bank sends it as a string, so it
 * usually arrives escaped as text; a service that inlines it as elements is
 * read the same way.
 */
export function parseQrPaymentsResult(fn: QrServiceFunction, result: XmlElement | null): QrPaymentRecord[] {
  if (!result) return [];
  if (result.children.some((n) => n.type === 'element')) {
    return result.children
      .filter((n): n is XmlElement => n.type === 'element')
      .flatMap((n) => collectPayments(n))
      .map(readPaymentRecord);
  }
  return parseQrPayments(fn, textOf(result));
}

/**
 * The record of one invoice among those the bank returned: ours by external
 * id (any record when the bank left the id out), the paid one first should
 * the bank list the same invoice twice.
 */
export function selectPaymentRecord(records: readonly QrPaymentRecord[], externalId: string): QrPaymentRecord | null {
  const ours = records.filter((r) => r.externalId === null || r.externalId === externalId);
  return ours.find((r) => r.state === QR_STATE.PAID) ?? ours[0] ?? null;
}

export type AmountReading = 'kopecks' | 'rubles';

export type AmountCheck =
  | { matches: true; readings: Partial<Record<'amount' | 'transactionamount', AmountReading>> }
  | { matches: false; reason: string };

/**
 * Whether the bank was paid what the invoice asked for.
 *
 * The documentation gives `CreatePaymentID` its amount in kopecks but says
 * nothing about the units of `amount` and `transactionamount` in the state
 * XML (question 4 to the bank; its example reads `1`). Both readings are
 * accepted, each field on its own, and the one that matched is returned for
 * the log, so the first live payment settles the question. A currency other
 * than `000`, or a sum that fits neither reading, is a mismatch. A record that
 * carries no sum at all cannot contradict the invoice, which fixed the sum.
 */
export function matchPaidAmount(record: QrPaymentRecord, expectedKopecks: number, currencyCode: string): AmountCheck {
  for (const [label, code] of [
    ['currencycode', record.currencyCode],
    ['transactioncurrency', record.transactionCurrency],
  ] as const) {
    if (code !== null && code !== '' && code !== currencyCode) {
      return { matches: false, reason: `${label} ${code} instead of ${currencyCode}` };
    }
  }

  const readings: Partial<Record<'amount' | 'transactionamount', AmountReading>> = {};
  for (const [label, raw] of [
    ['amount', record.amount],
    ['transactionamount', record.transactionAmount],
  ] as const) {
    if (raw === null || raw.trim() === '') continue;
    const reading = readAmount(raw, expectedKopecks);
    if (!reading) return { matches: false, reason: `${label} ${raw} for an invoice of ${expectedKopecks} kopecks` };
    readings[label] = reading;
  }
  return { matches: true, readings };
}

function readAmount(raw: string, expectedKopecks: number): AmountReading | null {
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  if (value === expectedKopecks) return 'kopecks';
  const kopecks = value * 100;
  if (Math.abs(kopecks - expectedKopecks) < 1e-6) return 'rubles';
  return null;
}

/** The sum in rubles with two decimals: `1250` → `12.50`. */
export function formatRubles(kopecks: number): string {
  return (kopecks / 100).toFixed(2);
}

/**
 * The text of the QR code for an invoice, from `AGROPROMBANK_QR_CODE_FORMAT`:
 * `{terminal}`, `{rub}` (`12.50`), `{kop}` (`1250`) and `{extid}`. The bank's
 * format is `QRT…:<сумма>:<внешний идентификатор>:…`, every part after the
 * terminal optional (question 1 to the bank).
 */
export function formatQrCode(
  format: string,
  values: { terminal: string; amountKopecks: number; extid: string },
): string {
  return format
    .replaceAll('{terminal}', values.terminal)
    .replaceAll('{rub}', formatRubles(values.amountKopecks))
    .replaceAll('{kop}', String(values.amountKopecks))
    .replaceAll('{extid}', values.extid);
}

/**
 * The link that opens the bank's app on the same phone, from
 * `AGROPROMBANK_QR_APP_LINK`: `{code}` (the QR text), `{extid}` and
 * `{terminal}`, each URL-encoded. `null` when no link is configured.
 */
export function formatAppLink(
  template: string | null,
  values: { code: string; extid: string; terminal: string },
): string | null {
  if (!template) return null;
  return template
    .replaceAll('{code}', encodeURIComponent(values.code))
    .replaceAll('{extid}', encodeURIComponent(values.extid))
    .replaceAll('{terminal}', encodeURIComponent(values.terminal));
}

/** `Payments` XML in the bank's shape — what the sandbox answers and calls back with. */
export function paymentsXml(records: ReadonlyArray<Partial<QrPaymentRecord> & { pointAddress?: string }>): string {
  return serializeDocument(
    element(
      'Payments',
      records.map((r) =>
        element(
          'Payment',
          [
            ['qrpaymentid', r.qrPaymentId],
            ['qrterminalid', r.terminalId],
            ['currencyabbr', 'RUP'],
            ['currencycode', r.currencyCode],
            ['trxreferencenumber', r.rrn],
            ['transactionamount', r.transactionAmount],
            ['transactioncurrency', r.transactionCurrency],
            ['paymentdate', r.paymentDate],
            ['amount', r.amount],
            ['state', r.state === null || r.state === undefined ? null : String(r.state)],
            ['statedescription', r.stateDescription],
            ['pointaddress', r.pointAddress],
            ['createdate', r.createDate],
            ['externalid', r.externalId],
          ]
            .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
            .map(([name, value]) => leaf(name, value)),
        ),
      ),
    ),
  );
}

function collectPayments(el: XmlElement): XmlElement[] {
  if (localName(el) === 'payment') return [el];
  return el.children.filter((n): n is XmlElement => n.type === 'element').flatMap(collectPayments);
}

function readPaymentRecord(payment: XmlElement): QrPaymentRecord {
  const field = (name: string): string | null => {
    const node = localChild(payment, name);
    const value = node ? textOf(node).trim() : '';
    return value === '' ? null : value;
  };
  const state = field('state');
  const parsedState = state === null ? null : Number(state);
  return {
    qrPaymentId: field('qrpaymentid'),
    terminalId: field('qrterminalid'),
    externalId: field('externalid'),
    state: parsedState !== null && Number.isFinite(parsedState) ? parsedState : null,
    stateDescription: field('statedescription'),
    amount: field('amount'),
    transactionAmount: field('transactionamount'),
    currencyCode: field('currencycode'),
    transactionCurrency: field('transactioncurrency'),
    rrn: field('trxreferencenumber'),
    paymentDate: field('paymentdate'),
    createDate: field('createdate'),
  };
}

function localName(el: XmlElement): string {
  const idx = el.name.indexOf(':');
  return (idx === -1 ? el.name : el.name.slice(idx + 1)).toLowerCase();
}

/** A direct child by local name, whatever prefix the bank put on it. */
function localChild(el: XmlElement, name: string): XmlElement | null {
  const lower = name.toLowerCase();
  for (const node of el.children) {
    if (node.type === 'element' && localName(node) === lower) return node;
  }
  return null;
}

/** A descendant (or the element itself) by local name. */
function findLocal(el: XmlElement, name: string): XmlElement | null {
  if (localName(el) === name.toLowerCase()) return el;
  for (const node of el.children) {
    if (node.type !== 'element') continue;
    const found = findLocal(node, name);
    if (found) return found;
  }
  return null;
}

function firstElement(el: XmlElement): XmlElement | null {
  return el.children.find((n): n is XmlElement => n.type === 'element') ?? null;
}

function element(name: string, children: XmlNode[], attrs: XmlElement['attrs'] = []): XmlElement {
  return { type: 'element', name, attrs, children };
}

function leaf(name: string, value: string): XmlElement {
  return { type: 'element', name, attrs: [], children: [{ type: 'text', value }] };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
