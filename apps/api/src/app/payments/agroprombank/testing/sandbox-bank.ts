import { type Server, type ServerResponse, createServer } from 'node:http';
import { randomInt } from 'node:crypto';

import { type XmlElement, type XmlNode, buildElement, child, num, parseXml, serializeDocument, text } from '../xml';
import { signXml, verifyXml } from '../xmldsig';

/**
 * Sandbox stand-in for the bank's MerchantCAPService.
 *
 * Speaks the real protocol — SOAP 1.1, XMLDSig-signed request and response, the
 * bank's field names and result codes — so the integration can be exercised end
 * to end before the bank issues merchant credentials. Crucially it *verifies*
 * our signature and signs its own replies, so a broken canonicalization or
 * signing change fails here exactly as it would fail against the real gateway.
 *
 * Lives in the app (not in `tools/`) so the integration test and the standalone
 * mock server share one implementation and cannot drift apart.
 *
 * Development and tests only.
 */

export const SANDBOX_PATH = '/merchant/MerchantCAPService.asmx';
const NS = 'http://services.agroprombank.com';
const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

/** Card the bank refuses to bind, for exercising the unhappy path. */
export const UNKNOWN_CARD_DIGITS = '0000';
/** Amount (minor units) the bank declines for insufficient funds. */
export const DECLINE_AMOUNT = 66_600;

export interface SandboxTokenRequest {
  requestId: string;
  otp: string;
  lastDigits: string;
  phone: string;
  institute: string;
  used: boolean;
}

export interface SandboxToken {
  token: string;
  lastDigits: string;
  pan: string;
  embossing: string;
  active: boolean;
}

export interface SandboxOperation {
  invoiceId: string;
  operationId: string;
  amount: number;
  tipAmount: number;
  /** 0 created, 1 preauthorized, 5 completed. */
  state: number;
  rrn: string;
  authCode: string;
  refunded: number;
  reversed: boolean;
  createdAt: string;
}

export interface SandboxBankOptions {
  /** Public key (or certificate) the sandbox verifies incoming requests with. */
  merchantPublicKeyPem: string;
  /** Private key the sandbox signs its responses with. */
  bankPrivateKeyPem: string;
  /** Called for every request/decision; defaults to silence. */
  log?: (message: string) => void;
}

export interface SandboxBank {
  server: Server;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  /** The one-time password the bank would have texted. */
  otpFor(requestId: string): string | null;
  tokenRequests: Map<string, SandboxTokenRequest>;
  tokens: Map<string, SandboxToken>;
  operations: Map<string, SandboxOperation>;
}

class BankError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
  ) {
    super(description);
  }
}

