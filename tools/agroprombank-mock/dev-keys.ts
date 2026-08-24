import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Development key material for the Agroprombank sandbox.
 *
 * The real merchant key is issued by the bank's CA — nothing here can stand in
 * for it against the live gateway. These keys exist so the whole flow (bind →
 * one-time password → charge → refund) can be exercised locally against
 * {@link file://./server.ts}, which plays the bank's side.
 *
 * Plain RSA key pairs, not X.509 certificates: `crypto.verify` accepts a public
 * key PEM wherever the production code expects a certificate, and `<KeyInfo>`
 * (the only place a real certificate is needed) is off by default.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// Overridable so the staging container can share one key directory with the
// API through a mounted volume.
export const KEY_DIR = process.env['AGRO_MOCK_KEY_DIR']
  ? resolve(process.env['AGRO_MOCK_KEY_DIR'])
  : resolve(HERE, '../../.secrets/agroprombank');

/**
 * File mode for the generated private keys — owner-only by default.
 *
 * The staging stack shares one key directory between two containers running as
 * different users, so it sets `shared` (0644). That is acceptable only because
 * these are throwaway sandbox keys; bank-issued material must never be world
 * readable.
 */
const PRIVATE_KEY_MODE = process.env['AGRO_MOCK_KEY_MODE'] === 'shared' ? 0o644 : 0o600;

export interface DevKeys {
  merchantPrivateKeyPath: string;
  merchantPublicKeyPath: string;
  bankPrivateKeyPath: string;
  bankPublicKeyPath: string;
}

export const DEV_KEY_PATHS: DevKeys = {
  merchantPrivateKeyPath: join(KEY_DIR, 'merchant-private-key.pem'),
  merchantPublicKeyPath: join(KEY_DIR, 'merchant-public-key.pem'),
  bankPrivateKeyPath: join(KEY_DIR, 'bank-private-key.pem'),
  bankPublicKeyPath: join(KEY_DIR, 'bank-public-key.pem'),
};

/** Creates the sandbox key pairs if they are not there yet. Idempotent. */
export function ensureDevKeys(): DevKeys {
  mkdirSync(KEY_DIR, { recursive: true });

  for (const side of ['merchant', 'bank'] as const) {
    const privatePath = side === 'merchant' ? DEV_KEY_PATHS.merchantPrivateKeyPath : DEV_KEY_PATHS.bankPrivateKeyPath;
    const publicPath = side === 'merchant' ? DEV_KEY_PATHS.merchantPublicKeyPath : DEV_KEY_PATHS.bankPublicKeyPath;
    if (existsSync(privatePath) && existsSync(publicPath)) continue;

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    writeFileSync(privatePath, privateKey, { mode: PRIVATE_KEY_MODE });
    writeFileSync(publicPath, publicKey, { mode: 0o644 });
    // eslint-disable-next-line no-console
    console.log(`[dev-keys] generated ${side} key pair → ${privatePath}`);
  }

  return DEV_KEY_PATHS;
}

export function readDevKey(path: string): string {
  return readFileSync(path, 'utf8');
}

// `tsx tools/agroprombank-mock/dev-keys.ts` regenerates/reports the key paths.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const keys = ensureDevKeys();
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      'Sandbox key material ready. Point the API at the mock with:',
      '',
      '  AGROPROMBANK_ENABLED=true',
      '  AGROPROMBANK_ENDPOINT=http://localhost:8899/merchant/MerchantCAPService.asmx',
      '  AGROPROMBANK_MERCHANT_ID=M00012345',
      '  AGROPROMBANK_TERMINAL_ID=E1016682',
      `  AGROPROMBANK_PRIVATE_KEY_FILE=${keys.merchantPrivateKeyPath}`,
      `  AGROPROMBANK_BANK_CERTIFICATE_FILE=${keys.bankPublicKeyPath}`,
      '',
    ].join('\n'),
  );
}
