import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { RedisService } from '../../redis/redis.service';

/** What the tablet accepts: 4–6 digits, so PINs set before 6 became the rule keep working. */
const PIN_PATTERN = /^[0-9]{4,6}$/;
/** What a new PIN must be: exactly 6 digits — a million combinations instead of ten thousand. */
const NEW_PIN_PATTERN = /^[0-9]{6}$/;

/**
 * Prefix of the placeholder an older build stored when `KDS_PIN_SECRET` was
 * missing. It did not depend on the PIN, so any PIN unlocked such a row.
 * Rows carrying it are dead: they never authenticate and never count as a
 * PIN being set.
 */
export const KDS_PIN_LEGACY_SENTINEL_PREFIX = 'unset:';

/** Values that mean "nobody provisioned a secret" — the env example ships CHANGE_ME. */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set(['', 'CHANGE_ME']);

/** Wrong PINs one tablet may type before the first pause. */
export const KDS_PIN_FREE_ATTEMPTS = 5;
/** The first pause; every further wrong PIN doubles it. */
export const KDS_PIN_BASE_LOCK_SECONDS = 60;
/** The longest pause one tablet can earn. */
export const KDS_PIN_MAX_LOCK_SECONDS = 60 * 60;
/** How long a tablet's wrong PINs are remembered without a successful sign-in. */
export const KDS_PIN_FAILURE_WINDOW_SECONDS = 24 * 60 * 60;
/**
 * The brand-wide ceiling: this many wrong PINs at one brand within an hour,
 * from all its tablets together, pauses the brand's PIN sign-in. Far above
 * any honest shift — it only stops someone cycling through many tablet
 * tokens to get around the per-tablet pause.
 */
export const KDS_PIN_BRAND_MAX_FAILURES = 100;
export const KDS_PIN_BRAND_WINDOW_SECONDS = 60 * 60;
export const KDS_PIN_BRAND_LOCK_SECONDS = 15 * 60;

/** Why a new PIN is refused. */
export type NewPinProblem = 'FORMAT' | 'TOO_SIMPLE';

