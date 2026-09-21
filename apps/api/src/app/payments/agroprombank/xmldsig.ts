import { createHash, createSign, createVerify } from 'node:crypto';

import { type XmlElement, type XmlNode, canonicalize, child, parseXml, serializeDocument, text } from './xml';

/**
 * Enveloped XMLDSig signing / verification for the Agroprombank merchant API.
 *
 * The bank fixes the profile (documented in «Рекуррентные платежи в ПС Клевер»):
 *  - canonicalization: Canonical XML 1.0 (`REC-xml-c14n-20010315`)
 *  - signature:        RSA-SHA256 (`xmldsig-more#rsa-sha256`)
 *  - digest:           SHA-256 (`xmlenc#sha256`)
 *  - one `<Reference URI="">` with the enveloped-signature transform
 *
 * `<Signature>` is the last child of the document root on both directions.
 */

export const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
export const C14N_ALGORITHM = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
export const SIGNATURE_ALGORITHM = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
export const DIGEST_ALGORITHM = 'http://www.w3.org/2001/04/xmlenc#sha256';
export const ENVELOPED_TRANSFORM = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/** Namespace context seen by `<SignedInfo>` — inherited from `<Signature>`. */
const SIGNATURE_NS_CONTEXT: ReadonlyMap<string, string> = new Map([['', DSIG_NS]]);

export class XmlSignatureError extends Error {}

export interface SignXmlOptions {
  /** PEM-encoded RSA private key of the merchant certificate. */
  privateKeyPem: string;
  /** PEM certificate to embed in `<KeyInfo>`. Only used with `includeKeyInfo`. */
  certificatePem?: string | null;
  /**
   * The bank identifies the merchant by `merchantId` and already holds our
   * certificate, so the documented request samples carry no `<KeyInfo>`.
   * Enable only if the bank asks for it.
   */
  includeKeyInfo?: boolean;
}

/**
 * Signs a document with an enveloped signature and returns the serialized
 * result (XML declaration + canonical body).
 *
 * Any pre-existing `<Signature>` is discarded first so re-signing a document
 * is idempotent.
 */
export function signXml(document: string | XmlElement, options: SignXmlOptions): string {
  const root = typeof document === 'string' ? parseXml(document) : cloneElement(document);
  root.children = root.children.filter((node) => !isSignatureElement(node));

  const digest = createHash('sha256').update(canonicalize(root), 'utf8').digest('base64');
  const signedInfo = buildSignedInfo(digest);
  const signedInfoC14n = canonicalize(signedInfo, SIGNATURE_NS_CONTEXT);

  const signatureValue = createSign('RSA-SHA256').update(signedInfoC14n, 'utf8').sign(options.privateKeyPem, 'base64');

  const signature: XmlElement = {
    type: 'element',
    name: 'Signature',
    attrs: [{ name: 'xmlns', value: DSIG_NS }],
    children: [signedInfo, elementWithText('SignatureValue', signatureValue)],
  };

  if (options.includeKeyInfo && options.certificatePem) {
    signature.children.push({
      type: 'element',
      name: 'KeyInfo',
      attrs: [],
      children: [
        {
          type: 'element',
          name: 'X509Data',
          attrs: [],
          children: [elementWithText('X509Certificate', stripPem(options.certificatePem))],
        },
      ],
    });
  }

  root.children.push(signature);
  return serializeDocument(root);
}

export type VerifyResult = { valid: true } | { valid: false; reason: string };

/**
 * Verifies an enveloped signature against a PEM certificate (or public key).
 *
 * Both halves are checked: the reference digest over the signed document and
 * the RSA signature over `<SignedInfo>`. A response whose digest matches but
 * whose signature does not is a forgery attempt, not a formatting quirk, so
 * the two are reported separately.
 */
