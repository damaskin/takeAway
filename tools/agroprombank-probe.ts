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

import { createPrivateKey, X509Certificate } from 'node:crypto';
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
const certPath = process.env['AGROPROMBANK_CERTIFICATE_FILE'] ?? '';
const terminalId = process.env['AGROPROMBANK_TERMINAL_ID'] ?? '';
// Stops before the network call. Useful the moment the bank issues the
// certificate: the key material can be checked without touching the gateway.
const offline = process.env['AGROPROMBANK_PROBE_OFFLINE'] === '1';
const timeoutMs = Number(process.env['AGROPROMBANK_TIMEOUT_MS'] ?? 30_000);

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

/**
 * The bank stamps the contract identifiers into a private extension of the
 * merchant certificate. Reading it back is the one way to tell, before any
 * money moves, that the certificate on this host belongs to the merchant this
 * host thinks it is — a staging certificate in production otherwise surfaces
 * as an opaque rejection from the gateway.
 *
 * There is no ASN.1 parser here and a whole dependency would be silly for one
 * UTF8String: the value is ASCII inside the DER, so we read it out directly —
 * bounded by the string's own declared length, because the DER bytes that
 * follow it are printable often enough to be swallowed by a greedy match.
 */
function identifiersInCertificate(cert: X509Certificate): { merchantId?: string; terminalId?: string } {
  const der = cert.raw.toString('latin1');
  const at = der.indexOf('TerminalId=');
  // UTF8String (tag 0x0c) with a short-form length, which 40-odd bytes always
  // take. Anything else and we would be guessing at where the value ends.
  if (at < 2 || der.charCodeAt(at - 2) !== 0x0c) return {};

  const value = der.slice(at, at + der.charCodeAt(at - 1));
  const match = /^TerminalId=([^,]+),MerchantId=(.+)$/.exec(value);
  return match ? { terminalId: match[1], merchantId: match[2] } : {};
}

/**
 * Everything that can be checked without the bank: the certificate matches the
 * key, it is inside its validity window, and it names this merchant.
 *
 * Returns the problems found, empty when the material is sound.
 */
function inspectCredentials(): string[] {
  const problems: string[] = [];
  const privateKey = createPrivateKey(readFileSync(keyPath, 'utf8'));
  line(
    'key type',
    `${privateKey.asymmetricKeyType ?? 'unknown'} ${privateKey.asymmetricKeyDetails?.modulusLength ?? ''}`.trim(),
  );

  if (!certPath) {
    line('certificate', '(not configured - pairing not checked)');
    return problems;
  }

  const cert = new X509Certificate(readFileSync(certPath, 'utf8'));
  line('certificate', `${cert.subject.replace(/\n/g, ', ')}`);
  line('issuer', cert.issuer.replace(/\n/g, ', '));
  line('valid', `${cert.validFrom} .. ${cert.validTo}`);

  if (!cert.checkPrivateKey(privateKey)) {
    problems.push('the certificate does not match the private key - they are from different requests');
  }

  const now = Date.now();
  if (Date.parse(cert.validFrom) > now) problems.push(`the certificate is not valid until ${cert.validFrom}`);
  if (Date.parse(cert.validTo) < now) problems.push(`the certificate expired on ${cert.validTo}`);

  const ids = identifiersInCertificate(cert);
  if (ids.merchantId || ids.terminalId) {
    line('certificate ids', `merchant ${ids.merchantId ?? '?'}, terminal ${ids.terminalId ?? '?'}`);
    if (ids.merchantId && ids.merchantId !== merchantId) {
      problems.push(`the certificate is issued to merchant ${ids.merchantId}, not ${merchantId}`);
    }
    if (terminalId && ids.terminalId && ids.terminalId !== terminalId) {
      problems.push(`the certificate is issued to terminal ${ids.terminalId}, not ${terminalId}`);
    }
  }

  return problems;
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

  const problems = inspectCredentials();
  if (problems.length > 0) {
    console.log('');
    console.log('  [x] credentials - the key material on this host is not usable as is');
    for (const problem of problems) line('', problem);
    return 4;
  }

  if (offline) {
    console.log('');
    console.log('  [ok] key material checks out. Re-run without AGROPROMBANK_PROBE_OFFLINE to call the bank.');
    return 0;
  }

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
