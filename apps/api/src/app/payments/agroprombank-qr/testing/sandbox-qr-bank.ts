import { randomInt } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

import { type XmlElement, parseXml, serializeDocument, text, textOf } from '../../agroprombank/xml';
import { DEFAULT_QR_NAMESPACE, QR_STATE, QR_TERMINAL_PATTERN, type QrServiceFunction } from '../constants';
import { type QrPaymentRecord, formatRubles, paymentsXml } from '../protocol';

/**
 * Sandbox stand-in for ЗАО «Агропромбанк» «Мобильный платёж»: the QR web
 * service (`/mobile/QRMobileService.asmx`, every function of the
 * documentation), a fake «bank app» page that pays an invoice from its QR
 * text, and the callback to the merchant.
 *
 * It checks the `QRMCredentials` header on every call and answers in the
 * documented shapes — the state as an XML string inside `…Result`, SOAP
 * faults for refusals — so a wire mistake fails here as it would at the bank.
 *
 * Shared by the e2e test, `pnpm agro:mock` and the sandbox compose stack, so
 * they cannot drift apart. Development and tests only.
 */

export const QR_SERVICE_PATH = '/mobile/QRMobileService.asmx';
export const QR_APP_PATH = '/__sandbox/qr/app';
const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

/** Amount (kopecks) the sandbox will not invoice: CreatePayment* answers a SOAP fault. */
export const QR_REFUSE_AMOUNT = 66_600;

/** `state` values of the sandbox. Only 2 is the bank's documented one. */
export const SANDBOX_QR_STATE = {
  WAITING: 1,
  PAID: QR_STATE.PAID,
  CLOSED: 3,
  REVERSED: 4,
} as const;

const STATE_NAMES: Record<number, string> = {
  [SANDBOX_QR_STATE.WAITING]: 'Ожидает оплаты',
  [SANDBOX_QR_STATE.PAID]: 'Оплачен',
  [SANDBOX_QR_STATE.CLOSED]: 'Отменён',
  [SANDBOX_QR_STATE.REVERSED]: 'Возвращён',
};

