import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

const PIN_PATTERN = /^[0-9]{4,6}$/;

/**
 * KDS PIN cryptography. We hash the PIN with HMAC-SHA256 keyed by
 * `KDS_PIN_SECRET` mixed with the store id, so two staff with the
 * same PIN at different stores produce different hashes — and so a
 * compromised database row alone can't be brute-forced without the
 * service-side secret.
 *
 * We do NOT use bcrypt here on purpose: PIN auth needs to look up by
 * hash (not iterate every row), and a 4–6 digit space is small enough
 * that bcrypt's per-attempt cost is irrelevant once you can target
 * one row at a time. The HMAC scheme combined with rate-limiting on
 * the login endpoint is the right tradeoff for a tablet lockscreen.
 */
@Injectable()
export class KdsPinService {
  private readonly logger = new Logger(KdsPinService.name);
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('KDS_PIN_SECRET') ?? '';
    if (!this.secret) {
      this.logger.warn(
        'KDS_PIN_SECRET is not set — KDS PIN auth will reject every login until ops rotates a real secret in.',
      );
    }
  }

  /**
   * Validates the PIN format. Throws nothing — caller decides on the error
   * shape (BadRequestException for admin set, UnauthorizedException for login).
   */
  isValidFormat(pin: string): boolean {
    return PIN_PATTERN.test(pin);
  }

  hash(storeId: string, pin: string): string {
    if (!this.secret) {
      // Returning a non-matchable sentinel keeps callers honest — login will
      // never succeed, and admin-side `setPin` writes a row that nobody can
      // unlock until KDS_PIN_SECRET is provisioned.
      return 'unset:' + Buffer.from(storeId).toString('base64url');
    }
    return createHmac('sha256', this.secret).update(`${storeId}|${pin}`).digest('hex');
  }

  /**
   * Constant-time comparison so a partial match doesn't leak via timing.
   * Both inputs are hex strings of equal length, so Buffer.from is safe.
   */
  matches(storeId: string, pin: string, expectedHash: string): boolean {
    const candidate = this.hash(storeId, pin);
    if (candidate.length !== expectedHash.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(expectedHash));
  }
}