/**
 * KDS PIN cryptography. We hash the PIN with HMAC-SHA256 keyed by
 * `KDS_PIN_SECRET` mixed with the brand id ({@link brandHash}), so the same
 * PIN at two brands produces different hashes — and so a compromised
 * database row alone can't be brute-forced without the service-side secret.
 * One PIN opens every store the person works at in the brand. PINs set
 * before 2026-10-20 were mixed with a store id instead ({@link storeHash});
 * they keep working until they are replaced.
 *
 * We do NOT use bcrypt here on purpose: PIN auth needs to look up by
 * hash (not iterate every row), and a 4–6 digit space is small enough
 * that bcrypt's per-attempt cost is irrelevant once you can target
 * one row at a time. The HMAC scheme combined with rate-limiting (per IP
 * on the endpoint, per tablet and brand here) is the right tradeoff for a
 * tablet lockscreen.
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
   * Whether a PIN typed on the tablet has a shape worth looking up: 4–6
   * digits. Throws nothing — the login answers "wrong PIN" either way.
   */
  isValidFormat(pin: string): boolean {
    return PIN_PATTERN.test(pin);
  }

  /**
   * Why a PIN about to be set is refused, or null when it is fine: it must
   * be exactly 6 digits and not one of the first guesses (one digit six
   * times, a straight run like 123456 or 987654).
   */
  newPinProblem(pin: string): NewPinProblem | null {
    if (!NEW_PIN_PATTERN.test(pin)) return 'FORMAT';
    return isGuessable(pin) ? 'TOO_SIMPLE' : null;
  }

  /** 400 `KDS_PIN_FORMAT` / `KDS_PIN_TOO_SIMPLE` for a PIN that may not be set. */
  assertNewPinAllowed(pin: string): void {
    const problem = this.newPinProblem(pin);
    if (problem === 'FORMAT') {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: 'KDS_PIN_FORMAT',
        message: 'A new PIN must be exactly 6 digits',
      });
    }
    if (problem === 'TOO_SIMPLE') {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: 'KDS_PIN_TOO_SIMPLE',
        message: 'This PIN is too easy to guess — avoid repeated digits and runs like 123456',
      });
    }
  }

  /** Whether a stored hash is a real one (not empty, not a legacy sentinel). */
  isUsableHash(stored: string | null | undefined): stored is string {
    return !!stored && !stored.startsWith(KDS_PIN_LEGACY_SENTINEL_PREFIX);
  }

  /** The hash a PIN is stored and looked up by: one PIN for every store of the brand. */
  brandHash(brandId: string, pin: string): string {
    return this.hash(brandId, pin);
  }

  /** The hash of a PIN set before 2026-10-20, which opens one store only. */
  storeHash(storeId: string, pin: string): string {
    return this.hash(storeId, pin);
  }

  /**
   * HMAC of `${scope}|${pin}` — the scope being a brand id, or a store id for
   * the older PINs. Brand and store ids are both cuids, so the two never
   * meet. Always depends on the PIN — without a secret it throws instead of
   * returning anything a lookup could match.
   */
  hash(scopeId: string, pin: string): string {
    this.assertConfigured();
    return createHmac('sha256', this.secret as string)
      .update(`${scopeId}|${pin}`)
      .digest('hex');
  }

  /**
   * Constant-time comparison so a partial match doesn't leak via timing.
   * Both inputs are hex strings of equal length, so Buffer.from is safe.
   */
  matches(scopeId: string, pin: string, expectedHash: string): boolean {
    if (!this.secret || !this.isUsableHash(expectedHash)) return false;
    const candidate = this.hash(scopeId, pin);
    if (candidate.length !== expectedHash.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(expectedHash));
  }

  /**
   * Throws 429 `KDS_PIN_LOCKED` (with `retryAfterSeconds`) while this tablet
   * is paused, or while the whole brand is paused.
   *
   * The count is kept per tablet — the bound device the request comes from,
   * which is sturdier than an IP address that the whole café shares behind
   * one router — and only bound tablets of the brand can reach it at all.
   * It used to be per store; the PIN is typed before a store is picked now,
   * so it is per brand (a tablet belongs to one brand anyway).
   */
  async assertNotLocked(brandId: string, deviceId: string): Promise<void> {
    const deviceWait = await this.secondsLeft(this.deviceLockKey(brandId, deviceId));
    const brandWait = await this.secondsLeft(this.brandLockKey(brandId));
    const wait = Math.max(deviceWait, brandWait);
    if (wait > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          code: 'KDS_PIN_LOCKED',
          retryAfterSeconds: wait,
          message: 'Too many wrong PINs, try again later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Counts a wrong PIN from one tablet of a brand. The first
   * {@link KDS_PIN_FREE_ATTEMPTS} are free; from then on every wrong PIN
   * pauses the tablet, for a minute and then twice as long each time, up
   * to an hour. The brand-wide ceiling is counted alongside.
   */
  async recordFailure(brandId: string, deviceId: string): Promise<void> {
    const failures = await this.redis.incrWithTtl(
      this.deviceFailuresKey(brandId, deviceId),
      KDS_PIN_FAILURE_WINDOW_SECONDS,
    );
    const lockSeconds = lockSecondsAfter(failures);
    if (lockSeconds > 0) {
      await this.redis.set(this.deviceLockKey(brandId, deviceId), String(failures), lockSeconds);
    }

    const brandFailures = await this.redis.incrWithTtl(this.brandFailuresKey(brandId), KDS_PIN_BRAND_WINDOW_SECONDS);
    if (brandFailures === KDS_PIN_BRAND_MAX_FAILURES) {
      await this.redis.set(this.brandLockKey(brandId), String(brandFailures), KDS_PIN_BRAND_LOCK_SECONDS);
      this.logger.warn(`Kitchen PIN sign-in paused for brand ${brandId}: ${brandFailures} wrong PINs within an hour`);
    }
  }

  /** A successful sign-in forgives this tablet's earlier typos. */
  async clearFailures(brandId: string, deviceId: string): Promise<void> {
    await this.redis.del(this.deviceFailuresKey(brandId, deviceId), this.deviceLockKey(brandId, deviceId));
  }

  private async secondsLeft(key: string): Promise<number> {
    const ttl = await this.redis.raw.ttl(key);
    return ttl > 0 ? ttl : 0;
  }

  private deviceFailuresKey(brandId: string, deviceId: string): string {
    return `kds-pin:failures:${brandId}:${deviceId}`;
  }

  private deviceLockKey(brandId: string, deviceId: string): string {
    return `kds-pin:lock:${brandId}:${deviceId}`;
  }

  private brandFailuresKey(brandId: string): string {
    return `kds-pin:brand-failures:${brandId}`;
  }

  private brandLockKey(brandId: string): string {
    return `kds-pin:brand-lock:${brandId}`;
  }
}

/** The pause earned by the n-th wrong PIN in a row: none, then 1, 2, 4 … 60 minutes. */
export function lockSecondsAfter(failures: number): number {
  if (failures < KDS_PIN_FREE_ATTEMPTS) return 0;
  const doublings = failures - KDS_PIN_FREE_ATTEMPTS;
  // 2^6 minutes already passes the cap; stop before the shift overflows anything.
  if (doublings >= 6) return KDS_PIN_MAX_LOCK_SECONDS;
  return Math.min(KDS_PIN_MAX_LOCK_SECONDS, KDS_PIN_BASE_LOCK_SECONDS * 2 ** doublings);
}

/** One digit repeated, or a straight run up or down (123456, 987654). */
function isGuessable(pin: string): boolean {
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - (digits[i] as number));
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}