export function verifyXml(document: string | XmlElement, certificatePem: string): VerifyResult {
  let root: XmlElement;
  try {
    root = typeof document === 'string' ? parseXml(document) : cloneElement(document);
  } catch (err) {
    return { valid: false, reason: `Document is not well-formed XML: ${messageOf(err)}` };
  }

  const signature = root.children.find(isSignatureElement) as XmlElement | undefined;
  if (!signature) return { valid: false, reason: 'Document carries no <Signature> element' };

  const signedInfo = child(signature, 'SignedInfo');
  if (!signedInfo) return { valid: false, reason: '<Signature> carries no <SignedInfo>' };

  const reference = child(signedInfo, 'Reference');
  if (!reference) return { valid: false, reason: '<SignedInfo> carries no <Reference>' };

  const referenceUri = reference.attrs.find((a) => a.name === 'URI')?.value ?? '';
  if (referenceUri !== '') {
    return { valid: false, reason: `Only whole-document references are supported (URI="${referenceUri}")` };
  }

  const digestAlgorithm = algorithmOf(child(reference, 'DigestMethod'));
  if (digestAlgorithm !== DIGEST_ALGORITHM) {
    return { valid: false, reason: `Unsupported digest algorithm: ${digestAlgorithm ?? 'missing'}` };
  }

  const signatureAlgorithm = algorithmOf(child(signedInfo, 'SignatureMethod'));
  if (signatureAlgorithm !== SIGNATURE_ALGORITHM) {
    return { valid: false, reason: `Unsupported signature algorithm: ${signatureAlgorithm ?? 'missing'}` };
  }

  const c14nAlgorithm = algorithmOf(child(signedInfo, 'CanonicalizationMethod'));
  if (c14nAlgorithm !== C14N_ALGORITHM) {
    return { valid: false, reason: `Unsupported canonicalization algorithm: ${c14nAlgorithm ?? 'missing'}` };
  }

  const transforms = child(reference, 'Transforms');
  const transform = transforms ? child(transforms, 'Transform') : null;
  if (algorithmOf(transform) !== ENVELOPED_TRANSFORM) {
    return { valid: false, reason: 'Reference is missing the enveloped-signature transform' };
  }

  const expectedDigest = text(reference, 'DigestValue')?.trim();
  if (!expectedDigest) return { valid: false, reason: '<Reference> carries no <DigestValue>' };

  const signatureValue = text(signature, 'SignatureValue')?.replace(/\s+/g, '');
  if (!signatureValue) return { valid: false, reason: '<Signature> carries no <SignatureValue>' };

  const enveloped: XmlElement = { ...root, children: root.children.filter((node) => node !== signature) };
  const actualDigest = createHash('sha256').update(canonicalize(enveloped), 'utf8').digest('base64');
  if (actualDigest !== expectedDigest) {
    return { valid: false, reason: 'Reference digest does not match the document body' };
  }

  const signedInfoC14n = canonicalize(signedInfo, SIGNATURE_NS_CONTEXT);
  let signatureOk: boolean;
  try {
    signatureOk = createVerify('RSA-SHA256')
      .update(signedInfoC14n, 'utf8')
      .verify(certificatePem, signatureValue, 'base64');
  } catch (err) {
    return { valid: false, reason: `Could not verify the signature: ${messageOf(err)}` };
  }

  return signatureOk ? { valid: true } : { valid: false, reason: 'SignatureValue does not match <SignedInfo>' };
}

function buildSignedInfo(digestValue: string): XmlElement {
  return {
    type: 'element',
    name: 'SignedInfo',
    attrs: [],
    children: [
      algorithmElement('CanonicalizationMethod', C14N_ALGORITHM),
      algorithmElement('SignatureMethod', SIGNATURE_ALGORITHM),
      {
        type: 'element',
        name: 'Reference',
        attrs: [{ name: 'URI', value: '' }],
        children: [
          {
            type: 'element',
            name: 'Transforms',
            attrs: [],
            children: [algorithmElement('Transform', ENVELOPED_TRANSFORM)],
          },
          algorithmElement('DigestMethod', DIGEST_ALGORITHM),
          elementWithText('DigestValue', digestValue),
        ],
      },
    ],
  };
}

function algorithmElement(name: string, algorithm: string): XmlElement {
  return { type: 'element', name, attrs: [{ name: 'Algorithm', value: algorithm }], children: [] };
}

function elementWithText(name: string, value: string): XmlElement {
  return { type: 'element', name, attrs: [], children: [{ type: 'text', value }] };
}

function algorithmOf(el: XmlElement | null): string | null {
  if (!el) return null;
  return el.attrs.find((a) => a.name === 'Algorithm')?.value ?? null;
}

function isSignatureElement(node: XmlNode): node is XmlElement {
  return node.type === 'element' && (node.name === 'Signature' || node.name.endsWith(':Signature'));
}

function cloneElement(el: XmlElement): XmlElement {
  return {
    type: 'element',
    name: el.name,
    attrs: el.attrs.map((a) => ({ ...a })),
    children: el.children.map((node) => (node.type === 'element' ? cloneElement(node) : { ...node })),
  };
}

/** Reduces a PEM block to the bare base64 body expected inside `<X509Certificate>`. */
function stripPem(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