export interface SandboxQrPayment {
  qrPaymentId: string;
  terminalId: string;
  /** Our invoice id; `null` for a CreatePayment without one. */
  externalId: string | null;
  /** Kopecks. */
  amount: number;
  /** What the customer actually paid, in kopecks — differs only when a test says so. */
  paidAmount: number | null;
  currencyCode: string;
  /** {@link SANDBOX_QR_STATE}. */
  state: number;
  rrn: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface SandboxQrBankOptions {
  /** Expected `Login` / `Password` of the header. */
  login: string;
  password: string;
  /** When set, an `ExternalToken` equal to it is accepted instead of login and password. */
  externalToken?: string;
  /** Where the bank calls back after a payment; `null` to never call (a lost callback). */
  callbackUrl: string | null;
  /** The units the state XML reports amounts in — the real bank's are unknown (question 4). */
  amountUnit?: 'kopecks' | 'rubles';
  log?: (message: string) => void;
}

export interface SandboxQrBank {
  server: Server;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  /** Handles a request if it is one of ours; `false` leaves it to another sandbox on the same port. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** Every payment, by the bank's id. */
  payments: Map<string, SandboxQrPayment>;
  /** Every web-service call, in order, e.g. `ReversePayment 1000002 000602981706`. */
  calls: string[];
  amountUnit: 'kopecks' | 'rubles';
  /** Refuse ReversePayment with a fault, as a bank might the day after. */
  refuseReverse: boolean;
  /**
   * Pays our invoice as the customer would in the bank's app and calls the
   * merchant back — unless `silent` (a lost callback). `amountKopecks` pays a
   * different sum than invoiced, for the mismatch path.
   */
  pay(externalId: string, options?: { silent?: boolean; amountKopecks?: number }): Promise<SandboxQrPayment>;
}

/** Whether a request path belongs to the QR sandbox — for sharing a port with another sandbox. */
export function isSandboxQrPath(pathname: string): boolean {
  return pathname === QR_SERVICE_PATH || pathname.startsWith('/__sandbox/qr');
}

export function createSandboxQrBank(options: SandboxQrBankOptions): SandboxQrBank {
  const log = options.log ?? ((): void => undefined);
  const payments = new Map<string, SandboxQrPayment>();
  const calls: string[] = [];
  let nextId = 1_000_000 + randomInt(0, 1_000) * 1_000;

  const bank: SandboxQrBank = {
    server: createServer((req, res) => {
      void bank.handle(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end('not found');
      });
    }),
    handle: (req, res) =>
      route(req, res).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log(`ошибка: ${message}`);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(message);
        return true;
      }),
    payments,
    calls,
    amountUnit: options.amountUnit ?? 'kopecks',
    refuseReverse: false,
    pay: (externalId, payOptions = {}) => pay(externalId, payOptions),
    listen: (port = 0) =>
      new Promise<number>((resolvePort, reject) => {
        bank.server.once('error', reject);
        bank.server.listen(port, () => {
          const address = bank.server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('sandbox QR bank did not bind a TCP port'));
            return;
          }
          resolvePort(address.port);
        });
      }),
    close: () =>
      new Promise<void>((resolveClose, reject) => bank.server.close((err) => (err ? reject(err) : resolveClose()))),
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://sandbox');
    if (!isSandboxQrPath(url.pathname)) return false;
    const body = req.method === 'POST' ? await readBody(req) : '';

    if (req.method === 'POST' && url.pathname === QR_SERVICE_PATH) {
      const { status, xml } = handleSoap(body);
      res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(xml);
      return true;
    }
    if (req.method === 'GET' && url.pathname === QR_APP_PATH) {
      showApp(res, url.searchParams.get('code') ?? '');
      return true;
    }
    if (req.method === 'POST' && (url.pathname === `${QR_APP_PATH}/pay` || url.pathname === `${QR_APP_PATH}/decline`)) {
      const externalId = new URLSearchParams(body).get('extid') ?? '';
      if (url.pathname.endsWith('/pay')) {
        await pay(externalId, {});
        html(res, 200, '<h1>Оплачено</h1><p>Можно вернуться в takeAway.</p>');
      } else {
        log(`счёт ${externalId}: покупатель отказался`);
        html(res, 200, '<h1>Вы отказались от оплаты</h1>');
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/__sandbox/qr/pay/')) {
      const externalId = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      json(res, await pay(externalId, { silent: url.searchParams.get('silent') === '1' }));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/__sandbox/qr/state') {
      json(res, { payments: [...payments.values()], calls });
      return true;
    }
    res.writeHead(404).end('not found');
    return true;
  }

  function findByExternalId(externalId: string): SandboxQrPayment | null {
    let found: SandboxQrPayment | null = null;
    for (const payment of payments.values()) {
      if (payment.externalId === externalId) found = payment;
    }
    return found;
  }

  async function pay(
    externalId: string,
    payOptions: { silent?: boolean; amountKopecks?: number },
  ): Promise<SandboxQrPayment> {
    const payment = findByExternalId(externalId);
    if (!payment) throw new Error(`счёт ${externalId} не найден`);
    if (payment.state !== SANDBOX_QR_STATE.WAITING) {
      throw new Error(`счёт ${externalId} не ждёт оплаты (${STATE_NAMES[payment.state] ?? payment.state})`);
    }
    payment.state = SANDBOX_QR_STATE.PAID;
    payment.paidAt = new Date().toISOString();
    payment.paidAmount = payOptions.amountKopecks ?? payment.amount;
    payment.rrn = String(randomInt(100_000_000_000, 999_999_999_999)).padStart(12, '0');
    log(`счёт ${externalId}: оплачен (${formatRubles(payment.paidAmount)})`);
    if (!payOptions.silent) await callBack(payment);
    else log(`счёт ${externalId}: колбэк «потерян»`);
    return payment;
  }

  async function callBack(payment: SandboxQrPayment): Promise<void> {
    if (!options.callbackUrl) {
      log(`URL колбэка не задан — колбэк по счёту ${payment.externalId} «потерян»`);
      return;
    }
    const form = new URLSearchParams({
      payments: paymentsXml([recordOf(payment)]),
      trx: trxXml(payment),
    }).toString();
    try {
      const response = await fetch(options.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      log(`колбэк ← HTTP ${response.status} ${(await response.text()).slice(0, 60)}`);
    } catch (err) {
      log(`колбэк недоступен: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleSoap(envelopeXml: string): { status: number; xml: string } {
    const envelope = parseXml(envelopeXml);
    const header = findLocal(envelope, 'Header');
    const credentials = header ? findLocal(header, 'QRMCredentials') : null;
    const body = findLocal(envelope, 'Body');
    const call = body?.children.find((n): n is XmlElement => n.type === 'element');
    if (!call) return fault('SOAP <Body> is empty');
    const fn = localName(call.name) as QrServiceFunction;
    const arg = (name: string): string => text(call, name)?.trim() ?? '';

    calls.push(
      [fn, ...['terminalid', 'qrterminal', 'amount', 'extid', 'externalid', 'qrpaymentid', 'paymetid', 'rrn'].map(arg)]
        .filter(Boolean)
        .join(' '),
    );

    if (!credentials || !authorized(credentials)) {
      log(`${fn}: неверные учётные данные`);
      return fault('Ошибка авторизации: неверный логин или пароль');
    }
    if (call.attrs.find((a) => a.name === 'xmlns')?.value !== DEFAULT_QR_NAMESPACE) {
      return fault(`Неизвестное пространство имён операции ${fn}`);
    }

    const terminal = arg('terminalid') || arg('qrterminal') || arg('qrterminals');
    if (fn !== 'GetPayments' && !QR_TERMINAL_PATTERN.test(terminal)) return fault(`Терминал ${terminal} не найден`);

    switch (fn) {
      case 'CreatePayment':
      case 'CreatePaymentID': {
        const amount = Number(arg('amount'));
        if (!Number.isInteger(amount) || amount <= 0) return fault('Некорректная сумма');
        if (amount === QR_REFUSE_AMOUNT) return fault('Сумма не может быть выставлена');
        if (arg('currencycode') !== '000') return fault('Валюта не поддерживается терминалом');
        const externalId = fn === 'CreatePaymentID' ? arg('extid') || null : null;
        if (
          externalId &&
          [...payments.values()].some((p) => p.externalId === externalId && p.terminalId === terminal)
        ) {
          return fault(`Внешний идентификатор ${externalId} уже использован`);
        }
        const payment: SandboxQrPayment = {
          qrPaymentId: String((nextId += 1)),
          terminalId: terminal,
          externalId,
          amount,
          paidAmount: null,
          currencyCode: '000',
          state: SANDBOX_QR_STATE.WAITING,
          rrn: null,
          createdAt: new Date().toISOString(),
          paidAt: null,
        };
        payments.set(payment.qrPaymentId, payment);
        log(`${fn} → счёт ${externalId ?? '(без extid)'} на ${formatRubles(amount)}, id ${payment.qrPaymentId}`);
        return respond(fn, fn === 'CreatePayment' ? 'true' : payment.qrPaymentId);
      }
      case 'ClosePayment':
      case 'ClosePaymentExtId': {
        const payment =
          fn === 'ClosePaymentExtId'
            ? findByExternalId(arg('externalid'))
            : ([...payments.values()]
                .reverse()
                .find((p) => p.terminalId === terminal && p.state === SANDBOX_QR_STATE.WAITING) ?? null);
        if (!payment) return fault('Платёж не найден');
        if (payment.state === SANDBOX_QR_STATE.WAITING) {
          payment.state = SANDBOX_QR_STATE.CLOSED;
          log(`${fn} → счёт ${payment.externalId} закрыт`);
        }
        return respond(fn, null);
      }
      case 'GetPaymentState':
      case 'GetPaymentStateExtId': {
        const payment =
          fn === 'GetPaymentStateExtId'
            ? findByExternalId(arg('externalid'))
            : (payments.get(arg('qrpaymentid')) ?? null);
        // An invoice the bank does not know: an empty list.
        return respond(fn, paymentsXml(payment ? [recordOf(payment)] : []));
      }
      case 'ReversePayment': {
        const payment = payments.get(arg('paymetid'));
        if (!payment || payment.terminalId !== terminal) return fault('Платёж не найден');
        if (bank.refuseReverse) return fault('Отмена операции невозможна');
        if (payment.state !== SANDBOX_QR_STATE.PAID || payment.rrn !== arg('rrn')) {
          return fault('Платёж не оплачен или RRN не совпадает');
        }
        payment.state = SANDBOX_QR_STATE.REVERSED;
        log(`ReversePayment → счёт ${payment.externalId} возвращён`);
        return respond(fn, null);
      }
      case 'GetPayments': {
        const from = Date.parse(arg('startDate'));
        const to = Date.parse(arg('endDate'));
        const listed = [...payments.values()].filter((p) => {
          const at = Date.parse(p.createdAt);
          return (Number.isNaN(from) || at >= from) && (Number.isNaN(to) || at <= to);
        });
        return respond(fn, paymentsXml(listed.map(recordOf)));
      }
    }
    return fault(`Неизвестная операция ${String(fn)}`);
  }

  function authorized(credentials: XmlElement): boolean {
    const field = (name: string): string => {
      const node = findLocal(credentials, name);
      return node ? textOf(node).trim() : '';
    };
    if (field('DeviceId') !== '-1' || field('PushId') !== '-1') return false;
    if (options.externalToken && field('ExternalToken') === options.externalToken) return true;
    return field('ExternalToken') === '' && field('Login') === options.login && field('Password') === options.password;
  }

  function recordOf(payment: SandboxQrPayment): QrPaymentRecord {
    const sum = payment.paidAmount ?? payment.amount;
    const amount = bank.amountUnit === 'rubles' ? formatRubles(sum) : String(sum);
    return {
      qrPaymentId: payment.qrPaymentId,
      terminalId: payment.terminalId,
      externalId: payment.externalId,
      state: payment.state,
      stateDescription: STATE_NAMES[payment.state] ?? null,
      amount,
      transactionAmount: payment.paidAt ? amount : null,
      currencyCode: payment.currencyCode,
      transactionCurrency: payment.paidAt ? payment.currencyCode : null,
      rrn: payment.rrn,
      paymentDate: payment.paidAt ? bankDate(new Date(payment.paidAt)) : null,
      createDate: bankDate(new Date(payment.createdAt)),
    };
  }

  function trxXml(payment: SandboxQrPayment): string {
    const sum = String(payment.paidAmount ?? payment.amount);
    return serializeDocument(
      element(
        'trx',
        [
          leaf('operationstype', 'Purchase'),
          leaf('pan', '910401******8756'),
          leaf('rrn', payment.rrn ?? ''),
          leaf('responsecode', '00'),
          leaf('responsedescr', 'Транзакция одобрена'),
          leaf('amount', sum),
          leaf('currency', payment.currencyCode),
          leaf('transactiondate', payment.paidAt ? bankDate(new Date(payment.paidAt)) : ''),
          leaf('authcode', '4HK65X'),
          leaf('isreversal', '0'),
        ],
        [{ name: 'type', value: 'debet' }],
      ),
    );
  }

  /** The «bank app»: what the customer sees after scanning the code or following the link. */
  function showApp(res: ServerResponse, code: string): void {
    // The code is `QRT…:<sum>:<extid>` by default; any part naming one of our invoices will do.
    const payment = code
      .split(':')
      .map((part) => findByExternalId(part.trim()))
      .find((p): p is SandboxQrPayment => p !== null);
    if (!payment) return html(res, 404, `<h1>Счёт не найден</h1><p>${escapeHtml(code)}</p>`);
    if (payment.state !== SANDBOX_QR_STATE.WAITING) {
      return html(res, 409, `<h1>Счёт ${escapeHtml(STATE_NAMES[payment.state] ?? '')}</h1>`);
    }
    // Relative, so the buttons stay under the page's own path behind a proxy prefix.
    const extid = escapeHtml(payment.externalId ?? '');
    html(
      res,
      200,
      `<h1>Песочница «Агропромбанк» — оплата по QR</h1>
<p>Терминал ${escapeHtml(payment.terminalId)}, счёт ${extid}</p>
<p>К оплате: <b>${formatRubles(payment.amount)}</b> руб. ПМР</p>
<form method="post" action="app/pay"><input type="hidden" name="extid" value="${extid}"><button>Оплатить</button></form>
<form method="post" action="app/decline"><input type="hidden" name="extid" value="${extid}"><button>Отказаться</button></form>
<p><small>Сумма ${QR_REFUSE_AMOUNT} коп. не выставляется никогда.</small></p>`,
    );
  }

  function respond(fn: QrServiceFunction, result: string | null): { status: number; xml: string } {
    const response = element(`${fn}Response`, result === null ? [] : [leaf(`${fn}Result`, result)], [
      { name: 'xmlns', value: DEFAULT_QR_NAMESPACE },
    ]);
    return { status: 200, xml: envelopeOf(response) };
  }

  function fault(message: string): { status: number; xml: string } {
    return {
      status: 500,
      xml: envelopeOf(element('soap:Fault', [leaf('faultcode', 'soap:Server'), leaf('faultstring', message)])),
    };
  }

  return bank;
}

function envelopeOf(content: XmlElement): string {
  return serializeDocument(
    element('soap:Envelope', [element('soap:Body', [content])], [{ name: 'xmlns:soap', value: SOAP_NS }]),
  );
}

/** `14.04.2023 17:15:26`, as the bank writes dates. */
function bankDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function localName(name: string): string {
  return name.includes(':') ? (name.split(':')[1] ?? name) : name;
}

function findLocal(el: XmlElement, name: string): XmlElement | null {
  for (const node of el.children) {
    if (node.type === 'element' && localName(node.name).toLowerCase() === name.toLowerCase()) return node;
  }
  return null;
}

function element(name: string, children: XmlElement[], attrs: XmlElement['attrs'] = []): XmlElement {
  return { type: 'element', name, attrs, children };
}

function leaf(name: string, value: string): XmlElement {
  return { type: 'element', name, attrs: [], children: [{ type: 'text', value }] };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolveBody(body));
    req.on('error', reject);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Агропромбанк — песочница</title>` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><body>${body}</body></html>`,
  );
}

function json(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}
