import * as crypto from 'node:crypto';

import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import {
  EMAIL_CODE_HOURLY_LIMIT,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_RESEND_SECONDS,
  EMAIL_CODE_TTL_SECONDS,
  EmailCodeService,
} from './email-code.service';
import { MemoryRedis } from './testing/memory-redis';

// randomInt stays real unless a test asks for particular codes.
jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof crypto>('node:crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

const config = { get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'test-access-secret' : undefined) };

function setup() {
  const redis = new MemoryRedis();
  const codes = new EmailCodeService(redis.asService(), config as unknown as ConfigService);
  return { redis, codes };
}

/** The error body a failed call answered with. */
async function failure(promise: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() as Record<string, unknown> };
    }
    throw err;
  }
  throw new Error('expected the call to fail');
}

/** A six-digit code that is not `code`. */
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('EmailCodeService', () => {
  const email = 'ivan@mail.ru';

  it('issues six digits that work exactly once', async () => {
    const { codes } = setup();
    const code = await codes.issue(email, { locale: 'RU' });

    expect(code).toMatch(/^[0-9]{6}$/);
    await expect(codes.consume(email, code)).resolves.toEqual({ locale: 'RU' });
    expect((await failure(codes.consume(email, code))).body).toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
  });

  it('keeps neither the address nor the code in Redis in the clear', async () => {
    const { redis, codes } = setup();
    const code = await codes.issue(email, { locale: 'EN' });

    const stored = JSON.stringify(redis.dump());
    expect(stored).not.toContain('ivan');
    expect(stored).not.toContain('mail.ru');
    expect(stored).not.toContain(code);
  });

  it('counts wrong codes down and invalidates the code on the fifth', async () => {
    const { codes } = setup();
    const code = await codes.issue(email, { locale: 'EN' });

    for (let left = EMAIL_CODE_MAX_ATTEMPTS - 1; left >= 1; left--) {
      const { status, body } = await failure(codes.consume(email, wrong(code)));
      expect(status).toBe(400);
      expect(body).toMatchObject({ code: 'EMAIL_CODE_INVALID', attemptsLeft: left });
    }
    expect((await failure(codes.consume(email, wrong(code)))).body).toMatchObject({
      code: 'EMAIL_CODE_TOO_MANY_ATTEMPTS',
    });
    // The right code no longer helps: it is gone.
    expect((await failure(codes.consume(email, code))).body).toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
  });

  it('gives a burst of parallel guesses five looks in total', async () => {
    const { codes } = setup();
    const code = await codes.issue(email, { locale: 'EN' });

    const guesses = Array.from({ length: 20 }, (_, i) => String(i).padStart(6, '0')).filter((g) => g !== code);
    const outcomes = await Promise.all(guesses.map((guess) => failure(codes.consume(email, guess))));
    const reasons = outcomes.map((o) => o.body['code']);

    expect(reasons.filter((r) => r === 'EMAIL_CODE_INVALID')).toHaveLength(EMAIL_CODE_MAX_ATTEMPTS - 1);
    expect(reasons.every((r) => r !== undefined)).toBe(true);
    expect((await failure(codes.consume(email, code))).body).toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
  });

  it('lets a code lapse after ten minutes', async () => {
    const { redis, codes } = setup();
    const code = await codes.issue(email, { locale: 'EN' });

    redis.advance(EMAIL_CODE_TTL_SECONDS);
    expect((await failure(codes.consume(email, code))).body).toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
  });

  it('pauses a minute between codes to one address and says how long is left', async () => {
    const { redis, codes } = setup();
    const first = await codes.issue(email, { locale: 'EN' });

    redis.advance(20);
    const { status, body } = await failure(codes.issue(email, { locale: 'EN' }));
    expect(status).toBe(429);
    expect(body).toMatchObject({ code: 'EMAIL_CODE_COOLDOWN', retryAfterSeconds: EMAIL_CODE_RESEND_SECONDS - 20 });
    // Another address is not held up.
    await expect(codes.issue('other@mail.ru', { locale: 'EN' })).resolves.toMatch(/^[0-9]{6}$/);

    redis.advance(EMAIL_CODE_RESEND_SECONDS - 20);
    await expect(codes.issue(email, { locale: 'EN' })).resolves.toMatch(/^[0-9]{6}$/);
    expect(first).toMatch(/^[0-9]{6}$/);
  });

  it('replaces the earlier code when a new one is sent', async () => {
    const { redis, codes } = setup();
    (crypto.randomInt as unknown as jest.Mock).mockReturnValueOnce(4217).mockReturnValueOnce(990001);
    expect(await codes.issue(email, { locale: 'EN' })).toBe('004217');
    redis.advance(EMAIL_CODE_RESEND_SECONDS);
    expect(await codes.issue(email, { locale: 'RU' })).toBe('990001');

    expect((await failure(codes.consume(email, '004217'))).body).toMatchObject({ code: 'EMAIL_CODE_INVALID' });
    await expect(codes.consume(email, '990001')).resolves.toEqual({ locale: 'RU' });
  });

  it('gives a new code fresh attempts', async () => {
    const { redis, codes } = setup();
    const first = await codes.issue(email, { locale: 'EN' });
    for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS - 1; i++) await failure(codes.consume(email, wrong(first)));

    redis.advance(EMAIL_CODE_RESEND_SECONDS);
    const second = await codes.issue(email, { locale: 'EN' });
    expect((await failure(codes.consume(email, wrong(second)))).body).toMatchObject({
      code: 'EMAIL_CODE_INVALID',
      attemptsLeft: EMAIL_CODE_MAX_ATTEMPTS - 1,
    });
  });

  it('stops after the hourly limit until the hour is over', async () => {
    const { redis, codes } = setup();
    for (let i = 0; i < EMAIL_CODE_HOURLY_LIMIT; i++) {
      await codes.issue(email, { locale: 'EN' });
      redis.advance(EMAIL_CODE_RESEND_SECONDS);
    }

    const { status, body } = await failure(codes.issue(email, { locale: 'EN' }));
    expect(status).toBe(429);
    expect(body).toMatchObject({ code: 'EMAIL_CODE_LIMIT' });
    const wait = body['retryAfterSeconds'] as number;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60 * 60 - EMAIL_CODE_HOURLY_LIMIT * EMAIL_CODE_RESEND_SECONDS);

    redis.advance(wait);
    await expect(codes.issue(email, { locale: 'EN' })).resolves.toMatch(/^[0-9]{6}$/);
  });

  it('takes back a code whose letter did not go out, so the address can ask again at once', async () => {
    const { codes } = setup();
    const code = await codes.issue(email, { locale: 'EN' });

    await codes.withdraw(email);
    expect((await failure(codes.consume(email, code))).body).toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
    await expect(codes.issue(email, { locale: 'EN' })).resolves.toMatch(/^[0-9]{6}$/);
  });
});