export function createSandboxBank(options: SandboxBankOptions): SandboxBank {
  const log = options.log ?? ((): void => undefined);
  const tokenRequests = new Map<string, SandboxTokenRequest>();
  const tokens = new Map<string, SandboxToken>();
  const operations = new Map<string, SandboxOperation>();
  /** Card behind each operation, needed to build the `trx` block. */
  const operationCards = new Map<string, SandboxToken>();

  const requireToken = (token: string): SandboxToken => {
    const record = tokens.get(token);
    if (!record) throw new BankError(8, 'Токен не найден');
    return record;
  };

  const requireOperation = (invoiceId: string): SandboxOperation => {
    const operation = operations.get(invoiceId);
    if (!operation) throw new BankError(404, 'Операция не найдена');
    return operation;
  };

  const flatHandlers: Record<string, (request: XmlElement) => Record<string, string | number>> = {
    NewTokenRequest(request) {
      const lastDigits = required(request, 'LastDigit');
      if (lastDigits === UNKNOWN_CARD_DIGITS) {
        throw new BankError(5, 'Карта с указанными реквизитами не найдена');
      }

      const requestId = String(randomInt(100_000, 999_999));
      const otp = String(randomInt(100_000, 999_999));
      tokenRequests.set(requestId, {
        requestId,
        otp,
        lastDigits,
        phone: required(request, 'Phone'),
        institute: text(request, 'institute') ?? '0001',
        used: false,
      });

      if (num(request, 'deactivateold') === 1) {
        for (const token of tokens.values()) token.active = false;
      }

      log(`NewTokenRequest → requestid=${requestId}, СМС с паролем: ${otp}`);
      return { result: 1, requestid: requestId };
    },

    ProcessTokenRequest(request) {
      const requestId = required(request, 'requestid');
      const pending = tokenRequests.get(requestId);
      if (!pending) throw new BankError(6, 'Запрос на генерацию токена не найден');
      if (pending.used) throw new BankError(7, 'Запрос уже использован');
      if (pending.otp !== required(request, 'code')) throw new BankError(5, 'Неверный одноразовый пароль');

      pending.used = true;
      const token = hex(64);
      tokens.set(token, {
        token,
        lastDigits: pending.lastDigits,
        pan: `9104 **** **** ${pending.lastDigits}`,
        embossing: 'MA*** *******',
        active: true,
      });
      log(`ProcessTokenRequest → выдан токен ${token.slice(0, 12)}…`);
      return { result: 1, token };
    },

    CheckToken(request) {
      const record = requireToken(required(request, 'token'));
      return { result: 1, pan: record.pan, embossing: record.embossing, cardstate: record.active ? 1 : -1 };
    },

    DeactivateToken(request) {
      const record = requireToken(required(request, 'token'));
      record.active = false;
      log(`DeactivateToken → ${record.token.slice(0, 12)}… отключён`);
      return { result: 1 };
    },

    ProcessCardAutoPayment(request) {
      const invoiceId = required(request, 'invoiceid');
      const record = requireToken(required(request, 'token'));
      if (!record.active) throw new BankError(12, 'Токен отозван');
      if (operations.has(invoiceId)) throw new BankError(9, 'Операция с таким invoiceid уже существует');

      const amount = num(request, 'amount') ?? 0;
      if (amount === DECLINE_AMOUNT) throw new BankError(116, 'Недостаточно средств на карте');

      const preauth = num(request, 'preauth') === 1;
      const operation: SandboxOperation = {
        invoiceId,
        operationId: String(randomInt(100_000_000, 999_999_999)),
        amount,
        tipAmount: num(request, 'tipamount') ?? 0,
        state: preauth ? 1 : 5,
        rrn: String(randomInt(100_000_000_000, 999_999_999_999)),
        authCode: String(randomInt(100_000, 999_999)),
        refunded: 0,
        reversed: false,
        createdAt: new Date().toISOString(),
      };
      operations.set(invoiceId, operation);
      operationCards.set(invoiceId, record);
      log(
        `ProcessCardAutoPayment → invoice=${invoiceId} amount=${amount} ` +
          `${preauth ? '(предавторизация)' : '(списание)'} operationid=${operation.operationId}`,
      );
      return { result: 1, operationid: operation.operationId, cos: 1 };
    },

    CompletePreAuthorizaion(request) {
      const operation = requireOperation(required(request, 'invoiceid'));
      if (operation.state !== 1) throw new BankError(10, 'Операция не является предавторизацией');
      const amount = num(request, 'amount') ?? 0;
      if (amount > Math.floor(operation.amount * 1.1)) {
        throw new BankError(11, 'Сумма превышает 110% от предавторизованной');
      }
      operation.amount = amount;
      operation.state = 5;
      log(`CompletePreAuthorizaion → invoice=${operation.invoiceId} захвачено ${amount}`);
      return { result: 1 };
    },

    ReverseOperation(request) {
      const operation = requireOperation(required(request, 'invoiceid'));
      if (operation.reversed) throw new BankError(13, 'Операция уже отменена');
      operation.reversed = true;
      operation.refunded = operation.amount;
      log(`ReverseOperation → invoice=${operation.invoiceId} отменена`);
      return { result: 1 };
    },

    RefundOperation(request) {
      const operation = requireOperation(required(request, 'invoiceid'));
      const refund = num(request, 'refundamount') ?? 0;
      if (refund <= 0 || operation.refunded + refund > operation.amount) {
        throw new BankError(14, 'Некорректная сумма возврата');
      }
      operation.refunded += refund;
      log(`RefundOperation → invoice=${operation.invoiceId} возвращено ${refund}/${operation.amount}`);
      return { result: 1 };
    },

    CheckOperation(request) {
      const operation = requireOperation(required(request, 'invoiceid'));
      return { result: 1, operationid: operation.operationId, cos: 1 };
    },
  };

  const nestedHandlers: Record<string, (request: XmlElement) => XmlElement> = {
    GetOperation(request) {
      return element('root', [leaf('result', '1'), operationBlock(requireOperation(required(request, 'invoiceid')))]);
    },
    GetOperations() {
      return element('root', [leaf('result', '1'), ...[...operations.values()].map(operationBlock)]);
    },
  };

  function dispatch(fn: string, request: XmlElement): XmlElement {
    try {
      const nested = nestedHandlers[fn];
      if (nested) return nested(request);

      const handler = flatHandlers[fn];
      if (!handler) throw new BankError(-1, `Операция ${fn} не поддерживается`);

      const root = buildElement('root', handler(request));
      if (fn === 'ProcessCardAutoPayment') {
        const invoiceId = required(request, 'invoiceid');
        const operation = operations.get(invoiceId);
        const card = operationCards.get(invoiceId);
        if (operation && card) root.children.push(trxBlock(operation, card));
      }
      return root;
    } catch (err) {
      if (err instanceof BankError) {
        return buildElement('root', { result: -1, errorcode: err.code, error: err.description });
      }
      throw err;
    }
  }

  function unwrap(envelopeXml: string): { fn: string; request: XmlElement } {
    const envelope = parseXml(envelopeXml);
    const body = child(envelope, 'soap:Body') ?? child(envelope, 'Body');
    if (!body) throw new Error('SOAP envelope has no <Body>');
    const call = body.children.find((n): n is XmlElement => n.type === 'element');
    if (!call) throw new Error('SOAP <Body> is empty');

    const fn = call.name.includes(':') ? (call.name.split(':')[1] ?? call.name) : call.name;
    const requestXml = text(call, 'request');
    if (!requestXml) throw new Error(`${fn}: call carries no <request>`);

    const verdict = verifyXml(requestXml, options.merchantPublicKeyPem);
    if (!verdict.valid) throw new Error(`${fn}: подпись запроса не прошла проверку — ${verdict.reason}`);

    log(`← ${fn} (merchantId=${text(call, 'merchantId') ?? '?'})`);
    return { fn, request: parseXml(requestXml) };
  }

  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (req.method === 'GET' && url.startsWith('/__sandbox/otp/')) {
      const pending = tokenRequests.get(url.split('/').pop() ?? '');
      return json(res, pending ? { otp: pending.otp } : { error: 'unknown requestid' }, pending ? 200 : 404);
    }
    if (req.method === 'GET' && url.startsWith('/__sandbox/state')) {
      return json(res, {
        tokenRequests: [...tokenRequests.values()],
        tokens: [...tokens.values()],
        operations: [...operations.values()],
      });
    }
    if (req.method === 'GET' && url.startsWith(SANDBOX_PATH)) {
      return json(res, {
        service: 'Agroprombank MerchantCAPService (sandbox)',
        operations: [...Object.keys(flatHandlers), ...Object.keys(nestedHandlers)],
      });
    }
    if (req.method !== 'POST' || !url.startsWith(SANDBOX_PATH)) {
      res.writeHead(404).end('not found');
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const { fn, request } = unwrap(body);
        const signed = signXml(dispatch(fn, request), { privateKeyPem: options.bankPrivateKeyPem });
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(wrapEnvelope(fn, signed));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`ошибка обработки: ${message}`);
        res.writeHead(500, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(soapFault(message));
      }
    });
  });

  return {
    server,
    tokenRequests,
    tokens,
    operations,
    otpFor: (requestId) => tokenRequests.get(requestId)?.otp ?? null,
    listen: (port = 0) =>
      new Promise<number>((resolvePort, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          const address = server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('sandbox bank did not bind a TCP port'));
            return;
          }
          resolvePort(address.port);
        });
      }),
    close: () =>
      new Promise<void>((resolveClose, reject) => server.close((err) => (err ? reject(err) : resolveClose()))),
  };
}

