/**
 * Fetches the bank's response-signing certificate straight out of a signed
 * response, for the case where nobody can say where else to get it.
 *
 * The documentation («Рекуррентные платежи в ПС Клевер», v1.3, p. 2) says only
 * that the parties exchange certificates; the CA site publishes the root and
 * the revocation lists, not this. But the bank signs every response, and an
 * XMLDSig signature may carry the signer's certificate in <KeyInfo>. If it
 * does, one harmless call is enough and no correspondence is needed.
 *
 * The call is a CheckToken for a token that cannot exist: it moves no money,
 * creates nothing, and a rejection is as useful as an acceptance — what we are
 * after is the signature, not the verdict.
 *
 * Deliberately dependency-free and a single file, because it has to run on the
 * production host, which is where the merchant key lives and which has no
 * checkout of node_modules. Node 18+:
 *
 *   docker run --rm \
 *     -v /opt/takeaway/secrets:/secrets:ro \
 *     -v /opt/takeaway/repo/tools:/tools:ro \
 *     -v /tmp/agro:/out \
 *     -e AGROPROMBANK_MERCHANT_ID=M000... \
 *     -e AGROPROMBANK_PRIVATE_KEY_FILE=/secrets/agroprombank-private-key.pem \
 *     -e AGROPROMBANK_OUT=/out/agroprombank-bank-certificate.pem \
 *     node:22-alpine node /tools/agroprombank-fetch-bank-cert.mjs
 */

import { createHash, createSign, X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const SIG_ALG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const DIGEST_ALG = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const endpoint = process.env['AGROPROMBANK_ENDPOINT'] ?? 'https://ws.agroprombank.com/merchant/MerchantCAPService.asmx';
const namespace = process.env['AGROPROMBANK_NAMESPACE'] ?? 'http://services.agroprombank.com';
const merchantId = process.env['AGROPROMBANK_MERCHANT_ID'] ?? '';
const keyPath = process.env['AGROPROMBANK_PRIVATE_KEY_FILE'] ?? '';
const outPath = process.env['AGROPROMBANK_OUT'] ?? 'agroprombank-bank-certificate.pem';
const timeoutMs = Number(process.env['AGROPROMBANK_TIMEOUT_MS'] ?? 30_000);

/* eslint-disable no-console */

/**
 * Canonical XML 1.0 escaping for character data. Matches the api's xml.ts —
 * the bank recomputes the digest over its own canonicalization, so anything
 * else here produces a signature that verifies on our side and nowhere else.
 */
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

/**
 * The request is built directly in canonical form — no elements with
 * attributes beyond the fixed Algorithm ones, no namespaces below the apex, no
 * whitespace — so canonicalization is the identity and a general c14n
 * implementation would be dead weight here.
 */
function algorithm(name, uri) {
  return `<${name} Algorithm="${escapeAttr(uri)}"></${name}>`;
}

function signCheckTokenRequest(token, privateKeyPem) {
  const body = `<root><token>${escapeText(token)}</token></root>`;
  const digest = createHash('sha256').update(body, 'utf8').digest('base64');

  // <SignedInfo> inherits the dsig namespace from <Signature>, so the
  // canonical form it is signed over carries the declaration even though the
  // element in the document does not.
  const signedInfo =
    `<SignedInfo>${algorithm('CanonicalizationMethod', C14N)}${algorithm('SignatureMethod', SIG_ALG)}` +
    `<Reference URI=""><Transforms>${algorithm('Transform', ENVELOPED)}</Transforms>` +
    `${algorithm('DigestMethod', DIGEST_ALG)}<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const signedInfoC14n = signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${escapeAttr(DSIG_NS)}">`);

  const signatureValue = createSign('RSA-SHA256').update(signedInfoC14n, 'utf8').sign(privateKeyPem, 'base64');

  const signature = `<Signature xmlns="${escapeAttr(DSIG_NS)}">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue></Signature>`;
  return `<?xml version="1.0" encoding="UTF-8"?><root><token>${escapeText(token)}</token>${signature}</root>`;
}

function soapEnvelope(request) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<CheckToken xmlns="${escapeAttr(namespace)}">` +
    `<merchantId>${escapeText(merchantId)}</merchantId><request>${escapeText(request)}</request>` +
    `</CheckToken></soap:Body></soap:Envelope>`
  );
}

/** Every certificate the response carries, innermost payload included. */
function certificatesIn(text) {
  const unescaped = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  const found = new Set();
  for (const source of [text, unescaped]) {
    for (const match of source.matchAll(/<(?:\w+:)?X509Certificate>([\s\S]*?)<\/(?:\w+:)?X509Certificate>/g)) {
      found.add(match[1].replace(/\s+/g, ''));
    }
  }
  return [...found];
}

function toPem(base64) {
  return `-----BEGIN CERTIFICATE-----\n${base64.replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END CERTIFICATE-----\n`;
}

async function main() {
  if (!merchantId) throw new Error('AGROPROMBANK_MERCHANT_ID is required');
  if (!keyPath) throw new Error('AGROPROMBANK_PRIVATE_KEY_FILE is required');

  const privateKeyPem = readFileSync(keyPath, 'utf8');
  const token = 'PROBE'.padEnd(64, '0');

  console.log(`endpoint   ${endpoint}`);
  console.log(`merchant   ${merchantId}`);
  console.log(`token      ${token} (deliberately nonexistent)`);
  console.log('');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status;
  let body;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${namespace}/CheckToken` },
      body: soapEnvelope(signCheckTokenRequest(token, privateKeyPem)),
      signal: controller.signal,
    });
    status = `${response.status} ${response.statusText}`;
    body = await response.text();
  } finally {
    clearTimeout(timer);
  }

  console.log(`HTTP ${status}`);
  console.log('');
  console.log('----- response -----');
  console.log(body.length > 8000 ? `${body.slice(0, 8000)}\n... (${body.length} bytes total)` : body);
  console.log('----- end -----');
  console.log('');

  const certificates = certificatesIn(body);
  if (certificates.length === 0) {
    console.log('No <X509Certificate> in the response — the bank does not send its certificate inline.');
    console.log('Ask the bank for it; there is nothing further to extract here.');
    return 1;
  }

  certificates.forEach((base64, index) => {
    const pem = toPem(base64);
    const cert = new X509Certificate(pem);
    const target = certificates.length === 1 ? outPath : outPath.replace(/(\.pem)?$/, `.${index + 1}$1`);
    writeFileSync(target, pem);
    console.log(`certificate ${index + 1} -> ${target}`);
    console.log(`  subject ${cert.subject.replace(/\n/g, ', ')}`);
    console.log(`  issuer  ${cert.issuer.replace(/\n/g, ', ')}`);
    console.log(`  valid   ${cert.validFrom} .. ${cert.validTo}`);
  });
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
