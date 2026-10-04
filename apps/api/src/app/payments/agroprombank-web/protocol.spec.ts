import { createHash, createSign, generateKeyPairSync } from 'node:crypto';

import {
  WebServiceProtocolError,
  bankDay,
  decodeServiceResult,
  md5Signature,
  normalizeParams,
  paymentDescription,
  paymentPageFields,
  paymentPageUrl,
  readOperationState,
  readResult,
  serviceSignature,
  unwrapSoapResult,
  verifyResultSignature,
  verifyServiceSignature,
} from './protocol';

const md5 = (s: string): string => createHash('md5').update(s, 'utf8').digest('hex');

describe('Web-платёж protocol', () => {
  describe('signatures', () => {
    it('hashes the fields joined with colons, pass last', () => {
      expect(md5Signature('000123', '123456', 0, 1524, '000', 'Счет №123456', 'secret')).toBe(
        md5('000123:123456:0:1524:000:Счет №123456:secret'),
      );
    });

    it('signs the payment page in the documented order', () => {
      const fields = paymentPageFields({
        merchantLogin: '000123',
        merchantPass: 'secret',
        nivid: '1100042',
        sum: 1524,
        currencyCode: '000',
        description: 'takeAway order 4242',
        isTest: true,
        lifetimeMinutes: 15,
        preauth: true,
      });

      expect(fields).toEqual({
        MerchantLogin: '000123',
        RequestSum: '1524',
        RequestCurrCode: '000',
        nivid: '1100042',
        Desc: 'takeAway order 4242',
        IsTest: '1',
        LifeTime: '15',
        SignatureValue: md5('000123:1100042:1:1524:000:takeAway order 4242:secret'),
        ispreauth: '1',
      });
      const url = new URL(paymentPageUrl('https://epay.apb.online/PaymentStart', fields));
      expect(url.searchParams.get('SignatureValue')).toBe(fields['SignatureValue']);
      expect(url.searchParams.get('Desc')).toBe('takeAway order 4242');
    });

    it('keeps the description ASCII and within 250 characters', () => {
      expect(paymentDescription('4242')).toBe('takeAway order 4242');
      expect(paymentDescription('Заказ1')).toBe('takeAway order 1');
      expect(paymentDescription('x'.repeat(400))).toHaveLength(250);
    });

    it('verifies a paid notification', () => {
      const params = {
        status: 'paid',
        invoiceid: '1100042',
        paymentsum: '1524',
        paymentcurrency: '000',
        date: '04102026',
        signature: md5('1100042:paid:1524:000:04102026:secret').toUpperCase(),
      };
      expect(verifyResultSignature(params, 'secret')).toBe(true);
      expect(verifyResultSignature({ ...params, paymentsum: '1' }, 'secret')).toBe(false);
      expect(verifyResultSignature(params, 'other')).toBe(false);
    });

    it('verifies a failed notification over its shorter field list', () => {
      const params = {
        status: 'fail',
        invoiceid: '1100042',
        date: '04102026',
        signature: md5('1100042:fail:04102026:secret'),
      };
      expect(verifyResultSignature(params, 'secret')).toBe(true);
      expect(verifyResultSignature({ ...params, signature: undefined as unknown as string }, 'secret')).toBe(false);
    });

    it('signs web-service calls as MerchantId:args:MerchantPass', () => {
      expect(serviceSignature('000123', ['1100042', 3300], 'secret')).toBe(md5('000123:1100042:3300:secret'));
    });

    it('lower-cases parameter names, whichever way the bank spells them', () => {
      expect(normalizeParams({ InvoiceId: ' 1 ', Status: 'paid', list: ['a', 'b'], empty: undefined })).toEqual({
        invoiceid: '1',
        status: 'paid',
        list: 'a',
      });
    });
  });

  describe('admin web-service responses', () => {
    const bank = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const stranger = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const document =
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?><OperationStateResponse>' +
      '<Result><Code>1</Code><Description>OK</Description></Result>' +
      '<StateInfo><state>1</state><statedescription>Оплачен</statedescription><istest>0</istest>' +
      '<sum>3300</sum><currency>000</currency><invoiceid>1100042</invoiceid><rrn>0007458712</rrn>' +
      '<lastdgt>0123</lastdgt><usepreauth>1</usepreauth>' +
      '<trx><pan>910401******0123</pan><authcode>3HH5RC</authcode></trx></StateInfo></OperationStateResponse>';

    function signed(algorithm: 'sha256' | 'sha1', over: 'document' | 'base64', key = bank.privateKey): string {
      const responseB64 = Buffer.from(document, 'utf8').toString('base64');
      const signer = createSign(algorithm);
      signer.update(over === 'document' ? Buffer.from(document, 'utf8') : Buffer.from(responseB64, 'utf8'));
      const signature = signer.sign(key).toString('base64');
      const envelope = `<?xml version="1.0" encoding="UTF-8"?><envelope><response>${responseB64}</response><signature>${signature}</signature></envelope>`;
      return Buffer.from(envelope, 'utf8').toString('base64');
    }

    it('unwraps base64 → envelope → base64 response and reads the state', () => {
      const decoded = decodeServiceResult('GetState', signed('sha256', 'document'));

      expect(readResult(decoded.document)).toEqual({ code: 1, description: 'OK' });
      expect(readOperationState(decoded.document)).toMatchObject({
        state: 1,
        sum: 3300,
        currency: '000',
        invoiceId: '1100042',
        rrn: '0007458712',
        lastDigits: '0123',
        usePreauth: true,
        authCode: '3HH5RC',
        pan: '910401******0123',
      });
    });

    it.each([
      ['sha256', 'document'],
      ['sha1', 'document'],
      ['sha256', 'base64'],
      ['sha1', 'base64'],
    ] as const)('accepts the bank signature made with rsa-%s over the %s', (algorithm, over) => {
      const verdict = verifyServiceSignature(decodeServiceResult('GetState', signed(algorithm, over)), bank.publicKey);
      expect(verdict).toEqual({ valid: true, variant: `rsa-${algorithm} over ${over}` });
    });

    it('refuses a response signed by anybody else', () => {
      const verdict = verifyServiceSignature(
        decodeServiceResult('GetState', signed('sha256', 'document', stranger.privateKey)),
        bank.publicKey,
      );
      expect(verdict.valid).toBe(false);
    });

    it('refuses an unsigned response', () => {
      const decoded = decodeServiceResult('GetState', Buffer.from(document).toString('base64'));
      expect(decoded.signature).toBeNull();
      expect(verifyServiceSignature(decoded, bank.publicKey)).toEqual({
        valid: false,
        reason: 'response is not signed',
      });
    });

    it('reads a usepreauth the bank left out as unknown', () => {
      const decoded = decodeServiceResult(
        'GetState',
        '<r><Result><Code>1</Code></Result><StateInfo><state>0</state></StateInfo></r>',
      );
      expect(readOperationState(decoded.document).usePreauth).toBeNull();
    });

    it('takes <FnResult> out of the SOAP envelope and surfaces faults', () => {
      const ok =
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
        '<GetStateResponse xmlns="http://services.agroprombank.com"><GetStateResult>QUJD</GetStateResult></GetStateResponse>' +
        '</soap:Body></soap:Envelope>';
      expect(unwrapSoapResult('GetState', ok)).toBe('QUJD');

      const fault =
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>' +
        '<faultstring>Server was unable to process request</faultstring></s:Fault></s:Body></s:Envelope>';
      expect(() => unwrapSoapResult('GetState', fault)).toThrow(WebServiceProtocolError);
      expect(() => unwrapSoapResult('GetState', fault)).toThrow(/unable to process/);
    });
  });

  it('counts the day of payment in Transnistria', () => {
    // 22:30 UTC on 3 October is already 4 October in Tiraspol (UTC+3).
    expect(bankDay(new Date('2026-10-03T22:30:00Z'))).toBe('2026-10-04');
  });
});
