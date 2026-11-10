import { parseXml, text } from '../agroprombank/xml';
import { DEFAULT_QR_CODE_FORMAT, DEFAULT_QR_NAMESPACE } from './constants';
import {
  QrFault,
  QrProtocolError,
  buildQrRequest,
  formatAppLink,
  formatQrCode,
  matchPaidAmount,
  parseQrPayments,
  parseQrPaymentsResult,
  paymentsXml,
  readPaymentId,
  readQrResponse,
  selectPaymentRecord,
  soapAction,
} from './protocol';

/** The callback example of the bank's documentation, as it is written there. */
const DOC_CALLBACK = `<Payments>
    <Payment>
        <qrpaymentid>5229848</qrpaymentid>
        <qrterminalid>QRT169007299815722</qrterminalid>
        <currencyabbr>RUP</currencyabbr>
        <currencycode>000</currencycode>
        <trxreferencenumber>000602981706</trxreferencenumber>
        <transactionamount>1</transactionamount>
        <transactioncurrency>000</transactioncurrency>
        <paymentdate>14.04.2023 17:15:26</paymentdate>
        <amount>1</amount>
        <state>2</state>
        <statedescription>Оплачен</statedescription>
        <pointaddress>г. Тирасполь, передвижная точка</pointaddress>
        <specialinfo>***********</specialinfo>
        <createdate>14.04.2023 17:13:47</createdate>
        <externalid>40</externalid>
    </Payment>
</Payments>`;

const SOAP = (body: string): string =>
  '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body>${body}</soap:Body></soap:Envelope>`;

