import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import { BrandScopeService } from '../../auth/services/brand-scope.service';
import { KdsPinService } from '../../auth/services/kds-pin.service';
import { KitchenPinsService } from '../../auth/services/kitchen-pins.service';
import type { PasswordService } from '../../auth/services/password.service';
import type { TokensService } from '../../auth/services/tokens.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import { AdminStaffService } from './admin-staff.service';

/** The real PIN rules (KdsPinService, KitchenPinsService) over a fake database. */
function kitchenPinsFor(prisma: unknown, configured = true) {
  const config = { get: (key: string) => (key === 'KDS_PIN_SECRET' && configured ? 'a-real-secret' : undefined) };
  const pins = new KdsPinService(config as unknown as ConfigService, {} as RedisService);
  const tokens = { revokeKitchenSessions: jest.fn().mockResolvedValue(1) };
  const kitchenPins = new KitchenPinsService(prisma as PrismaService, pins, tokens as unknown as TokensService);
  return { pins, tokens, kitchenPins };
}

describe('AdminStaffService — kitchen PINs', () => {
  const manager = { id: 'manager-1', role: Role.STORE_MANAGER } as AuthenticatedUser;
  const owner = { id: 'owner-1', role: Role.BRAND_ADMIN } as AuthenticatedUser;
  const brandPin = new KdsPinService(
    { get: () => 'a-real-secret' } as unknown as ConfigService,
    {} as RedisService,
  ).brandHash('brand-1', '480317');

  function build(managerStores: string[] = ['store-1'], configured = true) {
    const roster = [
      {
        createdAt: new Date('2026-09-01T08:00:00Z'),
        // An old PIN of this store.
        user: {
          id: 'barista-1',
          email: 'ion@noname.md',
          name: 'Ion',
          role: Role.STAFF,
          blockedAt: null,
          kdsPinHash: 'hash',
          kdsPinStoreId: 'store-1',
          kdsPinBrandId: null as string | null,
        },
      },
      {
        createdAt: new Date('2026-09-02T08:00:00Z'),
        // An old PIN of another store.
        user: {
          id: 'barista-2',
          email: 'ana@noname.md',
          name: 'Ana',
          role: Role.STAFF,
          blockedAt: null,
          kdsPinHash: 'hash',
          kdsPinStoreId: 'store-2',
          kdsPinBrandId: null as string | null,
        },
      },
      {
        createdAt: new Date('2026-09-03T08:00:00Z'),
        // The brand's PIN, which opens every store of the brand the person works at.
        user: {
          id: 'barista-3',
          email: 'ira@noname.md',
          name: 'Ira',
          role: Role.STAFF,
          blockedAt: null,
          kdsPinHash: 'brand-hash',
          kdsPinStoreId: null as string | null,
          kdsPinBrandId: 'brand-1' as string | null,
        },
      },
    ];
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'store-1', brandId: 'brand-1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'store-1' }, { id: 'store-2' }]),
      },
      userStore: {
        findUnique: jest.fn(({ where }: { where: { userId_storeId: { userId: string; storeId: string } } }) => {
          const { userId, storeId } = where.userId_storeId;
          if (userId === manager.id) return Promise.resolve(managerStores.includes(storeId) ? { storeId } : null);
          return Promise.resolve({ userId, storeId });
        }),
        findMany: jest.fn(async ({ where }: { where: { userId?: string } }) =>
          where.userId ? [{ store: { brandId: 'brand-1' } }] : roster,
        ),
      },
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          const row = roster.find((r) => r.user.id === where.id)?.user;
          return row ?? { id: where.id, role: Role.STAFF, kdsPinHash: null, kdsPinStoreId: null, kdsPinBrandId: null };
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const scope = {
      resolveBrandIds: jest.fn().mockResolvedValue(['brand-1']),
      managesUser: jest.fn().mockResolvedValue(true),
    };
    const { kitchenPins, tokens } = kitchenPinsFor(prisma, configured);
    const svc = new AdminStaffService(
      prisma as unknown as PrismaService,
      {} as PasswordService,
      kitchenPins,
      scope as unknown as BrandScopeService,
    );
    return { svc, prisma, tokens, roster };
  }

  it('says who can open this store’s tablet: an old PIN of this store, or the brand’s PIN', async () => {
    const { svc } = build();
    const roster = await svc.list('store-1', owner);
    expect(roster.map((r) => [r.userId, r.hasKdsPin])).toEqual([
      ['barista-1', true],
      ['barista-2', false],
      ['barista-3', true],
    ]);
  });

  it('sets the person’s one PIN for the whole brand from the store page, and ends their tablet sessions', async () => {
    const { svc, prisma, tokens } = build();
    await svc.setKdsPin('store-1', 'barista-1', '480317', manager);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'barista-1' },
      data: { kdsPinHash: brandPin, kdsPinBrandId: 'brand-1', kdsPinStoreId: null },
    });
    expect(tokens.revokeKitchenSessions).toHaveBeenCalledWith('barista-1');
  });

  it("keeps a store manager out of the brand's other stores", async () => {
    const { svc, prisma } = build(['store-2']);
    await expect(svc.setKdsPin('store-1', 'barista-1', '480317', manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('answers a PIN somebody else at the brand already uses with a 409 the admin can translate', async () => {
    const { svc, prisma } = build();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'barista-3' });
    const error = await svc.setKdsPin('store-1', 'barista-1', '480317', manager).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_TAKEN' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('counts an old store PIN with the same digits as taken, and loses a race to the unique index the same way', async () => {
    const { svc, prisma } = build();
    // Free as a brand PIN, but an old PIN of store-2 has these digits.
    prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'barista-2' });
    const legacy = await svc.setKdsPin('store-1', 'barista-1', '480317', manager).catch((e: unknown) => e);
    expect((legacy as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_TAKEN' });

    prisma.user.update.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const race = await svc.setKdsPin('store-1', 'barista-1', '480317', manager).catch((e: unknown) => e);
    expect((race as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_TAKEN' });
  });

  it('resets a PIN that opens this store, and leaves one of another store alone', async () => {
    const { svc, prisma, tokens } = build();
    await svc.clearKdsPin('store-1', 'barista-2', owner);
    expect(prisma.user.update).not.toHaveBeenCalled();

    await svc.clearKdsPin('store-1', 'barista-3', owner);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'barista-3' },
      data: { kdsPinHash: null, kdsPinBrandId: null, kdsPinStoreId: null },
    });
    expect(tokens.revokeKitchenSessions).toHaveBeenCalledWith('barista-3');
  });

  it('does not count a placeholder left by a build without KDS_PIN_SECRET as a PIN', async () => {
    const { svc, roster } = build();
    const first = roster[0];
    if (first) first.user.kdsPinHash = 'unset:c3RvcmUtMQ';
    const list = await svc.list('store-1', owner);
    expect(list.find((r) => r.userId === 'barista-1')?.hasKdsPin).toBe(false);
  });

  it('refuses to set a PIN with 503 KDS_PIN_NOT_CONFIGURED when the server has no secret', async () => {
    const { svc, prisma } = build(['store-1'], false);
    const error = await svc.setKdsPin('store-1', 'barista-1', '480317', manager).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_NOT_CONFIGURED' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

interface Account {
  id: string;
  email: string | null;
  login?: string | null;
  name: string | null;
  role: Role;
  blockedAt: Date | null;
  kdsPinHash: string | null;
  kdsPinStoreId: string | null;
  kdsPinBrandId?: string | null;
}

/**
 * The store roster against an in-memory database and the real
 * BrandScopeService: "brand-own" belongs to a freshly registered business,
 * "brand-victim" to another one whose manager it would like to take over.
 */
describe('AdminStaffService — accounts that also work for another brand', () => {
  const owner = { id: 'owner', role: Role.BRAND_ADMIN } as AuthenticatedUser;
  const superAdmin = { id: 'root', role: Role.SUPER_ADMIN } as AuthenticatedUser;
  const at = new Date('2026-09-01T08:00:00Z');

  function world() {
    const brands = [
      { id: 'brand-own', ownerId: 'owner' },
      { id: 'brand-victim', ownerId: 'victim-owner' },
    ];
    const stores = [
      { id: 'store-own', brandId: 'brand-own' },
      { id: 'store-own-2', brandId: 'brand-own' },
      { id: 'store-victim', brandId: 'brand-victim' },
    ];
    const account = (id: string, email: string | null, role: Role): Account => ({
      id,
      email,
      name: id,
      role,
      blockedAt: null,
      kdsPinHash: null,
      kdsPinStoreId: null,
    });
    const users: Account[] = [
      account('victim', 'chef@victim.md', Role.STORE_MANAGER),
      account('barista', 'ion@own.md', Role.STAFF),
      account('customer', 'guest@mail.md', Role.CUSTOMER),
      account('victim-owner', 'boss@victim.md', Role.BRAND_ADMIN),
    ];
    const pivot = [
      { userId: 'victim', storeId: 'store-victim', createdAt: at },
      { userId: 'barista', storeId: 'store-own', createdAt: at },
    ];
    const brandOf = (storeId: string) => stores.find((st) => st.id === storeId)?.brandId ?? '';
    const userOf = (id: string) => users.find((u) => u.id === id);

    const prisma = {
      brand: {
        findMany: async ({ where }: { where: { ownerId: string } }) =>
          brands.filter((b) => b.ownerId === where.ownerId).map((b) => ({ id: b.id })),
      },
      store: {
        findUnique: async ({ where }: { where: { id: string } }) => stores.find((st) => st.id === where.id) ?? null,
        findMany: async ({ where }: { where: { brandId: string } }) =>
          stores.filter((st) => st.brandId === where.brandId).map((st) => ({ id: st.id })),
      },
      userStore: {
        findUnique: async ({ where }: { where: { userId_storeId: { userId: string; storeId: string } } }) => {
          const { userId, storeId } = where.userId_storeId;
          const row = pivot.find((p) => p.userId === userId && p.storeId === storeId);
          return row ? { ...row, user: userOf(userId) } : null;
        },
        // Two shapes: a store's roster, and the stores of one user (brand scope).
        findMany: async ({
          where,
        }: {
          where: { userId?: string; storeId?: string; user?: { role: { in: Role[] } } };
        }) =>
          where.userId
            ? pivot.filter((p) => p.userId === where.userId).map((p) => ({ store: { brandId: brandOf(p.storeId) } }))
            : pivot
                .filter((p) => p.storeId === where.storeId)
                .map((p) => ({ createdAt: p.createdAt, user: userOf(p.userId) }))
                .filter((r) => r.user && where.user?.role.in.includes(r.user.role)),
        count: async ({ where }: { where: { userId: string; store: { brandId: { notIn: string[] } } } }) =>
          pivot.filter((p) => p.userId === where.userId && !where.store.brandId.notIn.includes(brandOf(p.storeId)))
            .length,
        create: jest.fn(async ({ data }: { data: { userId: string; storeId: string } }) => {
          pivot.push({ ...data, createdAt: at });
          return data;
        }),
        deleteMany: jest.fn(async ({ where }: { where: { userId: string; storeId: string } }) => {
          const index = pivot.findIndex((p) => p.userId === where.userId && p.storeId === where.storeId);
          if (index >= 0) pivot.splice(index, 1);
          return { count: index >= 0 ? 1 : 0 };
        }),
      },
      user: {
        findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
          users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
        findFirst: jest.fn(
          async ({
            where,
          }: {
            where: { OR?: { login?: string; email?: string }[]; kdsPinBrandId?: string | null };
          }) => {
            // A PIN lookup (KitchenPinsService): nobody here has one.
            if (where.kdsPinBrandId !== undefined) return null;
            const hit = users.find((u) =>
              (where.OR ?? []).some((c) => (c.login !== undefined ? u.login === c.login : u.email === c.email)),
            );
            return hit ? { id: hit.id } : null;
          },
        ),
        create: jest.fn(async ({ data }: { data: Partial<Account> & { role: Role } }) => {
          const created = { ...account(`new-${users.length}`, null, data.role), ...data };
          users.push(created);
          return { id: created.id };
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Account> }) =>
          Object.assign(userOf(where.id) ?? {}, data),
        ),
      },
    };
    const db = prisma as unknown as PrismaService;
    const svc = new AdminStaffService(
      db,
      { hash: async () => 'bcrypt' } as unknown as PasswordService,
      kitchenPinsFor(prisma).kitchenPins,
      new BrandScopeService(db),
    );
    const storesOf = (userId: string) =>
      pivot
        .filter((p) => p.userId === userId)
        .map((p) => p.storeId)
        .sort();
    return { svc, prisma, users, pivot, storesOf };
  }

  const add = (email: string, role: Role = Role.STAFF) => ({ email, role, tempPassword: 'temporary-1' });
  const responseOf = (error: unknown) => (error as HttpException).getResponse();

  it("refuses another brand's employee: no link, no role change, an answer without the role", async () => {
    const { svc, prisma, users, storesOf } = world();
    const error = await svc.add('store-own', add('Chef@Victim.md'), owner).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(responseOf(error)).toMatchObject({ code: 'STAFF_EMAIL_TAKEN', field: 'email' });
    expect(JSON.stringify(responseOf(error))).not.toMatch(/STORE_MANAGER|chef@victim/i);
    expect(storesOf('victim')).toEqual(['store-victim']);
    expect(users.find((u) => u.id === 'victim')?.role).toBe(Role.STORE_MANAGER);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('answers a customer or an admin email exactly the same way', async () => {
    const { svc } = world();
    const employee = await svc.add('store-own', add('chef@victim.md'), owner).catch((e: unknown) => e);
    const customer = await svc.add('store-own', add('guest@mail.md'), owner).catch((e: unknown) => e);
    const admin = await svc.add('store-own', add('boss@victim.md'), owner).catch((e: unknown) => e);
    expect(responseOf(customer)).toEqual(responseOf(employee));
    expect(responseOf(admin)).toEqual(responseOf(employee));
  });

  it('still re-uses an account that works only for this brand, and changes its role', async () => {
    const { svc, storesOf, users } = world();
    const entry = await svc.add('store-own-2', add('ion@own.md', Role.MENU_EDITOR), owner);
    expect(entry).toMatchObject({ userId: 'barista', role: Role.MENU_EDITOR });
    expect(storesOf('barista')).toEqual(['store-own', 'store-own-2']);
    expect(users.find((u) => u.id === 'barista')?.role).toBe(Role.MENU_EDITOR);
  });

  describe('by login, for someone without an email', () => {
    const byLogin = (login: string, role: Role = Role.STAFF) => ({ login, role, tempPassword: 'temporary-1' });

    it('creates a new account with the login, a temporary password to change and no email', async () => {
      const { svc, prisma, users, storesOf } = world();
      const entry = await svc.add('store-own', byLogin('Ion.K'), owner);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { login: 'ion.k', passwordHash: 'bcrypt', passwordMustChange: true, name: null, role: Role.STAFF },
        select: { id: true },
      });
      expect(entry).toMatchObject({ login: 'ion.k', email: null, role: Role.STAFF });
      expect(storesOf(entry.userId)).toEqual(['store-own']);
      expect(users.find((u) => u.id === entry.userId)?.email).toBeNull();
    });

    it("never attaches another brand's employee who has the login: 409 LOGIN_IN_USE without the role", async () => {
      const { svc, prisma, users, storesOf } = world();
      const victim = users.find((u) => u.id === 'victim');
      if (victim) victim.login = 'chef';

      const error = await svc.add('store-own', byLogin('Chef', Role.STORE_MANAGER), owner).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(responseOf(error)).toMatchObject({ code: 'LOGIN_IN_USE', field: 'login' });
      expect(JSON.stringify(responseOf(error))).not.toMatch(/STORE_MANAGER|victim/i);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.userStore.create).not.toHaveBeenCalled();
      expect(storesOf('victim')).toEqual(['store-victim']);
    });
  });

  it('sets no PIN and no role for an account that also works at a store of another brand', async () => {
    const { svc, prisma, pivot } = world();
    // A link left over from before the fix.
    pivot.push({ userId: 'victim', storeId: 'store-own', createdAt: at });

    const pin = await svc.setKdsPin('store-own', 'victim', '4821', owner).catch((e: unknown) => e);
    expect(pin).toBeInstanceOf(ForbiddenException);
    expect(responseOf(pin)).toMatchObject({ code: 'STAFF_NOT_EDITABLE' });

    const role = await svc.changeRole('store-own', 'victim', Role.STAFF, owner).catch((e: unknown) => e);
    expect(role).toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('still lets the brand take such an account off its own store', async () => {
    const { svc, pivot, storesOf } = world();
    pivot.push({ userId: 'victim', storeId: 'store-own', createdAt: at });
    await svc.remove('store-own', 'victim', owner);
    expect(storesOf('victim')).toEqual(['store-victim']);
    await expect(svc.remove('store-own', 'victim', owner)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a super admin set a PIN — of one brand: someone working for two is told why not', async () => {
    const { svc, prisma, pivot } = world();
    await svc.setKdsPin('store-own', 'barista', '480317', superAdmin);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'barista' },
      data: { kdsPinHash: expect.stringMatching(/^[0-9a-f]{64}$/), kdsPinBrandId: 'brand-own', kdsPinStoreId: null },
    });

    pivot.push({ userId: 'victim', storeId: 'store-own', createdAt: at });
    const twoBrands = await svc.setKdsPin('store-own', 'victim', '480317', superAdmin).catch((e: unknown) => e);
    expect(twoBrands).toBeInstanceOf(ConflictException);
    expect(responseOf(twoBrands)).toMatchObject({ code: 'KDS_PIN_MULTI_BRAND' });
  });
});
