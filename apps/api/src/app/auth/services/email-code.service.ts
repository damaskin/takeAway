import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../redis/redis.service';
import { jwtAccessSecret } from '../jwt-secrets';

/** How long a mailed code works. */
export const EMAIL_CODE_TTL_SECONDS = 10 * 60;
/** Wrong codes allowed per mailed code; the last one invalidates it. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
/** Pause between two codes to the same address. */
export const EMAIL_CODE_RESEND_SECONDS = 60;
/** Codes one address may receive within an hour. */
export const EMAIL_CODE_HOURLY_LIMIT = 5;
const HOUR_SECONDS = 60 * 60;

/** What the code was requested with, kept until it is used. */
export interface IssuedEmailCode {
  locale: 'RU' | 'EN';
}

interface StoredCode extends IssuedEmailCode {
  hash: string;
}

/**
 * One-time sign-in codes mailed to customers, kept in Redis.
 *
 * Nothing here knows about accounts: a code is issued for any well-formed
 * address, so `POST /auth/email/start` behaves the same whether a profile
 * exists or not.
 *
 * Per address there is one live code (a new one replaces the old), valid
 * for {@link EMAIL_CODE_TTL_SECONDS}. It is stored as an HMAC keyed by a
 * secret derived from `JWT_ACCESS_SECRET`, so a dump of Redis cannot be
 * brute-forced offline, and the address only appears in key names as such
 * an HMAC too. Wrong attempts are counted before the comparison, so a burst
 * of parallel guesses still gets {@link EMAIL_CODE_MAX_ATTEMPTS} in total;
 * the last one deletes the code.
 */
@Injectable()
export class EmailCodeService {
  private readonly key: Buffer;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.key = createHmac('sha256', jwtAccessSecret(config)).update('takeaway:email-login-code').digest();
  }

  /**
   * A fresh six-digit code for `email` (already normalised), replacing any
   * earlier one and resetting its attempts. Throws 429 `EMAIL_CODE_COOLDOWN`
   * within {@link EMAIL_CODE_RESEND_SECONDS} of the previous code and 429
   * `EMAIL_CODE_LIMIT` past {@link EMAIL_CODE_HOURLY_LIMIT} codes an hour,
   * both with `retryAfterSeconds`.
   */
  async issue(email: string, issued: IssuedEmailCode): Promise<string> {
    const id = this.idOf(email);
    const placed = await this.redis.raw.set(this.cooldownKey(id), '1', 'EX', EMAIL_CODE_RESEND_SECONDS, 'NX');
    if (placed !== 'OK') {
      throw tooManyRequests(
        'EMAIL_CODE_COOLDOWN',
        'A code was sent to this address a moment ago — wait before asking for another',
        await this.secondsLeft(this.cooldownKey(id), EMAIL_CODE_RESEND_SECONDS),
      );
    }

    const sent = await this.redis.incrWithTtl(this.hourlyKey(id), HOUR_SECONDS);
    if (sent > EMAIL_CODE_HOURLY_LIMIT) {
      throw tooManyRequests(
        'EMAIL_CODE_LIMIT',
        'Too many codes were sent to this address — try again later',
        await this.secondsLeft(this.hourlyKey(id), HOUR_SECONDS),
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const stored: StoredCode = { hash: this.hash(id, code), locale: issued.locale };
    await this.redis.raw
      .multi()
      .set(this.codeKey(id), JSON.stringify(stored), 'EX', EMAIL_CODE_TTL_SECONDS)
      .del(this.attemptsKey(id))
      .exec();
    return code;
  }

  /**
   * Takes back a code whose letter never left, so the address may ask again
   * right away. The attempt still counts toward the hourly limit.
   */
  async withdraw(email: string): Promise<void> {
    const id = this.idOf(email);
    await this.redis.del(this.codeKey(id), this.attemptsKey(id), this.cooldownKey(id));
  }

  /**
   * Uses up the code for `email`. Resolves with what it was requested with;
   * throws 400 `EMAIL_CODE_EXPIRED` (none, timed out or already used),
   * `EMAIL_CODE_INVALID` (with `attemptsLeft`) or
   * `EMAIL_CODE_TOO_MANY_ATTEMPTS` (the code is gone, ask for a new one).
   */
  async consume(email: string, code: string): Promise<IssuedEmailCode> {
    const id = this.idOf(email);
    const raw = await this.redis.get(this.codeKey(id));
    const stored = raw ? parseStored(raw) : null;
    if (!stored) throw expired();

    // Count first, compare second: parallel guesses each get their own
    // number, and only the first EMAIL_CODE_MAX_ATTEMPTS are looked at.
    const attempts = await this.redis.incrWithTtl(this.attemptsKey(id), EMAIL_CODE_TTL_SECONDS);
    if (attempts > EMAIL_CODE_MAX_ATTEMPTS) {
      await this.redis.del(this.codeKey(id), this.attemptsKey(id));
      throw tooManyAttempts();
    }

    if (!sameHash(stored.hash, this.hash(id, code))) {
      if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        await this.redis.del(this.codeKey(id), this.attemptsKey(id));
        throw tooManyAttempts();
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          code: 'EMAIL_CODE_INVALID',
          message: 'The code is wrong',
          attemptsLeft: EMAIL_CODE_MAX_ATTEMPTS - attempts,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Single use: of two requests carrying the right code, only the one
    // that deletes the key goes on to sign in.
    const removed = await this.redis.raw.del(this.codeKey(id));
    if (removed === 0) throw expired();
    await this.redis.del(this.attemptsKey(id));
    return { locale: stored.locale };
  }

  private idOf(email: string): string {
    return createHmac('sha256', this.key).update(`email:${email}`).digest('hex').slice(0, 40);
  }

  private hash(id: string, code: string): string {
    return createHmac('sha256', this.key).update(`code:${id}:${code}`).digest('hex');
  }

  private async secondsLeft(key: string, fallback: number): Promise<number> {
    const ttl = await this.redis.raw.ttl(key);
    return ttl > 0 ? ttl : fallback;
  }

  private codeKey(id: string): string {
    return `email-code:${id}`;
  }

  private attemptsKey(id: string): string {
    return `email-code:attempts:${id}`;
  }

  private cooldownKey(id: string): string {
    return `email-code:cooldown:${id}`;
  }

  private hourlyKey(id: string): string {
    return `email-code:hourly:${id}`;
  }
}

function parseStored(raw: string): StoredCode | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredCode>;
    if (typeof value.hash !== 'string') return null;
    return { hash: value.hash, locale: value.locale === 'RU' ? 'RU' : 'EN' };
  } catch {
    return null;
  }
}

/** Both are hex HMAC-SHA256 digests, so equal lengths are the honest case. */
function sameHash(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function tooManyRequests(code: string, message: string, retryAfterSeconds: number): HttpException {
  return new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', code, message, retryAfterSeconds },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function expired(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      code: 'EMAIL_CODE_EXPIRED',
      message: 'The code has expired or was already used — ask for a new one',
    },
    HttpStatus.BAD_REQUEST,
  );
}

function tooManyAttempts(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      code: 'EMAIL_CODE_TOO_MANY_ATTEMPTS',
      message: 'Too many wrong codes — ask for a new one',
    },
    HttpStatus.BAD_REQUEST,
  );
}
