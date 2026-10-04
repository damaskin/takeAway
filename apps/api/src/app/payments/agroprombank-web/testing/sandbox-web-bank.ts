import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { createSign, randomInt } from 'node:crypto';

import { type XmlElement, buildElement, parseXml, serializeDocument, text } from '../../agroprombank/xml';
import { WEB_STATE, type WebServiceFunction } from '../constants';
import { md5Signature, serviceSignature, signaturesMatch } from '../protocol';

/**
 * Sandbox stand-in for ЗАО «Агропромбанк» «Web-платёж»: the payment page
 * (`/PaymentStart`), the ResultURL notification and the admin web service
 * (`APB.SV.WebPayment.AgentService.asmx`).
 *
 * It checks every MD5 signature we send and signs its web-service answers
 * with its own key, wrapped the way the documentation describes
 * (base64 `<envelope><response/><signature/></envelope>`), so a signing or
 * unwrapping mistake fails here as it would at the bank.
 *
 * Shared by the e2e test, `pnpm agro:mock` and the sandbox compose stack, so
 * they cannot drift apart. Development and tests only.
 */

export const WEB_PAYMENT_PATH = '/PaymentStart';
export const WEB_SERVICE_PATH = '/merchant/APB.SV.WebPayment.AgentService.asmx';
const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SERVICE_NS = 'http://services.agroprombank.com';

/** Amount (minor units) the sandbox page declines, for the unhappy path. */
export const WEB_DECLINE_AMOUNT = 66_600;

export interface SandboxInvoice {
  nivid: string;
  sum: number;
  currency: string;
  description: string;
  isTest: boolean;
  lifetimeMinutes: number;
  preauth: boolean;
  /** {@link WEB_STATE}. */
  state: number;
  /** A preauthorization the merchant has completed. */
  completed: boolean;
  refunded: number;
  rrn: string;
  lastDigits: string;
  createdAt: string;
  paidAt: string | null;
}

export interface SandboxWebBankOptions {
  merchantLogin: string;
  merchantPass: string;
  /** Private key the bank signs its web-service responses with. */
  bankPrivateKeyPem: string;
  /** Where the bank notifies the merchant; `null` to never call it (a lost notification). */
  resultUrl: string | null;
  /** Method registered for ResultURL. */
  resultMethod?: 'POST' | 'GET';
  successUrl: string;
  failUrl: string;
  log?: (message: string) => void;
}

export interface SandboxWebBank {
  server: Server;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  invoices: Map<string, SandboxInvoice>;
  /** Every admin web-service call, in order, e.g. `ComplitionOperation 1100003 3300`. */
  calls: string[];
  /** Refuse CancelOperation, as the bank does after the day of payment. */
  refuseCancel: boolean;
  /** Pays an invoice as a customer on the page would; returns where the page sends them. */
  pay(nivid: string): Promise<string>;
  decline(nivid: string): Promise<string>;
}