function wrapEnvelope(fn: string, resultXml: string): string {
  return serializeDocument({
    type: 'element',
    name: 'soap:Envelope',
    attrs: [{ name: 'xmlns:soap', value: SOAP_NS }],
    children: [
      element('soap:Body', [
        buildElement(`${fn}Response`, { [`${fn}Result`]: resultXml }, [{ name: 'xmlns', value: NS }]),
      ]),
    ],
  });
}

function soapFault(message: string): string {
  return serializeDocument({
    type: 'element',
    name: 'soap:Envelope',
    attrs: [{ name: 'xmlns:soap', value: SOAP_NS }],
    children: [
      element('soap:Body', [element('soap:Fault', [leaf('faultcode', 'soap:Server'), leaf('faultstring', message)])]),
    ],
  });
}

function operationBlock(operation: SandboxOperation): XmlElement {
  return element('operation', [
    leaf('transactid', operation.operationId),
    leaf('merchantid', 'M00012345'),
    leaf('invoiceid', operation.invoiceId),
    leaf('amount', String(operation.amount)),
    leaf('tipamount', String(operation.tipAmount)),
    leaf('currencycode', '000'),
    leaf('istest', '1'),
    leaf('state', String(operation.state)),
    leaf('description', 'Sandbox operation'),
    leaf('createdate', operation.createdAt),
    leaf('debetrrn', operation.rrn),
    leaf('paydate', operation.createdAt),
  ]);
}

function trxBlock(operation: SandboxOperation, card: SandboxToken): XmlElement {
  return element('trx', [
    leaf('type', 'debet'),
    leaf('operationstype', 'Purchase'),
    leaf('pan', `910401******${card.lastDigits}`),
    leaf('rrn', operation.rrn),
    leaf('responsecode', '00'),
    leaf('responsedescr', 'Транзакция одобрена'),
    leaf('expdate', '1026'),
    leaf('merchantid', 'M00012345'),
    leaf('terminalid', 'E1016682'),
    leaf('amount', String(operation.amount)),
    leaf('currency', '000'),
    leaf('transactiondate', operation.createdAt),
    leaf('merchantcountry', '777'),
    leaf('merchantlocation', 'Tiraspol'),
    leaf('merchantname', 'takeAway sandbox'),
    leaf('authcode', operation.authCode),
    leaf('isreversal', operation.reversed ? '1' : '0'),
  ]);
}

function element(name: string, children: XmlNode[]): XmlElement {
  return { type: 'element', name, attrs: [], children };
}

function leaf(name: string, value: string): XmlElement {
  return { type: 'element', name, attrs: [], children: [{ type: 'text', value }] };
}

function required(request: XmlElement, field: string): string {
  const value = text(request, field)?.trim();
  if (!value) throw new BankError(-1, `Не заполнено обязательное поле ${field}`);
  return value;
}

function hex(length: number): string {
  let out = '';
  while (out.length < length) out += randomInt(0, 16).toString(16).toUpperCase();
  return out.slice(0, length);
}

function json(res: ServerResponse, payload: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}
