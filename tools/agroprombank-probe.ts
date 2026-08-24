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
 *   AGROPROMBANK_MERCHANT_ID=... AGROPROMBANK_PRIVATE_KEY_FILE=... pnpm agro:probe
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_ENDPOINT, DEFAULT_NAMESPACE } from '../apps/api/src/app/payments/agroprombank/constants';
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

/* eslint-disable no-console */

const endpoint = process.env['AGROPROMBANK_ENDPOINT'] ?? DEFAULT_ENDPOINT;
const namespace = process.env['AGROPROMBANK_NAMESPACE'] ?? DEFAULT_NAMESPACE;
const merchantId = process.env['AGROPROMBANK_MERCHANT_ID'] ?? '';
const keyPath = process.env['AGROPROMBANK_PRIVATE_KEY_FILE'] ?? '';
const bankCertPath = process.env['AGROPROMBANK_BANK_CERTIFICATE_FILE'] ?? '';
const timeoutMs = Number(process.env['AGROPROMBANK_TIMEOUT_MS'] ?? 30_000);

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

function buildEnvelope(): string {
  const request = signXml(buildElement('root', { token: 'PROBE'.padEnd(64, '0') }), {
    privateKeyPem: readFileSync(keyPath, 'utf8'),
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
        children: [buildElement('CheckToken', { merchantId, request }, [{ name: 'xmlns', value: namespace }])],
      },
    ],
  });
}

async function probe(): Promise<number> {
  if (!merchantId) throw new Error('AGROPROMBANK_MERCHANT_ID is required');
  if (!keyPath) throw new Error('AGROPROMBANK_PRIVATE_KEY_FILE is required');

  console.log('');
  console.log('Agroprombank probe');
  line('endpoint', endpoint);
  line('merchantId', merchantId);
  line('signing key', keyPath);
  line('bank certificate', bankCertPath || '(not configured - response not verified)');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let body: string;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${namespace}/CheckToken` },
      body: buildEnvelope(),
      signal: controller.signal,
    });
    body = await response.text();
  } catch (err) {
    console.log('');
    console.log('  [x] network - the gateway could not be reached');
    line('reason', err instanceof Error ? err.message : String(err));
    console.log('  Check outbound access from this host, and whether the bank whitelists the merchant IP.');
    return 2;
  } finally {
    clearTimeout(timer);
  }

  console.log('');
  console.log(`  HTTP ${response.status} ${response.statusText}`);

  let result: string;
  try {
    const soap = parseXml(body);
    const soapBody = child(soap, 'soap:Body') ?? child(soap, 'Body');
    if (!soapBody) throw new Error('response has no SOAP <Body>');

    const fault = child(soapBody, 'soap:Fault') ?? child(soapBody, 'Fault');
    if (fault) {
      console.log('');
      console.log('  [x] protocol - the gateway answered with a SOAP fault');
      line('fault', text(fault, 'faultstring') ?? textOf(fault).trim().slice(0, 300));
      return 3;
    }

    const callResponse = soapBody.children.find((n) => n.type === 'element');
    if (!callResponse || callResponse.type !== 'element') throw new Error('SOAP <Body> is empty');
    const extracted = text(callResponse, 'CheckTokenResult');
    if (extracted === null) throw new Error('response has no <CheckTokenResult>');
    result = extracted;
  } catch (err) {
    console.log('');
    console.log('  [x] protocol - the response does not match the documented contract');
    line('reason', err instanceof Error ? err.message : String(err));
    console.log(`  first 400 bytes: ${body.slice(0, 400)}`);
    return 3;
  }

  const root = parseXml(result);
  const code = num(root, 'result');
  const errorCode = num(root, 'errorcode');
  const errorText = text(root, 'error');

  console.log('');
  console.log('  Bank replied:');
  line('result', String(code));
  if (errorCode !== null) line('errorcode', String(errorCode));
  if (errorText) line('error', errorText);

  if (bankCertPath) {
    const verdict = verifyXml(result, readFileSync(bankCertPath, 'utf8'));
    line('signature', verdict.valid ? 'valid' : `INVALID - ${verdict.reason}`);
    if (!verdict.valid) {
      console.log('');
      console.log('  [x] credentials - the response is not signed by the configured bank certificate');
      return 4;
    }
  }

  if (code === 1) {
    console.log('');
    console.log('  [ok] the bank accepted our signature and merchant id');
    return 0;
  }

  // A rejected *probe token* is the expected good answer here: it means the
  // bank got far enough to look the token up, which is only possible once our
  // signature and merchant id checked out.
  console.log('');
  console.log('  [!] the bank rejected the request.');
  console.log('      certificate / signature / merchant in the message -> credentials not in place yet');
  console.log('      token in the message -> everything else works; the probe token is meant not to exist');
  return 1;
}

probe().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(5);
  },
);