export function createSandboxWebBank(options: SandboxWebBankOptions): SandboxWebBank {
  const log = options.log ?? ((): void => undefined);
  const invoices = new Map<string, SandboxInvoice>();
  const calls: string[] = [];

  const bank: SandboxWebBank = {
    server: createServer((req, res) => {
      void route(req, res).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log(`ошибка: ${message}`);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(message);
      });
    }),
    invoices,
    calls,
    refuseCancel: false,
    pay: (nivid) => settle(nivid, true),
    decline: (nivid) => settle(nivid, false),
    listen: (port = 0) =>
      new Promise<number>((resolvePort, reject) => {
        bank.server.once('error', reject);
        bank.server.listen(port, () => {
          const address = bank.server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('sandbox web bank did not bind a TCP port'));
            return;
          }
          resolvePort(address.port);
        });
      }),
    close: () =>
      new Promise<void>((resolveClose, reject) => bank.server.close((err) => (err ? reject(err) : resolveClose()))),
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://sandbox');
    const body = req.method === 'POST' ? await readBody(req) : '';

    if (url.pathname === WEB_PAYMENT_PATH) {
      const params = { ...Object.fromEntries(url.searchParams), ...formParams(req, body) };
      return showPaymentPage(res, params);
    }
    if (
      req.method === 'POST' &&
      (url.pathname === `${WEB_PAYMENT_PATH}/pay` || url.pathname === `${WEB_PAYMENT_PATH}/decline`)
    ) {
      const nivid = new URLSearchParams(body).get('nivid') ?? '';
      const location = await settle(nivid, url.pathname.endsWith('/pay'));
      res.writeHead(302, { Location: location }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/__sandbox/web/pay/')) {
      return json(res, { redirect: await settle(decodeURIComponent(url.pathname.split('/').pop() ?? ''), true) });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/__sandbox/web/decline/')) {
      return json(res, { redirect: await settle(decodeURIComponent(url.pathname.split('/').pop() ?? ''), false) });
    }
    if (req.method === 'GET' && url.pathname === '/__sandbox/web/state') {
      return json(res, { invoices: [...invoices.values()], calls });
    }
    if (req.method === 'POST' && url.pathname === WEB_SERVICE_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(handleSoap(body));
      return;
    }
    res.writeHead(404).end('not found');
  }

  /** `PaymentStart`: checks the request signature, registers the invoice, shows Pay / Decline. */
  function showPaymentPage(res: ServerResponse, params: Record<string, string>): void {
    const nivid = params['nivid'] ?? '';
    const sum = Number(params['RequestSum']);
    const expected = md5Signature(
      options.merchantLogin,
      nivid,
      params['IsTest'] ?? '',
      params['RequestSum'] ?? '',
      params['RequestCurrCode'] ?? '',
      params['Desc'] ?? '',
      options.merchantPass,
    );
    if (params['MerchantLogin'] !== options.merchantLogin || !signaturesMatch(expected, params['SignatureValue'])) {
      log(`PaymentStart: подпись не сошлась для счёта ${nivid}`);
      return html(res, 400, '<h1>Ошибка подписи запроса</h1>');
    }
    if (!/^.{1,20}$/.test(nivid) || !Number.isInteger(sum) || sum <= 0) {
      return html(res, 400, '<h1>Некорректные параметры счёта</h1>');
    }

    const existing = invoices.get(nivid);
    if (existing && existing.state !== WEB_STATE.NOT_PAID) {
      return html(res, 409, '<h1>Счёт уже обработан</h1>');
    }
    if (!existing) {
      invoices.set(nivid, {
        nivid,
        sum,
        currency: params['RequestCurrCode'] ?? '000',
        description: params['Desc'] ?? '',
        isTest: params['IsTest'] === '1',
        lifetimeMinutes: Number(params['LifeTime'] ?? 30),
        preauth: params['ispreauth'] === '1',
        state: WEB_STATE.NOT_PAID,
        completed: false,
        refunded: 0,
        rrn: String(randomInt(100_000_000_000, 999_999_999_999)),
        lastDigits: '0578',
        createdAt: new Date().toISOString(),
        paidAt: null,
      });
      log(`PaymentStart → счёт ${nivid} на ${sum} ${params['ispreauth'] === '1' ? '(блокировка)' : '(списание)'}`);
    }

    const amount = (sum / 100).toFixed(2);
    html(
      res,
      200,
      `<h1>Песочница «Клевер» — Web-платёж</h1>
<p>${escapeHtml(params['Desc'] ?? '')}</p>
<p>К оплате: <b>${amount}</b> ${params['ispreauth'] === '1' ? '(сумма будет заблокирована)' : ''}</p>
<form method="post" action="${WEB_PAYMENT_PATH}/pay"><input type="hidden" name="nivid" value="${escapeHtml(nivid)}"><button>Оплатить</button></form>
<form method="post" action="${WEB_PAYMENT_PATH}/decline"><input type="hidden" name="nivid" value="${escapeHtml(nivid)}"><button>Отказаться</button></form>
<p><small>Сумма ${WEB_DECLINE_AMOUNT} коп. отклоняется всегда.</small></p>`,
    );
  }

  /** The customer pressed a button: settle, notify the merchant, send the customer back. */
  async function settle(nivid: string, wantsToPay: boolean): Promise<string> {
    const invoice = invoices.get(nivid);
    if (!invoice) throw new Error(`счёт ${nivid} не найден`);
    if (invoice.state !== WEB_STATE.NOT_PAID) throw new Error(`счёт ${nivid} уже обработан`);

    const date = ddmmyyyy(new Date());
    const paid = wantsToPay && invoice.sum !== WEB_DECLINE_AMOUNT;
    invoice.state = paid ? WEB_STATE.PAID : WEB_STATE.ERROR;
    invoice.paidAt = new Date().toISOString();
    log(`счёт ${nivid}: ${paid ? 'оплачен' : 'отказ'}`);

    const notification: Record<string, string> = paid
      ? {
          status: 'paid',
          paymentsum: String(invoice.sum),
          paymentcurrency: invoice.currency,
          invoiceid: nivid,
          date,
          signature: md5Signature(nivid, 'paid', invoice.sum, invoice.currency, date, options.merchantPass),
          istest: invoice.isTest ? '1' : '0',
          rrn: invoice.rrn,
          lastdgt: invoice.lastDigits,
        }
      : {
          status: 'fail',
          invoiceid: nivid,
          date,
          signature: md5Signature(nivid, 'fail', date, options.merchantPass),
          istest: invoice.isTest ? '1' : '0',
        };
    await notify(notification);

    // The page itself sends the customer back with the redirect's own parameters.
    const back = new URL(paid ? options.successUrl : options.failUrl);
    back.searchParams.set('invoiceid', nivid);
    back.searchParams.set('date', date);
    back.searchParams.set('istest', invoice.isTest ? '1' : '0');
    if (paid) {
      back.searchParams.set('paymentsum', String(invoice.sum));
      back.searchParams.set('paymentcurrcode', invoice.currency);
      back.searchParams.set(
        'signaturevalue',
        md5Signature(nivid, 'paid', invoice.sum, invoice.currency, date, options.merchantPass),
      );
    } else {
      back.searchParams.set('signaturevalue', md5Signature(nivid, 'fail', date, options.merchantPass));
    }
    return back.toString();
  }

  async function notify(params: Record<string, string>): Promise<void> {
    if (!options.resultUrl) {
      log(`ResultURL не задан — оповещение по счёту ${params['invoiceid']} «потеряно»`);
      return;
    }
    const form = new URLSearchParams(params).toString();
    try {
      const response =
        options.resultMethod === 'GET'
          ? await fetch(`${options.resultUrl}?${form}`)
          : await fetch(options.resultUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: form,
            });
      log(`ResultURL ← HTTP ${response.status} ${(await response.text()).slice(0, 60)}`);
    } catch (err) {
      // The bank mails the merchant's support and considers the call done.
      log(`ResultURL недоступен: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleSoap(envelopeXml: string): string {
    const envelope = parseXml(envelopeXml);
    const body = findLocal(envelope, 'Body');
    const call = body?.children.find((n): n is XmlElement => n.type === 'element');
    if (!call) throw new Error('SOAP <Body> is empty');
    const fn = (call.name.includes(':') ? call.name.split(':')[1] : call.name) as WebServiceFunction;

    const merchantId = text(call, 'MerchantId')?.trim() ?? '';
    const invoiceId = text(call, 'InvoiceId')?.trim() ?? '';
    const amountField =
      fn === 'RefundOperation' ? 'refundAmount' : fn === 'ComplitionOperation' ? 'complitionAmount' : null;
    const amountRaw = amountField ? (text(call, amountField)?.trim() ?? '') : null;
    const expected = serviceSignature(
      merchantId,
      amountRaw === null ? [invoiceId] : [invoiceId, amountRaw],
      options.merchantPass,
    );
    calls.push([fn, invoiceId, amountRaw].filter(Boolean).join(' '));

    let document: XmlElement;
    if (merchantId !== options.merchantLogin || !signaturesMatch(expected, text(call, 'Signature'))) {
      document = stateResponse(0, 'Ошибка проверки подписи', null);
    } else {
      document = dispatch(fn, invoiceId, amountRaw === null ? null : Number(amountRaw));
    }
    log(`${fn} ${invoiceId} → ${text(document.children[0] as XmlElement, 'Description') ?? ''}`);

    const responseB64 = Buffer.from(serializeDocument(document), 'utf8').toString('base64');
    const signer = createSign('sha256');
    signer.update(Buffer.from(responseB64, 'base64'));
    const signature = signer.sign(options.bankPrivateKeyPem).toString('base64');
    const signed = serializeDocument(buildElement('envelope', { response: responseB64, signature }));
    const result = Buffer.from(signed, 'utf8').toString('base64');

    return serializeDocument({
      type: 'element',
      name: 'soap:Envelope',
      attrs: [{ name: 'xmlns:soap', value: SOAP_NS }],
      children: [
        element('soap:Body', [
          buildElement(`${fn}Response`, { [`${fn}Result`]: result }, [{ name: 'xmlns', value: SERVICE_NS }]),
        ]),
      ],
    });
  }

  function dispatch(fn: WebServiceFunction, invoiceId: string, amount: number | null): XmlElement {
    const invoice = invoices.get(invoiceId);
    if (!invoice) return stateResponse(0, 'Счёт не найден', null);

    switch (fn) {
      case 'GetState':
        return stateResponse(1, 'OK', invoice);
      case 'CancelOperation':
        if (bank.refuseCancel) return stateResponse(0, 'Отмена возможна только в день оплаты', invoice);
        if (invoice.state !== WEB_STATE.PAID) return stateResponse(0, 'Счёт не оплачен', invoice);
        invoice.state = WEB_STATE.CANCELLED;
        return stateResponse(1, 'OK', invoice);
      case 'RefundOperation': {
        if (invoice.state !== WEB_STATE.PAID || (invoice.preauth && !invoice.completed)) {
          return stateResponse(0, 'Возврат невозможен', invoice);
        }
        const refund = amount ?? 0;
        if (refund <= 0 || invoice.refunded + refund > invoice.sum) {
          return stateResponse(0, 'Некорректная сумма возврата', invoice);
        }
        invoice.refunded += refund;
        return stateResponse(1, 'OK', invoice);
      }
      case 'ComplitionOperation': {
        if (invoice.state !== WEB_STATE.PAID || !invoice.preauth || invoice.completed) {
          return stateResponse(0, 'Операция не является предавторизацией', invoice);
        }
        const capture = amount ?? 0;
        if (capture <= 0 || capture > Math.floor(invoice.sum * 1.1)) {
          return stateResponse(0, 'Сумма превышает 110% от заблокированной', invoice);
        }
        invoice.sum = capture;
        invoice.completed = true;
        return stateResponse(1, 'OK', invoice);
      }
    }
  }

  return bank;
}

function stateResponse(code: number, description: string, invoice: SandboxInvoice | null): XmlElement {
  const children: XmlElement[] = [element('Result', [leaf('Code', String(code)), leaf('Description', description)])];
  if (invoice && code === 1) {
    children.push(
      element('StateInfo', [
        leaf('state', String(invoice.state)),
        leaf('statedescription', STATE_NAMES[invoice.state] ?? ''),
        leaf('istest', invoice.isTest ? '1' : '0'),
        leaf('sum', String(invoice.sum)),
        leaf('currency', invoice.currency),
        leaf('date', invoice.createdAt),
        leaf('enddate', invoice.paidAt ?? ''),
        leaf('invoiceid', invoice.nivid),
        leaf('lifetime', String(invoice.lifetimeMinutes)),
        leaf('description', invoice.description),
        leaf('rrn', invoice.state === WEB_STATE.NOT_PAID ? '' : invoice.rrn),
        leaf('lastdgt', invoice.state === WEB_STATE.NOT_PAID ? '' : invoice.lastDigits),
        leaf('usepreauth', invoice.preauth ? '1' : '0'),
        leaf('terminalid', 'E1016682'),
        element('trx', [
          leaf('operationtype', invoice.preauth ? 'Preauthorization' : 'Purchase'),
          leaf('pan', `910401******${invoice.lastDigits}`),
          leaf('rrn', invoice.rrn),
          leaf('responsecode', '00'),
          leaf('authcode', '3HH5RC'),
          leaf('amount', String(invoice.sum)),
          leaf('currency', invoice.currency),
          leaf('isreversal', invoice.state === WEB_STATE.CANCELLED ? '1' : '0'),
        ]),
      ]),
    );
  }
  return element('OperationStateResponse', children);
}

const STATE_NAMES: Record<number, string> = {
  [WEB_STATE.NOT_PAID]: 'Не оплачен',
  [WEB_STATE.PAID]: 'Оплачен',
  [WEB_STATE.CANCELLED]: 'Платёж отменён',
  [WEB_STATE.ERROR]: 'Ошибка платежа',
  [WEB_STATE.EXPIRED]: 'Платёж просрочен',
};

function findLocal(el: XmlElement, localName: string): XmlElement | null {
  for (const node of el.children) {
    if (node.type !== 'element') continue;
    if (node.name === localName || node.name.endsWith(`:${localName}`)) return node;
  }
  return null;
}

function formParams(req: IncomingMessage, body: string): Record<string, string> {
  if (!body || !(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) return {};
  return Object.fromEntries(new URLSearchParams(body));
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

function ddmmyyyy(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getDate())}${pad(date.getMonth() + 1)}${date.getFullYear()}`;
}

function element(name: string, children: XmlElement[]): XmlElement {
  return { type: 'element', name, attrs: [], children };
}

function leaf(name: string, value: string): XmlElement {
  return { type: 'element', name, attrs: [], children: [{ type: 'text', value }] };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Клевер — песочница</title><body>${body}</body></html>`,
  );
}

function json(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}