describe('QR payment protocol', () => {
  describe('request', () => {
    const credentials = { login: 'takeaway', password: 'p&ss<word>', externalToken: '' };

    it('carries QRMCredentials with DeviceId and PushId -1, and the arguments in order', () => {
      const xml = buildQrRequest('CreatePaymentID', DEFAULT_QR_NAMESPACE, credentials, [
        ['terminalid', 'QRT169007299815722'],
        ['amount', '1250'],
        ['currencycode', '000'],
        ['extid', '1100042'],
      ]);
      const envelope = parseXml(xml);
      const header = envelope.children.find((n) => n.type === 'element' && n.name === 'soap:Header');
      const creds = header?.type === 'element' ? header.children[0] : undefined;

      expect(creds?.type === 'element' && creds.attrs).toEqual([{ name: 'xmlns', value: DEFAULT_QR_NAMESPACE }]);
      if (creds?.type !== 'element') throw new Error('no credentials');
      expect(text(creds, 'Login')).toBe('takeaway');
      expect(text(creds, 'Password')).toBe('p&ss<word>');
      expect(text(creds, 'DeviceId')).toBe('-1');
      expect(text(creds, 'PushId')).toBe('-1');
      expect(text(creds, 'ExternalToken')).toBe('');
      expect(xml).toContain(
        '<CreatePaymentID xmlns="http://services.agroprombank.com/"><terminalid>QRT169007299815722</terminalid>' +
          '<amount>1250</amount><currencycode>000</currencycode><extid>1100042</extid></CreatePaymentID>',
      );
    });

    it('sends login and password empty when the bank issued a token instead', () => {
      const xml = buildQrRequest(
        'ClosePaymentExtId',
        DEFAULT_QR_NAMESPACE,
        { ...credentials, externalToken: 'tok' },
        [],
      );
      expect(xml).toContain('<Login></Login><Password></Password>');
      expect(xml).toContain('<ExternalToken>tok</ExternalToken>');
    });

    it('keeps the bank spelling of ReversePayment arguments', () => {
      const xml = buildQrRequest('ReversePayment', DEFAULT_QR_NAMESPACE, credentials, [
        ['qrterminal', 'QRT169007299815722'],
        ['paymetid', '5229848'],
        ['rrn', '000602981706'],
      ]);
      expect(xml).toContain('<paymetid>5229848</paymetid>');
    });

    it('names the SOAPAction as namespace plus function, with or without the trailing slash', () => {
      expect(soapAction(DEFAULT_QR_NAMESPACE, 'GetPaymentStateExtId')).toBe(
        'http://services.agroprombank.com/GetPaymentStateExtId',
      );
      expect(soapAction('http://services.agroprombank.com', 'ReversePayment')).toBe(
        'http://services.agroprombank.com/ReversePayment',
      );
    });
  });

  describe('response', () => {
    it('finds the result even inside the wrapper the documentation misnames', () => {
      const result = readQrResponse(
        'CreatePaymentID',
        SOAP(
          '<CreatePaymentResponse xmlns="http://services.agroprombank.com/">' +
            '<CreatePaymentIDResult>5229848</CreatePaymentIDResult></CreatePaymentResponse>',
        ),
      );
      expect(readPaymentId('CreatePaymentID', result)).toBe('5229848');
    });

    it('reads a decimal id written with a fraction', () => {
      const result = readQrResponse(
        'CreatePaymentID',
        SOAP(
          '<CreatePaymentIDResponse><CreatePaymentIDResult>5229848.0</CreatePaymentIDResult></CreatePaymentIDResponse>',
        ),
      );
      expect(readPaymentId('CreatePaymentID', result)).toBe('5229848');
    });

    it('treats a missing or zero id as the bank saying no', () => {
      expect(() => readPaymentId('CreatePaymentID', null)).toThrow(QrFault);
      const zero = readQrResponse(
        'CreatePaymentID',
        SOAP('<CreatePaymentIDResponse><CreatePaymentIDResult>0</CreatePaymentIDResult></CreatePaymentIDResponse>'),
      );
      expect(() => readPaymentId('CreatePaymentID', zero)).toThrow(QrFault);
    });

    it('answers null for the functions that return nothing', () => {
      expect(
        readQrResponse('ReversePayment', SOAP('<ReversePaymentResponse xmlns="http://services.agroprombank.com/" />')),
      ).toBeNull();
    });

    it('turns a SOAP fault into the bank refusing, with its reason', () => {
      const fault = SOAP(
        '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Платёж не найден</faultstring></soap:Fault>',
      );
      expect(() => readQrResponse('ClosePaymentExtId', fault)).toThrow(
        expect.objectContaining({ name: 'QrFault', faultString: 'Платёж не найден' }),
      );
    });

    it('turns garbage into a protocol error, not a refusal', () => {
      expect(() => readQrResponse('GetPaymentStateExtId', '<html>502 Bad Gateway')).toThrow(QrProtocolError);
      expect(() => readQrResponse('GetPaymentStateExtId', '<a/>')).toThrow(QrProtocolError);
    });
  });

  describe('payments XML', () => {
    it("reads the documentation's callback example", () => {
      const [record] = parseQrPayments('callback', DOC_CALLBACK);
      expect(record).toEqual({
        qrPaymentId: '5229848',
        terminalId: 'QRT169007299815722',
        externalId: '40',
        state: 2,
        stateDescription: 'Оплачен',
        amount: '1',
        transactionAmount: '1',
        currencyCode: '000',
        transactionCurrency: '000',
        rrn: '000602981706',
        paymentDate: '14.04.2023 17:15:26',
        createDate: '14.04.2023 17:13:47',
      });
    });

    it('reads the state the bank sends as an escaped string inside the result', () => {
      const escaped = DOC_CALLBACK.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const result = readQrResponse(
        'GetPaymentStateExtId',
        SOAP(
          `<GetPaymentStateExtIdResponse><GetPaymentStateExtIdResult>${escaped}</GetPaymentStateExtIdResult></GetPaymentStateExtIdResponse>`,
        ),
      );
      expect(parseQrPaymentsResult('GetPaymentStateExtId', result)).toHaveLength(1);
    });

    it('reads the state inlined as elements too, and an empty result as no payment', () => {
      const inline = readQrResponse(
        'GetPaymentStateExtId',
        SOAP(
          `<GetPaymentStateExtIdResponse><GetPaymentStateExtIdResult>${DOC_CALLBACK}</GetPaymentStateExtIdResult></GetPaymentStateExtIdResponse>`,
        ),
      );
      expect(parseQrPaymentsResult('GetPaymentStateExtId', inline)[0]?.rrn).toBe('000602981706');
      const empty = readQrResponse(
        'GetPaymentStateExtId',
        SOAP('<GetPaymentStateExtIdResponse><GetPaymentStateExtIdResult /></GetPaymentStateExtIdResponse>'),
      );
      expect(parseQrPaymentsResult('GetPaymentStateExtId', empty)).toEqual([]);
      expect(parseQrPayments('callback', '<Payments />')).toEqual([]);
      expect(parseQrPayments('callback', '   ')).toEqual([]);
    });

    it('refuses XML that is not well-formed', () => {
      expect(() => parseQrPayments('callback', '<Payments><Payment>')).toThrow(QrProtocolError);
    });

    it('picks our invoice, the paid record first', () => {
      const records = parseQrPayments(
        'callback',
        paymentsXml([
          { qrPaymentId: '1', externalId: '41', state: 3 },
          { qrPaymentId: '2', externalId: '40', state: 1 },
          { qrPaymentId: '3', externalId: '40', state: 2 },
        ]),
      );
      expect(selectPaymentRecord(records, '40')?.qrPaymentId).toBe('3');
      expect(selectPaymentRecord(records, '42')).toBeNull();
    });

    it('writes what it reads', () => {
      const [record] = parseQrPayments('callback', DOC_CALLBACK);
      if (!record) throw new Error('no record');
      expect(parseQrPayments('callback', paymentsXml([record]))).toEqual([record]);
    });
  });

  describe('paid amount', () => {
    const record = (amount: string | null, transactionAmount: string | null = amount, currency = '000') => ({
      ...(parseQrPayments('callback', DOC_CALLBACK)[0] as NonNullable<ReturnType<typeof parseQrPayments>[0]>),
      amount,
      transactionAmount,
      currencyCode: currency,
    });

    it('accepts kopecks', () => {
      expect(matchPaidAmount(record('1250'), 1250, '000')).toEqual({
        matches: true,
        readings: { amount: 'kopecks', transactionamount: 'kopecks' },
      });
    });

    it('accepts rubles, with a point or a comma', () => {
      expect(matchPaidAmount(record('12.50', '12,5'), 1250, '000')).toEqual({
        matches: true,
        readings: { amount: 'rubles', transactionamount: 'rubles' },
      });
    });

    it('reads 1 as one kopeck or one ruble, as the documentation leaves open', () => {
      expect(matchPaidAmount(record('1'), 1, '000')).toMatchObject({ readings: { amount: 'kopecks' } });
      expect(matchPaidAmount(record('1'), 100, '000')).toMatchObject({ readings: { amount: 'rubles' } });
    });

    it('refuses a sum that fits neither reading, or another currency', () => {
      expect(matchPaidAmount(record('1249'), 1250, '000')).toMatchObject({ matches: false });
      expect(matchPaidAmount(record('1250', '9999'), 1250, '000')).toMatchObject({ matches: false });
      expect(matchPaidAmount(record('1250', '1250', '840'), 1250, '000')).toMatchObject({
        matches: false,
        reason: expect.stringContaining('840'),
      });
    });

    it('accepts a record that carries no sum: the invoice fixed it', () => {
      expect(matchPaidAmount(record(null, null), 1250, '000')).toEqual({ matches: true, readings: {} });
    });
  });

  describe('QR code', () => {
    const values = { terminal: 'QRT169007299815722', amountKopecks: 1250, extid: '1100042' };

    it('reads terminal:rubles:extid by default', () => {
      expect(formatQrCode(DEFAULT_QR_CODE_FORMAT, values)).toBe('QRT169007299815722:12.50:1100042');
    });

    it('follows the configured format, kopecks included', () => {
      expect(formatQrCode('{terminal}:{kop}:{extid}', values)).toBe('QRT169007299815722:1250:1100042');
      expect(formatQrCode('{terminal}::{extid}', values)).toBe('QRT169007299815722::1100042');
    });

    it('builds the app link with every placeholder URL-encoded', () => {
      const code = formatQrCode(DEFAULT_QR_CODE_FORMAT, values);
      expect(formatAppLink('https://pay.example/qr?c={code}&e={extid}&t={terminal}', { ...values, code })).toBe(
        'https://pay.example/qr?c=QRT169007299815722%3A12.50%3A1100042&e=1100042&t=QRT169007299815722',
      );
      expect(formatAppLink(null, { ...values, code })).toBeNull();
    });
  });
});
