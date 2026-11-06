import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'node:crypto';

const BCRYPT_ROUNDS = 12;

/**
 * Roles that sign in with an email or login and a password. Customers never
 * set a password — they sign in with Telegram, Google, Apple or an emailed
 * code — so the password flows refuse them outright, even if a hash somehow
 * existed.
 */
export const PASSWORD_LOGIN_ROLES: ReadonlySet<Role> = new Set([
  Role.SUPER_ADMIN,
  Role.BRAND_ADMIN,
  Role.STORE_MANAGER,
  Role.MENU_EDITOR,
  Role.STAFF,
  Role.RIDER,
]);

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  private dummyHash?: Promise<string>;

  /**
   * Spends the same bcrypt work as compare() when there is no account to
   * check, so the response time does not tell whether an email or a login
   * exists. Always resolves; the result is meaningless.
   */
  async compareWithoutAccount(plain: string): Promise<void> {
    this.dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
    await bcrypt.compare(plain, await this.dummyHash);
  }

  /**
   * Generate a random password-reset token. Returns the raw token (sent to
   * the user by email and Telegram) and its SHA-256 hash (what we store — the raw value is not
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
