/**
 * Connectivity and credential probe for the Agroprombank gateway.
 *
 * Sends one harmless, non-mutating `CheckToken` for a token that does not
 * exist, and reports exactly how far the request got:
 *
 *   network      — the gateway is unreachable / TLS or firewall problem
 *   protocol     — reachable, but the SOAP contract does not match
 *   credentials  — reachable and well-formed, but the bank rejects our
 *                  signature or merchant id (expected until the CA issues the
 *                  merchant certificate)
 *   ok           — the bank accepted our signature and answered as itself
 *
 * Run it once before going live, and again after installing the real key:
 *
 *   AGROPROMBANK_MERCHANT_ID=... \
 *   AGROPROMBANK_PRIVATE_KEY_FILE=... \
 *   AGROPROMBANK_BANK_CERTIFICATE_FILE=... \
 *   tsx tools/agroprombank-probe.ts
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_ENDPOINT, DEFAULT_NAMESPACE } from '../apps/api/src/app/payments/agroprombank/agroprombank.config';
import {
  buildElement,
  child,
  num,
  parseXml,
  serializeDocument,
  text,
  textOf,
} from '../apps/api/src/app/payments/agroprombank/xml';
import { signXml, verifyXml } from '../apps/api/src/app/payments/agroprombank/xmldsig';

const endpoint = process.env['AGROPROMBANK_ENDPOINT'] ?? DEFAULT_ENDPOINT;
const namespace = process.env['AGROPROMBANK_NAMESPACE'] ?? DEFAULT_NAMESPACE;
const merchantId = process.env['AGROPROMBANK_MERCHANT_ID'] ?? '';
const keyPath = process.env['AGROPROMBANK_PRIVATE_KEY_FILE'] ?? '';
const bankCertPath = process.env['AGROPROMBANK_BANK_CERTIFICATE_FILE'] ?? '';
const timeoutMs = Number(process.env['AGROPROMBANK_TIMEOUT_MS'] ?? 30_000);

/* eslint-disable no-console */
function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

if (!merchantId) throw new Error('AGROPROMBANK_MERCHANT_ID is required');
if (!keyPath) throw new Error('AGROPROMBANK_PRIVATE_KEY_FILE is required');

console.log('\nAgroprombank probe');
line('endpoint', endpoint);
line('merchantId', merchantId);
line('signing key', keyPath);
line('bank certificate', bankCertPath || '(not configured — response not verified)');

const request = signXml(buildElement('root', { token: 'PROBE'.padEnd(64, '0') }), {
  privateKeyPem: readFileSync(keyPath, 'utf8'),
});

const envelope = serializeDocument({
  type: 'element',
  name: 'soap:Envelope',
  attrs: [{ name: 'xmlns:soap', value: 'http://schemas.xmlsoap.org/soap/envelope/' }],
  children: [
    {
      type: 'element',
      name: 'soap:Body',
      attrs: [],
      children: [buildElement('CheckToken', { merchantId, request }, [{ name: 'xmlns', value: namespace }])],
    },
  ],
});

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

let response: Response;
let body: string;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${namespace}/CheckToken` },
    body: envelope,
    signal: controller.signal,
  });
  body = await response.text();
} catch (err) {
  clearTimeout(timer);
  console.log('\n  ✗ network — the gateway could not be reached');
  line('reason', err instanceof Error ? err.message : String(err));
  console.log('\nCheck outbound access from this host, and whether the bank whitelists the merchant IP.\n');
  process.exit(2);
}
clearTimeout(timer);

console.log(`\n  HTTP ${response.status} ${response.statusText}`);

let result: string;
try {
  const soap = parseXml(body);
  const soapBody = child(soap, 'soap:Body') ?? child(soap, 'Body');
  if (!soapBody) throw new Error('response has no SOAP <Body>');

  const fault = child(soapBody, 'soap:Fault') ?? child(soapBody, 'Fault');
  if (fault) {
    console.log('\n  ✗ protocol — the gateway answered with a SOAP fault');
    line('fault', text(fault, 'faultstring') ?? textOf(fault).trim().slice(0, 300));
    process.exit(3);
  }

  const callResponse = soapBody.children.find((n) => n.type === 'element');
  if (!callResponse || callResponse.type !== 'element') throw new Error('SOAP <Body> is empty');
  const extracted = text(callResponse, 'CheckTokenResult');
  if (extracted === null) throw new Error('response has no <CheckTokenResult>');
  result = extracted;
} catch (err) {
  console.log('\n  ✗ protocol — the response does not match the documented contract');
  line('reason', err instanceof Error ? err.message : String(err));
  console.log(`\n  first 400 bytes:\n${body.slice(0, 400)}\n`);
  process.exit(3);
}

const root = parseXml(result);
const code = num(root, 'result');
const errorCode = num(root, 'errorcode');
const errorText = text(root, 'error');

console.log('\n  Bank replied:');
line('result', String(code));
if (errorCode !== null) line('errorcode', String(errorCode));
if (errorText) line('error', errorText);

if (bankCertPath) {
  const verdict = verifyXml(result, readFileSync(bankCertPath, 'utf8'));
  line('signature', verdict.valid ? 'valid' : `INVALID — ${verdict.reason}`);
  if (!verdict.valid) {
    console.log('\n  ✗ credentials — the response is not signed by the configured bank certificate\n');
    process.exit(4);
  }
}

if (code === 1) {
  console.log('\n  ✓ ok — the bank accepted our signature and merchant id\n');
  process.exit(0);
}

// A rejected *probe token* is the expected happy answer here: it means the
// bank got far enough to look the token up, which is only possible once our
// signature and merchant id checked out.
console.log(
  '\n  ⚠ the bank rejected the request. If the message is about the certificate, signature or merchant,\n' +
    '    the credentials are not in place yet. If it is about the token, everything else is working —\n' +
    '    the probe token is meant not to exist.\n',
);
process.exit(1);
