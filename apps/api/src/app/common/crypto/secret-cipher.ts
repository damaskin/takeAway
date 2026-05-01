import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * AES-256-GCM symmetric cipher for storing third-party credentials at rest
 * (POS integrations, etc.). The ciphertext layout is `iv || authTag || data`,
 * base64-encoded — easy to round-trip through a single TEXT column.
 *
 * The key is read once from `POS_CREDENTIALS_KEY`. If the env var is missing
 * or malformed in production, the service refuses to start: silently falling
 * back to a default would let credentials be written under a key the next
 * deploy can't decrypt.
 *
 * Outside production (dev/test) we synthesise an in-process random key when
 * the env var is absent so unit tests can encrypt round-trip without ops
 * intervention. A warning is logged so it's visible.
 */
@Injectable()
export class SecretCipher {
  private readonly logger = new Logger(SecretCipher.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('POS_CREDENTIALS_KEY');
    const env = config.get<string>('NODE_ENV') ?? 'development';

    if (raw && raw.length > 0) {
      if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length !== KEY_BYTES * 2) {
        throw new Error(
          `POS_CREDENTIALS_KEY must be ${KEY_BYTES * 2} hex characters (got ${raw.length}). ` +
            `Generate one with: node -e "console.log(require('crypto').randomBytes(${KEY_BYTES}).toString('hex'))"`,
        );
      }
      this.key = Buffer.from(raw, 'hex');
      return;
    }

    if (env === 'production') {
      throw new Error('POS_CREDENTIALS_KEY is required in production');
    }

    this.logger.warn(
      'POS_CREDENTIALS_KEY is not set — generating an ephemeral in-process key. Existing PosIntegration rows will be undecryptable.',
    );
    this.key = randomBytes(KEY_BYTES);
  }

  /** Encrypts a UTF-8 string. The output is `base64(iv || authTag || ciphertext)`. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  /** Inverse of {@link encrypt}. Throws if the ciphertext is malformed or tampered with. */
  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length <= IV_BYTES + AUTH_TAG_BYTES) {
      throw new Error('Ciphertext is truncated');
    }
    const iv = buf.subarray(0, IV_BYTES);
    const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Convenience wrapper for objects: `JSON.stringify` then encrypt. Provider
   * implementations use this to persist their credential shapes without
   * caring about serialisation.
   */
  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}
