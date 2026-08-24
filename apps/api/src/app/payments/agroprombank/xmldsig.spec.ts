import { createHash, createSign, generateKeyPairSync } from 'node:crypto';

import { buildElement, canonicalize, parseXml } from './xml';
import {
  C14N_ALGORITHM,
  DIGEST_ALGORITHM,
  DSIG_NS,
  ENVELOPED_TRANSFORM,
  SIGNATURE_ALGORITHM,
  signXml,
  verifyXml,
} from './xmldsig';

const merchant = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const impostor = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const request = buildElement('root', {
  invoiceid: '1756012345678',
  token: 'E6B2C8EC084D52C',
  amount: 3300,
  currencycode: '000',
});

describe('signXml', () => {
  it('produces a document the verifier accepts', () => {
    const signed = signXml(request, { privateKeyPem: merchant.privateKey });
    expect(verifyXml(signed, merchant.publicKey)).toEqual({ valid: true });
  });

  it('emits the algorithm profile the bank documents', () => {
    const signed = signXml(request, { privateKeyPem: merchant.privateKey });
    expect(signed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(signed).toContain(`<Signature xmlns="${DSIG_NS}">`);
    expect(signed).toContain(`<CanonicalizationMethod Algorithm="${C14N_ALGORITHM}">`);
    expect(signed).toContain(`<SignatureMethod Algorithm="${SIGNATURE_ALGORITHM}">`);
    expect(signed).toContain(`<Transform Algorithm="${ENVELOPED_TRANSFORM}">`);
    expect(signed).toContain(`<DigestMethod Algorithm="${DIGEST_ALGORITHM}">`);
    expect(signed).toContain('<Reference URI="">');
    // The documented request samples carry no KeyInfo — the bank knows our
    // certificate from the merchant id.
    expect(signed).not.toContain('<KeyInfo>');
  });

  it('embeds the certificate only when asked', () => {
    const certificate = `-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n`;
    const signed = signXml(request, {
      privateKeyPem: merchant.privateKey,
      certificatePem: certificate,
      includeKeyInfo: true,
    });
    expect(signed).toContain('<X509Certificate>QUJD</X509Certificate>');
    expect(verifyXml(signed, merchant.publicKey)).toEqual({ valid: true });
  });

  it('re-signing replaces the previous signature rather than nesting one', () => {
    const once = signXml(request, { privateKeyPem: merchant.privateKey });
    const twice = signXml(once, { privateKeyPem: merchant.privateKey });
    expect(twice.match(/<Signature /g)).toHaveLength(1);
    expect(verifyXml(twice, merchant.publicKey)).toEqual({ valid: true });
  });

  it('keeps the payload intact', () => {
    const signed = signXml(request, { privateKeyPem: merchant.privateKey });
    const root = parseXml(signed);
    expect(canonicalize(root)).toContain('<invoiceid>1756012345678</invoiceid>');
    expect(canonicalize(root)).toContain('<amount>3300</amount>');
  });
});

describe('verifyXml', () => {
  it('rejects a tampered payload', () => {
    const signed = signXml(request, { privateKeyPem: merchant.privateKey });
    const tampered = signed.replace('<amount>3300</amount>', '<amount>1</amount>');
    expect(verifyXml(tampered, merchant.publicKey)).toEqual({
      valid: false,
      reason: 'Reference digest does not match the document body',
    });
  });

  it('rejects a signature made with another key', () => {
    const signed = signXml(request, { privateKeyPem: impostor.privateKey });
    const verdict = verifyXml(signed, merchant.publicKey);
    expect(verdict.valid).toBe(false);
  });

  it('rejects a document with no signature', () => {
    expect(verifyXml('<root><result>1</result></root>', merchant.publicKey)).toEqual({
      valid: false,
      reason: 'Document carries no <Signature> element',
    });
  });

  it('rejects a downgraded signature algorithm', () => {
    const signed = signXml(request, { privateKeyPem: merchant.privateKey }).replace(
      SIGNATURE_ALGORITHM,
      'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    );
    expect(verifyXml(signed, merchant.publicKey)).toEqual({
      valid: false,
      reason: 'Unsupported signature algorithm: http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    });
  });

  it('rejects a reference that does not cover the whole document', () => {
    const signed = signXml(request, { privateKeyPem: merchant.privateKey }).replace(
      '<Reference URI="">',
      '<Reference URI="#part">',
    );
    expect(verifyXml(signed, merchant.publicKey)).toEqual({
      valid: false,
      reason: 'Only whole-document references are supported (URI="#part")',
    });
  });

  it('rejects a reference with the enveloped transform stripped out', () => {
    const signed = signXml(request, { privateKeyPem: merchant.privateKey }).replace(
      `<Transforms><Transform Algorithm="${ENVELOPED_TRANSFORM}"></Transform></Transforms>`,
      '<Transforms></Transforms>',
    );
    expect(verifyXml(signed, merchant.publicKey)).toEqual({
      valid: false,
      reason: 'Reference is missing the enveloped-signature transform',
    });
  });

  it('reports malformed XML instead of throwing', () => {
    const verdict = verifyXml('<root><a></root>', merchant.publicKey);
    expect(verdict.valid).toBe(false);
    expect(verdict.valid === false && verdict.reason).toContain('not well-formed');
  });

  /**
   * The bank pretty-prints its responses, so the whitespace between elements is
   * part of the signed bytes. This builds a response the way the bank does —
   * signature spliced into indented XML — rather than the compact form our own
   * signer emits, which is the case a naive re-serializing implementation gets
   * wrong.
   */
  it('accepts a pretty-printed response signed the way the bank signs it', () => {
    const body = ['<root>', '  <result>1</result>', '  <operationid>123456789</operationid>', '</root>'].join('\n');
    expect(verifyXml(signLikeTheBank(body, impostor.privateKey), impostor.publicKey)).toEqual({ valid: true });
  });

  it('still catches tampering inside a pretty-printed response', () => {
    const body = ['<root>', '  <result>1</result>', '  <operationid>123456789</operationid>', '</root>'].join('\n');
    const signed = signLikeTheBank(body, impostor.privateKey).replace('<result>1</result>', '<result>2</result>');
    expect(verifyXml(signed, impostor.publicKey)).toEqual({
      valid: false,
      reason: 'Reference digest does not match the document body',
    });
  });
});

/**
 * Minimal independent implementation of the bank side: digest the document as
 * it stands, then splice `<Signature>` in before the closing root tag without
 * reformatting anything.
 */
function signLikeTheBank(body: string, privateKeyPem: string): string {
  const digest = createHash('sha256')
    .update(canonicalize(parseXml(body)), 'utf8')
    .digest('base64');
  const signedInfo =
    `<SignedInfo xmlns="${DSIG_NS}">` +
    `<CanonicalizationMethod Algorithm="${C14N_ALGORITHM}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${SIGNATURE_ALGORITHM}"></SignatureMethod>` +
    `<Reference URI=""><Transforms><Transform Algorithm="${ENVELOPED_TRANSFORM}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="${DIGEST_ALGORITHM}"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference>` +
    `</SignedInfo>`;
  const signatureValue = createSign('RSA-SHA256').update(signedInfo, 'utf8').sign(privateKeyPem, 'base64');
  const signature =
    `<Signature xmlns="${DSIG_NS}">` +
    signedInfo.replace(` xmlns="${DSIG_NS}"`, '') +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `</Signature>`;
  return body.replace('</root>', `${signature}</root>`);
}
