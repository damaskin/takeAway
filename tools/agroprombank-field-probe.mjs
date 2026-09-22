/**
 * Finds which field of `ProcessCardAutoPayment` the Agroprombank gateway
 * cannot read.
 *
 * Context: the first live payment came back `«Input string was not in a correct
 * format.»` — the .NET message for a number that would not parse. The request
 * carries several fields that could be it, and the gateway names none of them,
 * so rather than guess one deploy at a time this sends the request once per
 * suspect field, changing exactly one thing each time, and reports what the
 * bank says to each.
 *
 * Every call uses a token that cannot exist, so no card is charged and no
 * operation is created whatever the outcome: a variant the bank can parse comes
 * back complaining about the token, which is the answer we are after. A variant
 * it cannot parse repeats the format error. The first variant that stops
 * saying «Input string…» names the field.
 *
 * Dependency-free and a single file because it runs on the production host,
 * which is where the merchant key lives and which has no checkout. Node 18+:
 *
 *   docker run --rm -v /opt/takeaway/secrets:/secrets:ro -v /tmp/agro:/out -e AGROPROMBANK_MERCHANT_ID=M000... -e AGROPROMBANK_TERMINAL_ID=E104... -e AGROPROMBANK_PRIVATE_KEY_FILE=/secrets/agroprombank-private-key.pem -e AGROPROMBANK_CERTIFICATE_FILE=/secrets/agroprombank-certificate.pem node:22-alpine node /out/field-probe.mjs
 */

