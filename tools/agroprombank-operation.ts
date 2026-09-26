/**
 * The bank's own record of one operation, by our invoice id.
 *
 * Read-only: `GetOperation` (or `CheckOperation` with AGROPROMBANK_FN) for an
 * invoice we sent. For support, when a charge came back with a message that
 * says nothing — "Произошла ошибка" — and the bank's record of the operation
 * may say more, or show that the operation never got that far.
 *
 *   AGROPROMBANK_MERCHANT_ID=... AGROPROMBANK_TERMINAL_ID=... \
 *   AGROPROMBANK_PRIVATE_KEY_FILE=... AGROPROMBANK_CERTIFICATE_FILE=... \
 *   [AGROPROMBANK_BANK_CERTIFICATE_FILE=...] pnpm agro:operation <invoiceid>
 *
 * Signs the way the API does, with our certificate in <KeyInfo> unless
 * AGROPROMBANK_INCLUDE_KEYINFO=false: without it the production gateway
 * answers "Ошибка проверки подписи".
 *
 * Run it where the merchant key lives (the production host); the key never
 * needs to leave it.
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_ENDPOINT, DEFAULT_NAMESPACE } from '../apps/api/src/app/payments/agroprombank/constants';
import {
  type XmlElement,
  buildElement,
  child,
  parseXml,
  serializeDocument,
  text,
  textOf,
} from '../apps/api/src/app/payments/agroprombank/xml';
import { signXml, verifyXml } from '../apps/api/src/app/payments/agroprombank/xmldsig';

/* eslint-disable no-console */

const endpoint = process.env['AGROPROMBANK_ENDPOINT'] || DEFAULT_ENDPOINT;
const namespace = process.env['AGROPROMBANK_NAMESPACE'] || DEFAULT_NAMESPACE;
const merchantId = process.env['AGROPROMBANK_MERCHANT_ID'] ?? '';
const terminalId = process.env['AGROPROMBANK_TERMINAL_ID'] ?? '';
const keyPath = process.env['AGROPROMBANK_PRIVATE_KEY_FILE'] ?? '';
const certPath = process.env['AGROPROMBANK_CERTIFICATE_FILE'] ?? '';
const includeKeyInfo = process.env['AGROPROMBANK_INCLUDE_KEYINFO']?.trim().toLowerCase() !== 'false';
const bankCertPath = process.env['AGROPROMBANK_BANK_CERTIFICATE_FILE'] ?? '';
const fn = process.env['AGROPROMBANK_FN'] || 'GetOperation';
const invoiceId = process.argv[2] ?? '';

function envelope(): string {
  const request = signXml(buildElement('root', { terminalid: terminalId, invoiceid: invoiceId }), {
    privateKeyPem: readFileSync(keyPath, 'utf8'),
    certificatePem: certPath ? readFileSync(certPath, 'utf8') : null,
    includeKeyInfo: includeKeyInfo && Boolean(certPath),
  });
  return serializeDocument({
    type: 'element',
    name: 'soap:Envelope',
    attrs: [{ name: 'xmlns:soap', value: 'http://schemas.xmlsoap.org/soap/envelope/' }],
    children: [
      {
        type: 'element',
        name: 'soap:Body',
        attrs: [],
        children: [buildElement(fn, { merchantId, request }, [{ name: 'xmlns', value: namespace }])],
      },
    ],
  });
}

/** Every element of the answer, nested, except the signature. */
function print(el: XmlElement, indent = ''): void {
  for (const node of el.children) {
    if (node.type !== 'element' || /(^|:)Signature$/.test(node.name)) continue;
    const isLeaf = node.children.every((c) => c.type !== 'element');
    if (isLeaf) {
      console.log(`${indent}${node.name}: ${textOf(node).trim()}`);
    } else {
      console.log(`${indent}${node.name}:`);
      print(node, `${indent}  `);
    }
  }
}

async function main(): Promise<number> {
  if (!merchantId || !terminalId || !keyPath || !invoiceId) {
    console.error(
      'usage: AGROPROMBANK_MERCHANT_ID, AGROPROMBANK_TERMINAL_ID, AGROPROMBANK_PRIVATE_KEY_FILE set; argument: invoiceid',
    );
    return 2;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${namespace}/${fn}` },
    body: envelope(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  console.log(`${fn} ${invoiceId}: HTTP ${response.status}`);

  const soap = parseXml(body);
  const soapBody = child(soap, 'soap:Body') ?? child(soap, 'Body');
  const fault = soapBody ? (child(soapBody, 'soap:Fault') ?? child(soapBody, 'Fault')) : null;
  if (!soapBody || fault) {
    console.log(fault ? `SOAP fault: ${text(fault, 'faultstring') ?? textOf(fault).trim()}` : body.slice(0, 400));
    return 3;
  }
  const call = soapBody.children.find((n): n is XmlElement => n.type === 'element');
  const result = call ? text(call, `${fn}Result`) : null;
  if (result === null) {
    console.log(`no <${fn}Result> in: ${body.slice(0, 400)}`);
    return 3;
  }

  if (bankCertPath) {
    const verdict = verifyXml(result, readFileSync(bankCertPath, 'utf8'));
    console.log(`bank signature: ${verdict.valid ? 'valid' : `INVALID - ${verdict.reason}`}`);
  }
  if (process.env['AGROPROMBANK_RAW'] === '1') {
    console.log(result.replace(/<Signature[\s\S]*<\/Signature>/, '<Signature …/>'));
  }
  print(parseXml(result));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(5);
  },
);
