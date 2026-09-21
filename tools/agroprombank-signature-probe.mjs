/**
 * Finds the request-signature variant the Agroprombank gateway accepts.
 *
 * Context: our first live call came back `result=-1`, «Ошибка проверки
 * подписи». The bank's own response, verified against the certificate it
 * carries, validates byte-for-byte under our verifier — so the canonical form,
 * the digest and the RSA signature are right and the disagreement is about the
 * shape of the `<Signature>` we send, not about the crypto.
 *
 * The documentation does not pin that shape down, so rather than guess one
 * change at a time this sends the plausible variants in one run and reports
 * what the bank says to each. The differences are:
 *
 *   - `<KeyInfo>`: absent (the documented samples), the certificate alone, or
 *     the certificate plus `<RSAKeyValue>` — which is what the bank itself
 *     sends, and what .NET's SignedXml emits by default.
 *   - the transform chain: enveloped-signature alone, or enveloped-signature
 *     followed by exclusive c14n — again what the bank itself sends.
 *
 * Every call is a CheckToken for a token that cannot exist: it moves no money
 * and creates nothing, and the verdict we are after is the signature check
 * that happens before the token is ever looked up.
 *
 * Dependency-free and a single file because it runs on the production host,
 * which is where the merchant key lives and which has no checkout. Node 18+:
 *
 *   docker run --rm \
 *     -v /opt/takeaway/secrets:/secrets:ro \
 *     -v /tmp/agro:/out \
 *     -e AGROPROMBANK_MERCHANT_ID=M000... \
 *     -e AGROPROMBANK_PRIVATE_KEY_FILE=/secrets/agroprombank-private-key.pem \
 *     -e AGROPROMBANK_CERTIFICATE_FILE=/secrets/agroprombank-certificate.pem \
 *     node:22-alpine node /out/signature-probe.mjs
 */

