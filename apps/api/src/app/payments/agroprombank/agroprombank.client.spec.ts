import { AgroprombankTransportError, unwrapSoapResult } from './agroprombank.client';

const NS = 'http://services.agroprombank.com';

function envelope(inner: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<soap:Body>${inner}</soap:Body></soap:Envelope>`
  );
}

describe('unwrapSoapResult', () => {
  it('extracts the signed payload from a SOAP 1.1 response', () => {
    const payload =
      '<?xml version="1.0" encoding="UTF-8"?><root><result>1</result><requestid>123456</requestid></root>';
    const soap = envelope(
      `<NewTokenRequestResponse xmlns="${NS}"><NewTokenRequestResult>${escapeXml(payload)}` +
        '</NewTokenRequestResult></NewTokenRequestResponse>',
    );
    expect(unwrapSoapResult('NewTokenRequest', soap)).toBe(payload);
  });

  it('reads a payload the gateway wrapped in CDATA', () => {
    const payload = '<root><result>1</result></root>';
    const soap = envelope(
      `<CheckTokenResponse xmlns="${NS}"><CheckTokenResult><![CDATA[${payload}]]></CheckTokenResult>` +
        '</CheckTokenResponse>',
    );
    expect(unwrapSoapResult('CheckToken', soap)).toBe(payload);
  });

  it('surfaces a SOAP fault as a transport error', () => {
    const soap = envelope(
      '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Merchant not found</faultstring></soap:Fault>',
    );
    expect(() => unwrapSoapResult('CheckToken', soap)).toThrow(AgroprombankTransportError);
    expect(() => unwrapSoapResult('CheckToken', soap)).toThrow('Merchant not found');
  });

  it('rejects a response whose result element is missing', () => {
    const soap = envelope(`<CheckTokenResponse xmlns="${NS}"><Something>1</Something></CheckTokenResponse>`);
    expect(() => unwrapSoapResult('CheckToken', soap)).toThrow('<CheckTokenResult>');
  });

  it('rejects an envelope with no body', () => {
    const soap = '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"/>';
    expect(() => unwrapSoapResult('CheckToken', soap)).toThrow('no <Body>');
  });

  it('rejects a non-XML gateway response instead of passing it downstream', () => {
    expect(() => unwrapSoapResult('CheckToken', '<html><body>502 Bad Gateway</body></html>')).toThrow(
      AgroprombankTransportError,
    );
  });
});

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
