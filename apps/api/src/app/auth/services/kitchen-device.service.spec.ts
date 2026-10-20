import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';
import type { BrandScopeService } from './brand-scope.service';
import { KITCHEN_PAIRING_TTL_SECONDS, KitchenDeviceService, hashKitchenDeviceToken } from './kitchen-device.service';
import type { UserStoreScopeService } from './user-store-scope.service';

interface DeviceRow {
  id: string;
  brandId: string;
  tokenHash: string;
  createdById: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

const BRANDS: Record<string, string> = { 'brand-1': 'NoName Coffee', 'brand-2': 'Качели' };
const STORE_BRAND: Record<string, string> = { 'store-1': 'brand-1', 'store-2': 'brand-1', 'other-store': 'brand-2' };

function harness(opts: { storeScope?: '*' | string[]; brandScope?: string[] | null } = {}) {
  const devices: DeviceRow[] = [];
  const redisValues = new Map<string, string>();
  const redisTtls = new Map<string, number>();
  const prisma = {
    store: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const brandId = STORE_BRAND[where.id];
        return brandId ? { brandId, brand: { name: BRANDS[brandId] } } : null;
      }),
      findMany: jest.fn().mockResolvedValue([{ id: 'store-1', name: 'NoName - центр', city: 'Тирасполь' }]),
    },
    brand: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        BRANDS[where.id] ? { id: where.id, name: BRANDS[where.id] } : null,
      ),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'owner-1', name: 'Иван', email: 'owner@noname.md' }]),
    },
    kitchenDevice: {
      create: jest.fn(async ({ data }: { data: Pick<DeviceRow, 'brandId' | 'tokenHash' | 'createdById'> }) => {
        const row: DeviceRow = {
          id: `device-${devices.length + 1}`,
          createdAt: new Date('2026-10-10T08:00:00Z'),
          lastUsedAt: null,
          revokedAt: null,
          ...data,
        };
        devices.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const row = devices.find((d) => d.tokenHash === where.tokenHash);
        return row ? { ...row, brand: { name: BRANDS[row.brandId] } } : null;
      }),
      findMany: jest.fn(async ({ where }: { where: { brandId: string } }) =>
        devices.filter((d) => d.brandId === where.brandId && !d.revokedAt),
      ),
      updateMany: jest.fn(async ({ where }: { where: { id: string; brandId: string } }) => {
        const row = devices.find((d) => d.id === where.id && d.brandId === where.brandId && !d.revokedAt);
        if (row) row.revokedAt = new Date();
        return { count: row ? 1 : 0 };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const redis = {
    set: jest.fn(async (key: string, value: string, ttl?: number) => {
      redisValues.set(key, value);
      if (ttl) redisTtls.set(key, ttl);
    }),
    raw: {
      getdel: jest.fn(async (key: string) => {
        const value = redisValues.get(key) ?? null;
        redisValues.delete(key);
        return value;
      }),
    },
  };
  const storeScope = { getScope: jest.fn().mockResolvedValue(opts.storeScope ?? ['store-1']) };
  const brandScope = {
    assertBrand: jest.fn(async (_user: AuthenticatedUser, brandId: string) => {
      const allowed = opts.brandScope === undefined ? ['brand-1'] : opts.brandScope;
      if (allowed !== null && !allowed.includes(brandId)) throw new ForbiddenException('outside');
    }),
  };
  const service = new KitchenDeviceService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    storeScope as unknown as UserStoreScopeService,
    brandScope as unknown as BrandScopeService,
  );
  return { service, prisma, devices, redis, redisTtls, storeScope };
}

const person = (role: Role, extra: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: role === Role.BRAND_ADMIN ? 'owner-1' : 'barista-1',
  phone: null,
  email: null,
  name: null,
  role,
  ...extra,
});