import { createHash, createSign, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const SIG_ALG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const DIGEST_ALG = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const endpoint = process.env['AGROPROMBANK_ENDPOINT'] ?? 'https://ws.agroprombank.com/merchant/MerchantCAPService.asmx';
const namespace = process.env['AGROPROMBANK_NAMESPACE'] ?? 'http://services.agroprombank.com';
const merchantId = process.env['AGROPROMBANK_MERCHANT_ID'] ?? '';
const keyPath = process.env['AGROPROMBANK_PRIVATE_KEY_FILE'] ?? '';
const certPath = process.env['AGROPROMBANK_CERTIFICATE_FILE'] ?? '';
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

/** `<RSAKeyValue>` from a certificate — the bank sends one alongside X509Data. */
function rsaKeyValue(certificatePem) {
  const clean = `-----BEGIN CERTIFICATE-----\n${stripPem(certificatePem).replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END CERTIFICATE-----\n`;
  const jwk = new X509Certificate(clean).publicKey.export({ format: 'jwk' });
  const toBase64 = (b64url) => Buffer.from(b64url, 'base64url').toString('base64');
  return `<KeyValue><RSAKeyValue><Modulus>${toBase64(jwk.n)}</Modulus><Exponent>${toBase64(jwk.e)}</Exponent></RSAKeyValue></KeyValue>`;
}

function keyInfo(kind, certificatePem) {
  if (kind === 'none') return '';
  const x509 = `<X509Data><X509Certificate>${stripPem(certificatePem)}</X509Certificate></X509Data>`;
  return kind === 'cert' ? `<KeyInfo>${x509}</KeyInfo>` : `<KeyInfo>${x509}${rsaKeyValue(certificatePem)}</KeyInfo>`;
}

/**
 * The request is built directly in canonical form — no attributes beyond the
 * fixed `Algorithm` ones, no namespaces below the apex, no whitespace — so
 * canonicalization is the identity and no c14n implementation is needed here.
 *
 * The body carries no namespace declarations, so inclusive and exclusive c14n
 * produce the same bytes for it: declaring the exclusive transform changes
 * `<SignedInfo>`, never the digest.
 */
function signRequest(token, privateKeyPem, certificatePem, variant) {
  const body = `<root><token>${escapeText(token)}</token></root>`;
  const digest = createHash('sha256').update(body, 'utf8').digest('base64');

  const transforms = variant.excC14n
    ? `${algorithm('Transform', ENVELOPED)}${algorithm('Transform', EXC_C14N)}`
    : algorithm('Transform', ENVELOPED);

  // <SignedInfo> inherits the dsig namespace from <Signature>, so the form it
  // is signed over carries the declaration the element itself does not.
  const signedInfo =
    `<SignedInfo>${algorithm('CanonicalizationMethod', C14N)}${algorithm('SignatureMethod', SIG_ALG)}` +
    `<Reference URI=""><Transforms>${transforms}</Transforms>` +
    `${algorithm('DigestMethod', DIGEST_ALG)}<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const signedInfoC14n = signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${escapeAttr(DSIG_NS)}">`);

  const signatureValue = createSign('RSA-SHA256').update(signedInfoC14n, 'utf8').sign(privateKeyPem, 'base64');

  const signature =
    `<Signature xmlns="${escapeAttr(DSIG_NS)}">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue>` +
    `${keyInfo(variant.keyInfo, certificatePem)}</Signature>`;
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
  const wrapped = /<CheckTokenResult>([\s\S]*?)<\/CheckTokenResult>/.exec(soapBody);
  if (!wrapped) {
    const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(soapBody);
    return {
      result: null,
      errorcode: null,
      error: fault ? `SOAP fault: ${unescapeXml(fault[1])}` : 'no <CheckTokenResult>',
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
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${namespace}/CheckToken` },
      body: soapEnvelope(request),
      signal: controller.signal,
    });
    return { status: `${response.status} ${response.statusText}`, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

const VARIANTS = [
  { name: 'A  enveloped, no KeyInfo          ', keyInfo: 'none', excC14n: false },
  { name: 'B  enveloped, KeyInfo=certificate ', keyInfo: 'cert', excC14n: false },
  { name: 'C  enveloped, KeyInfo=cert+RSAKey ', keyInfo: 'full', excC14n: false },
  { name: 'D  +exc-c14n, KeyInfo=cert+RSAKey ', keyInfo: 'full', excC14n: true },
  { name: 'E  +exc-c14n, no KeyInfo          ', keyInfo: 'none', excC14n: true },
];

async function main() {
  if (!merchantId) throw new Error('AGROPROMBANK_MERCHANT_ID is required');
  if (!keyPath) throw new Error('AGROPROMBANK_PRIVATE_KEY_FILE is required');
  if (!certPath) throw new Error('AGROPROMBANK_CERTIFICATE_FILE is required');

  const privateKeyPem = readFileSync(keyPath, 'utf8');
  const certificatePem = readFileSync(certPath, 'utf8');
  const token = 'PROBE'.padEnd(64, '0');

  console.log(`endpoint   ${endpoint}`);
  console.log(`merchant   ${merchantId}`);
  console.log(`token      ${token} (deliberately nonexistent)`);
  console.log('');

  let accepted = null;
  for (const variant of VARIANTS) {
    let line;
    try {
      const { status, body } = await callGateway(signRequest(token, privateKeyPem, certificatePem, variant));
      const verdict = readVerdict(body);
      // `errorcode=-1` is what the gateway returns for anything it refused
      // before looking at the request — a signature it could not check, a
      // field it could not parse. A refusal of the token itself carries its
      // own code, so a code other than -1 means the signature got through.
      if (accepted === null && verdict.errorcode !== null && verdict.errorcode !== '-1') {
        accepted = variant;
      }
      line = `HTTP ${status}  result=${verdict.result ?? '?'} errorcode=${verdict.errorcode ?? '?'} ${verdict.error ?? ''}`;
    } catch (err) {
      line = `failed: ${err instanceof Error ? err.message : err}`;
    }
    console.log(`${variant.name} ${line}`);
  }

  console.log('');
  if (accepted) {
    console.log(`The bank got past the signature on variant ${accepted.name.trim()}.`);
    console.log('What it says about the token itself is expected — the token does not exist.');
  } else {
    console.log('Every variant came back errorcode=-1, so none of them got past the gateway.');
    console.log('Read the messages above rather than only this line: «Ошибка проверки подписи»');
    console.log('means the signature itself was refused, while anything about parsing points at');
    console.log('the contents we sent. If every variant is refused on the signature, the');
    console.log('disagreement is not about the XML and the bank has to check that our');
    console.log('certificate is bound to the merchant on their side.');
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
