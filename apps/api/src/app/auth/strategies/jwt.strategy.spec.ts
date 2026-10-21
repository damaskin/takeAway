import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role, type User } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import type { UsersService } from '../../users/users.service';
import { JwtStrategy } from './jwt.strategy';

/** Stores and their brands; the barista works at store-1 and store-2 of brand-1, and store-9 of brand-2. */
const STORES: Record<string, string> = { 'store-1': 'brand-1', 'store-2': 'brand-1', 'store-9': 'brand-2' };
const WORKS_AT = ['store-1', 'store-2', 'store-9'];

function strategy(user: Partial<User> | null) {
  const users = { findById: jest.fn(async () => user) };
  const prisma = {
    store: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        STORES[where.id] ? { brandId: STORES[where.id] } : null,
      ),
    },
    userStore: {
      findMany: jest.fn(async ({ where }: { where: { userId: string; store: { brandId: string } } }) =>
        WORKS_AT.filter((id) => STORES[id] === where.store.brandId).map((storeId) => ({ storeId })),
      ),
    },
  };
  const config = { get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'secret' : undefined) } as ConfigService;
  return {
    jwt: new JwtStrategy(config, users as unknown as UsersService, prisma as unknown as PrismaService),
    prisma,
  };
}

const barista = (extra: Partial<User> = {}): Partial<User> => ({
  id: 'barista',
  role: Role.STAFF,
  email: null,
  phone: null,
  name: 'Ира',
  blockedAt: null,
  kdsPinHash: 'hash',
  kdsPinBrandId: 'brand-1',
  kdsPinStoreId: null,
  ...extra,
});

describe('JwtStrategy — kitchen PIN sessions', () => {
  it('leaves a password session unscoped and asks the database nothing more', async () => {
    const { jwt, prisma } = strategy(barista());
    const user = await jwt.validate({ sub: 'barista', jti: 'j' });
    expect(user).not.toHaveProperty('kdsBrandId');
    expect(user).not.toHaveProperty('kdsStoreIds');
    expect(prisma.userStore.findMany).not.toHaveBeenCalled();
  });

  it('scopes a PIN session to the person’s stores in the tablet’s brand, read on the request', async () => {
    const { jwt } = strategy(barista());
    const user = await jwt.validate({ sub: 'barista', jti: 'j', kdsb: 'brand-1', kds: 'store-1' });
    expect(user).toMatchObject({ kdsBrandId: 'brand-1', kdsStoreIds: ['store-1', 'store-2'] });
  });

  it('takes the brand from the store of a PIN token issued before brands, for an old store PIN', async () => {
    const { jwt } = strategy(barista({ kdsPinBrandId: null, kdsPinStoreId: 'store-2' }));
    const user = await jwt.validate({ sub: 'barista', jti: 'j', kds: 'store-2' });
    expect(user).toMatchObject({ kdsBrandId: 'brand-1', kdsStoreIds: ['store-1', 'store-2'] });
  });

  it.each([
    ['the PIN was reset', barista({ kdsPinHash: null, kdsPinBrandId: null })],
    ['the PIN is of another brand now', barista({ kdsPinBrandId: 'brand-2' })],
    ['an old PIN whose store is no longer the person’s', barista({ kdsPinBrandId: null, kdsPinStoreId: 'store-7' })],
    ['a placeholder from a build without a secret', barista({ kdsPinHash: 'unset:abc' })],
  ])('ends the PIN session when %s', async (_label, user) => {
    const { jwt } = strategy(user);
    await expect(jwt.validate({ sub: 'barista', jti: 'j', kdsb: 'brand-1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('ends an old PIN token whose store is gone', async () => {
    const { jwt } = strategy(barista());
    await expect(jwt.validate({ sub: 'barista', jti: 'j', kds: 'store-404' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a blocked account, PIN or not', async () => {
    const { jwt } = strategy(barista({ blockedAt: new Date() }));
    await expect(jwt.validate({ sub: 'barista', jti: 'j' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
