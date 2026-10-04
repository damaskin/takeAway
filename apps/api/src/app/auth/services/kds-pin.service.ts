import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { RedisService } from '../../redis/redis.service';

const PIN_PATTERN = /^[0-9]{4,6}$/;

/**
 * Prefix of the placeholder an older build stored when `KDS_PIN_SECRET` was
 * missing. It did not depend on the PIN, so any PIN unlocked such a row.
 * Rows carrying it are dead: they never authenticate and never count as a
 * PIN being set.
 */
export const KDS_PIN_LEGACY_SENTINEL_PREFIX = 'unset:';

/** Values that mean "nobody provisioned a secret" — the env example ships CHANGE_ME. */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set(['', 'CHANGE_ME']);

/** Failed PIN attempts per store before the store's PIN login is paused. */
export const KDS_PIN_MAX_FAILURES = 10;
/** Window the failures are counted in, and how long the pause lasts. */
export const KDS_PIN_LOCK_SECONDS = 10 * 60;

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
 * one row at a time. The HMAC scheme combined with rate-limiting (per IP
 * on the endpoint, per store here) is the right tradeoff for a tablet
 * lockscreen.
 *
 * Without a real secret the feature is off: setting a PIN and signing in
 * with one both answer 503 `KDS_PIN_NOT_CONFIGURED`. The API still boots —
 * a missing secret must not take ordering down with it.
 */
@Injectable()
export class KdsPinService {
  private readonly logger = new Logger(KdsPinService.name);
  private readonly secret: string | null;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const raw = (config.get<string>('KDS_PIN_SECRET') ?? '').trim();
    this.secret = PLACEHOLDER_SECRETS.has(raw) ? null : raw;
    if (!this.secret) {
      this.logger.error(
        'KDS_PIN_SECRET is missing or still CHANGE_ME — kitchen PIN sign-in and PIN setup are disabled. ' +
          'Set it in .env.production (openssl rand -hex 32), redeploy and re-issue PINs on the Staff page.',
      );
    }
  }

  /** True when a real `KDS_PIN_SECRET` is provisioned. */
  isConfigured(): boolean {
    return this.secret !== null;
  }

  /** Throws 503 `KDS_PIN_NOT_CONFIGURED` when PIN auth is off on this deployment. */
  assertConfigured(): void {
    if (!this.secret) {
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: 'KDS_PIN_NOT_CONFIGURED',
        message: 'Kitchen PIN sign-in is not configured on this server',
      });
    }
  }

  /**
   * Validates the PIN format. Throws nothing — caller decides on the error
   * shape (BadRequestException for admin set, UnauthorizedException for login).
   */
  isValidFormat(pin: string): boolean {
    return PIN_PATTERN.test(pin);
  }

  /** Whether a stored hash is a real one (not empty, not a legacy sentinel). */
  isUsableHash(stored: string | null | undefined): stored is string {
    return !!stored && !stored.startsWith(KDS_PIN_LEGACY_SENTINEL_PREFIX);
  }

  /**
   * HMAC of the PIN for one store. Always depends on the PIN — without a
   * secret it throws instead of returning anything a lookup could match.
   */
  hash(storeId: string, pin: string): string {
    this.assertConfigured();
    return createHmac('sha256', this.secret as string)
      .update(`${storeId}|${pin}`)
      .digest('hex');
  }

  /**
   * Constant-time comparison so a partial match doesn't leak via timing.
   * Both inputs are hex strings of equal length, so Buffer.from is safe.
   */
  matches(storeId: string, pin: string, expectedHash: string): boolean {
    if (!this.secret || !this.isUsableHash(expectedHash)) return false;
    const candidate = this.hash(storeId, pin);
    if (candidate.length !== expectedHash.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(expectedHash));
  }

  /**
   * Throws 429 `KDS_PIN_LOCKED` while a store has used up its failed
   * attempts. The per-IP throttle alone lets a botnet walk the 10⁴ space of
   * one store; this caps guesses per store regardless of where they come from.
   */
  async assertNotLocked(storeId: string): Promise<void> {
    const failures = Number((await this.redis.get(this.failuresKey(storeId))) ?? 0);
    if (failures >= KDS_PIN_MAX_FAILURES) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          code: 'KDS_PIN_LOCKED',
          message: 'Too many wrong PINs for this store, try again later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Counts a wrong PIN. The tenth failure inside the window re-arms the key
   * for a full {@link KDS_PIN_LOCK_SECONDS}, so the pause always lasts ten
   * minutes from the attempt that triggered it.
   */
  async recordFailure(storeId: string): Promise<void> {
    const key = this.failuresKey(storeId);
    const failures = await this.redis.incrWithTtl(key, KDS_PIN_LOCK_SECONDS);
    if (failures === KDS_PIN_MAX_FAILURES) {
      await this.redis.raw.expire(key, KDS_PIN_LOCK_SECONDS);
      this.logger.warn(`Kitchen PIN login paused for store ${storeId}: ${failures} wrong PINs`);
    }
  }

  /** A successful sign-in forgives the store's earlier typos. */
  async clearFailures(storeId: string): Promise<void> {
    await this.redis.del(this.failuresKey(storeId));
  }

  private failuresKey(storeId: string): string {
    return `kds-pin:failures:${storeId}`;
  }
}