describe('KitchenDeviceService', () => {
  it('binds the tablet of a signed-in employee to the brand of their store; only the hash is stored', async () => {
    const { service, devices } = harness();
    const binding = await service.bindForUser(person(Role.STAFF), 'store-1');

    expect(binding).toMatchObject({ brandId: 'brand-1', brandName: 'NoName Coffee' });
    expect(binding.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(devices[0]?.tokenHash).toBe(hashKitchenDeviceToken(binding.deviceToken));
    expect(devices[0]?.tokenHash).not.toContain(binding.deviceToken);
    expect(devices[0]?.createdById).toBe('barista-1');
  });

  it('refuses to bind to a store the employee does not work at', async () => {
    const { service, devices } = harness({ storeScope: ['store-1'] });
    await expect(service.bindForUser(person(Role.STAFF), 'other-store')).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices).toHaveLength(0);
  });

  it('keeps a PIN session to its own stores', async () => {
    const { service } = harness({ storeScope: ['store-1', 'store-2'] });
    const pinSession = person(Role.STAFF, { kdsBrandId: 'brand-1', kdsStoreIds: ['store-1'] });
    await expect(service.bindForUser(pinSession, 'store-2')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.bindForUser(pinSession, 'store-1')).resolves.toMatchObject({ brandId: 'brand-1' });
  });

  it('refuses customers and menu editors', async () => {
    const { service } = harness({ storeScope: '*' });
    for (const role of [Role.CUSTOMER, Role.MENU_EDITOR, Role.RIDER]) {
      await expect(service.bindForUser(person(role), 'store-1')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('turns a one-time tablet link into a token exactly once', async () => {
    const { service, redisTtls } = harness();
    const { code, expiresAt } = await service.createPairingCode(person(Role.BRAND_ADMIN), 'brand-1');
    expect([...redisTtls.values()]).toEqual([KITCHEN_PAIRING_TTL_SECONDS]);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const binding = await service.redeemPairingCode(code);
    expect(binding).toMatchObject({ brandId: 'brand-1', brandName: 'NoName Coffee' });

    const again = (await service.redeemPairingCode(code).catch((e: unknown) => e)) as HttpException;
    expect(again.getStatus()).toBe(401);
    expect(again.getResponse()).toMatchObject({ code: 'KDS_PAIRING_INVALID' });
  });

  it('only lets the brand’s owner or managers make tablet links, never a PIN session', async () => {
    const { service } = harness({ brandScope: ['brand-1'] });
    await expect(service.createPairingCode(person(Role.BRAND_ADMIN), 'brand-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.createPairingCode(person(Role.STAFF), 'brand-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createPairingCode(
        person(Role.STORE_MANAGER, { kdsBrandId: 'brand-1', kdsStoreIds: ['store-1'] }),
        'brand-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists only the bound brand’s stores where someone holds a working PIN', async () => {
    const { service, prisma } = harness();
    const { deviceToken } = await service.bindForUser(person(Role.STAFF), 'store-1');

    const result = await service.storesFor(deviceToken);
    expect(result).toEqual({
      brandId: 'brand-1',
      brandName: 'NoName Coffee',
      stores: [{ id: 'store-1', name: 'NoName - центр', city: 'Тирасполь' }],
    });
    const where = prisma.store.findMany.mock.calls[0]?.[0].where;
    expect(where.brandId).toBe('brand-1');
    const holder = {
      role: { in: [Role.STAFF, Role.STORE_MANAGER] },
      blockedAt: null,
      kdsPinHash: { not: null },
      NOT: { kdsPinHash: { startsWith: 'unset:' } },
    };
    // Someone with the brand's PIN working at the store, or an old PIN of that store.
    expect(where.OR).toEqual([
      { userStores: { some: { user: { ...holder, kdsPinBrandId: 'brand-1' } } } },
      { kdsPinUsers: { some: { ...holder, kdsPinBrandId: null } } },
    ]);
  });

  it('answers KDS_DEVICE_UNKNOWN for no token, a made-up one, or an unbound tablet', async () => {
    const { service } = harness();
    const { deviceToken } = await service.bindForUser(person(Role.STAFF), 'store-1');
    const [device] = await service.list(person(Role.BRAND_ADMIN), 'brand-1');
    await service.revoke(person(Role.BRAND_ADMIN), 'brand-1', device?.id ?? '');

    for (const token of [undefined, 'made-up-token', deviceToken]) {
      const error = (await service.storesFor(token).catch((e: unknown) => e)) as HttpException;
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toMatchObject({ code: 'KDS_DEVICE_UNKNOWN' });
    }
    await expect(service.resolve(deviceToken)).resolves.toBeNull();
  });

  it('lists the brand’s tablets with who bound them, and refuses to unbind another brand’s', async () => {
    const { service } = harness();
    await service.createPairingCode(person(Role.BRAND_ADMIN), 'brand-1').then((p) => service.redeemPairingCode(p.code));

    const list = await service.list(person(Role.BRAND_ADMIN), 'brand-1');
    expect(list).toEqual([
      { id: 'device-1', createdAt: '2026-10-10T08:00:00.000Z', createdByName: 'Иван', lastUsedAt: null },
    ]);
    await expect(service.revoke(person(Role.BRAND_ADMIN), 'brand-1', 'device-404')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