import { createHash, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const SIG_ALG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const DIGEST_ALG = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const FN = 'ProcessCardAutoPayment';

const endpoint = process.env['AGROPROMBANK_ENDPOINT'] ?? 'https://ws.agroprombank.com/merchant/MerchantCAPService.asmx';
const namespace = process.env['AGROPROMBANK_NAMESPACE'] ?? 'http://services.agroprombank.com';
const merchantId = process.env['AGROPROMBANK_MERCHANT_ID'] ?? '';
const terminalId = process.env['AGROPROMBANK_TERMINAL_ID'] ?? '';
const keyPath = process.env['AGROPROMBANK_PRIVATE_KEY_FILE'] ?? '';
const certPath = process.env['AGROPROMBANK_CERTIFICATE_FILE'] ?? '';
const invoicePrefix = process.env['AGROPROMBANK_INVOICE_PREFIX'] ?? '';
const timeoutMs = Number(process.env['AGROPROMBANK_TIMEOUT_MS'] ?? 30_000);

/** Canonical XML 1.0 escaping — must match the api's xml.ts exactly. */
function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

function escapeAttr(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

function algorithm(name, uri) {
  return `<${name} Algorithm="${escapeAttr(uri)}"></${name}>`;
}

/**
 * Only what sits between the markers: `openssl pkcs12 -clcerts -nokeys` writes
 * `Bag Attributes`, `subject=` and `issuer=` lines above them, and stripping
 * just the markers folds that text into the base64.
 */
function stripPem(pem) {
  const body = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)?.[1];
  if (body === undefined) throw new Error('AGROPROMBANK_CERTIFICATE_FILE is not a PEM certificate');
  return body.replace(/\s+/g, '');
}

/** `{ tag: value }` in document order; `null` drops the tag, as the api does. */
function buildBody(fields) {
  let out = '<root>';
  for (const [tag, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    out += `<${tag}>${escapeText(String(value))}</${tag}>`;
  }
  return `${out}</root>`;
}

/**
 * The signature shape the gateway accepted on 21.09.2026: enveloped-signature
 * alone, with the merchant certificate in `<KeyInfo>`. The body is built
 * directly in canonical form, so canonicalization is the identity here.
 */
function signRequest(body, privateKeyPem, certificatePem) {
  const digest = createHash('sha256').update(body, 'utf8').digest('base64');
  const signedInfo =
    `<SignedInfo>${algorithm('CanonicalizationMethod', C14N)}${algorithm('SignatureMethod', SIG_ALG)}` +
    `<Reference URI=""><Transforms>${algorithm('Transform', ENVELOPED)}</Transforms>` +
    `${algorithm('DigestMethod', DIGEST_ALG)}<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const signedInfoC14n = signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${escapeAttr(DSIG_NS)}">`);
  const signatureValue = createSign('RSA-SHA256').update(signedInfoC14n, 'utf8').sign(privateKeyPem, 'base64');
  const signature =
    `<Signature xmlns="${escapeAttr(DSIG_NS)}">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${stripPem(certificatePem)}</X509Certificate></X509Data></KeyInfo></Signature>`;
  return `<?xml version="1.0" encoding="UTF-8"?>${body.slice(0, -'</root>'.length)}${signature}</root>`;
}

function soapEnvelope(request) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<${FN} xmlns="${escapeAttr(namespace)}">` +
    `<merchantId>${escapeText(merchantId)}</merchantId><request>${escapeText(request)}</request>` +
    `</${FN}></soap:Body></soap:Envelope>`
  );
}

function unescapeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** `result` / `errorcode` / `error` out of the document nested in the SOAP body. */
function readVerdict(soapBody) {
  const wrapped = new RegExp(`<${FN}Result>([\\s\\S]*?)</${FN}Result>`).exec(soapBody);
  if (!wrapped) {
    const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(soapBody);
    return {
      result: null,
      errorcode: null,
      error: fault ? `SOAP fault: ${unescapeXml(fault[1])}` : 'no result element',
    };
  }
  const inner = unescapeXml(wrapped[1]);
  const field = (name) => {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(inner);
    return match ? unescapeXml(match[1]).trim() : null;
  };
  return { result: field('result'), errorcode: field('errorcode'), error: field('error') };
}

async function callGateway(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${namespace}/${FN}` },
      body: soapEnvelope(request),
      signal: controller.signal,
    });
    return { status: `${response.status} ${response.statusText}`, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** A fresh identifier per call: the bank refuses a repeated one on its own. */
let counter = 0;
function invoiceId(prefix) {
  counter += 1;
  return `${prefix}${Date.now()}${String(counter).padStart(4, '0')}`;
}

/**
 * The request the api sends today, field for field and in the same order.
 * Every variant below is this with one thing changed.
 */
function baseline(token) {
  return {
    invoiceid: invoiceId(invoicePrefix),
    token,
    amount: 1,
    tipamount: 0,
    currencycode: '840',
    istest: '0',
    description: 'Оплата заказа №4242',
    recipienttoken: null,
    recipient: null,
    terminalid: terminalId,
    preauth: 1,
  };
}

const VARIANTS = [
  ['1  as the api sends it now       ', (b) => b],
  ['2  invoiceid without the prefix  ', (b) => ({ ...b, invoiceid: invoiceId('') })],
  ['3  currencycode 000 (RUP)        ', (b) => ({ ...b, currencycode: '000' })],
  ['4  currencycode omitted          ', (b) => ({ ...b, currencycode: null })],
  ['5  amount as 0.01, not kopecks   ', (b) => ({ ...b, amount: '0.01' })],
  ['6  amount 100, tipamount omitted ', (b) => ({ ...b, amount: 100, tipamount: null })],
  ['7  terminalid omitted            ', (b) => ({ ...b, terminalid: null })],
  ['8  istest and preauth as numbers ', (b) => ({ ...b, istest: 0, preauth: 0 })],
  ['9  description ASCII only        ', (b) => ({ ...b, description: 'Order 4242' })],
  ['10 optional fields sent empty    ', (b) => ({ ...b, recipienttoken: '', recipient: '' })],
];

/** The .NET message we are chasing, in the shapes the gateway might spell it. */
function isFormatComplaint(error) {
  const text = (error ?? '').toLowerCase();
  return text.includes('input string') || text.includes('correct format') || text.includes('неверн');
}

async function main() {
  if (!merchantId) throw new Error('AGROPROMBANK_MERCHANT_ID is required');
  if (!terminalId) throw new Error('AGROPROMBANK_TERMINAL_ID is required');
  if (!keyPath) throw new Error('AGROPROMBANK_PRIVATE_KEY_FILE is required');
  if (!certPath) throw new Error('AGROPROMBANK_CERTIFICATE_FILE is required');

  const privateKeyPem = readFileSync(keyPath, 'utf8');
  const certificatePem = readFileSync(certPath, 'utf8');
  const token = 'PROBE'.padEnd(64, '0');

  console.log(`endpoint   ${endpoint}`);
  console.log(`merchant   ${merchantId}   terminal ${terminalId}`);
  console.log(`prefix     ${invoicePrefix === '' ? '(none)' : invoicePrefix}`);
  console.log(`token      ${token} (deliberately nonexistent — nothing can be charged)`);
  console.log('');

  const readable = [];
  for (const [name, mutate] of VARIANTS) {
    let line;
    let complaint = null;
    try {
      const fields = mutate(baseline(token));
      const { status, body } = await callGateway(signRequest(buildBody(fields), privateKeyPem, certificatePem));
      const verdict = readVerdict(body);
      complaint = verdict.error;
      if (!isFormatComplaint(verdict.error)) readable.push(name.trim());
      line = `HTTP ${status}  result=${verdict.result ?? '?'} errorcode=${verdict.errorcode ?? 'none'} ${complaint ?? ''}`;
    } catch (err) {
      line = `failed: ${err instanceof Error ? err.message : err}`;
    }
    console.log(`${name} ${line}`);
  }

  console.log('');
  if (readable.length === 0) {
    console.log('Every variant came back with the same format complaint, so the field that');
    console.log('breaks it is not among the ones varied here. Send the output above on.');
  } else {
    console.log('The gateway got past parsing on:');
    for (const name of readable) console.log(`  - ${name}`);
    console.log('');
    console.log('What it then says about the token is expected — the token does not exist.');
    console.log('The difference between those lines and the first one is the fix.');
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
