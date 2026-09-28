import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';

import type { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { TokensService } from './tokens.service';

/** In-memory Redis with the handful of commands the token store uses. SCAN pages one key at a time. */
function fakeRedis() {
  const store = new Map<string, string>();
  let pages: string[] = [];
  const literal = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  /** Redis glob subset: `*`, `?` and backslash escapes. */
  const globToRegExp = (glob: string) => {
    let source = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i] as string;
      if (c === '\\' && i + 1 < glob.length) source += literal(glob[++i] as string);
      else if (c === '*') source += '.*';
      else if (c === '?') source += '.';
      else source += literal(c);
    }
    return new RegExp(`^${source}$`);
  };
  const client = {
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (...keys: string[]) => keys.filter((k) => store.delete(k)).length),
    scan: jest.fn(async (cursor: string, _match: 'MATCH', pattern: string) => {
      if (cursor === '0') pages = [...store.keys()].filter((k) => globToRegExp(pattern).test(k));
      const index = Number(cursor);
      const next = index + 1 < pages.length ? String(index + 1) : '0';
      return [next, pages.slice(index, index + 1)];
    }),
  };
  return { store, client };
}

function setup() {
  const { store, client } = fakeRedis();
  const blocked = new Set<string>();
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'gone' ? null : { blockedAt: blocked.has(where.id) ? new Date() : null },
      ),
    },
  };
  const tokens = new TokensService(
    new JwtService({ secret: 'test-access-secret' }),
    new RedisService(client as unknown as Redis),
    prisma as unknown as PrismaService,
    { get: () => undefined } as unknown as ConfigService,
  );
  return { tokens, store, blocked };
}

describe('TokensService', () => {
  it('rotates a live refresh token once', async () => {
    const { tokens } = setup();
    const session = await tokens.issue('ana', 'device-1');

    await expect(tokens.rotate(session.refreshToken)).resolves.toMatchObject({ refreshToken: expect.any(String) });
    await expect(tokens.rotate(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokeAll ends every session of the user and leaves other users alone', async () => {
    const { tokens, store } = setup();
    const phone = await tokens.issue('ana', 'device-1');
    const laptop = await tokens.issue('ana', 'device-2');
    const bob = await tokens.issue('bob', 'device-3');

    await expect(tokens.revokeAll('ana')).resolves.toBe(2);

    expect([...store.keys()].every((k) => !k.startsWith('auth:refresh:ana:'))).toBe(true);
    await expect(tokens.rotate(phone.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(tokens.rotate(laptop.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(tokens.rotate(bob.refreshToken)).resolves.toMatchObject({ refreshToken: expect.any(String) });
  });

  it('never lets a user id widen the pattern', async () => {
    const { tokens } = setup();
    await tokens.issue('ana', null);
    await expect(tokens.revokeAll('*')).resolves.toBe(0);
  });

  it('refuses to rotate for a blocked or deleted account even while the token is stored', async () => {
    const { tokens, blocked, store } = setup();
    const session = await tokens.issue('ana', 'device-1');
    blocked.add('ana');

    await expect(tokens.rotate(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    // The token is spent either way, so it cannot be retried after an unblock.
    expect([...store.keys()]).toEqual([]);
  });

  it('refuses to rotate when the user row is gone', async () => {
    const { tokens } = setup();
    const session = await tokens.issue('gone', null);
    await expect(tokens.rotate(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
