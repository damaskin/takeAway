import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'node:crypto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /**
   * Generate a random password-reset token. Returns the raw token (mail this
   * to the user) and its SHA-256 hash (what we store — the raw value is not
   * recoverable server-side, matching how we store bcrypt passwords).
   */
  issueResetToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(raw).digest('hex');
    return { raw, hash };
  }

  hashResetToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
