import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { KdsPinService } from '../../auth/services/kds-pin.service';
import type { PasswordService } from '../../auth/services/password.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminStaffService } from './admin-staff.service';

describe('AdminStaffService — kitchen PINs', () => {
  const manager = { id: 'manager-1', role: Role.STORE_MANAGER } as AuthenticatedUser;
  const owner = { id: 'owner-1', role: Role.BRAND_ADMIN } as AuthenticatedUser;

  function build(managerStores: string[] = ['store-1'], configured = true) {
    const prisma = {
      store: { findUnique: jest.fn().mockResolvedValue({ id: 'store-1', brandId: 'brand-1' }) },
      userStore: {
        findUnique: jest.fn(({ where }: { where: { userId_storeId: { userId: string; storeId: string } } }) => {
          const { userId, storeId } = where.userId_storeId;
          if (userId === manager.id) return Promise.resolve(managerStores.includes(storeId) ? { storeId } : null);
          return Promise.resolve({ userId, storeId });
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            createdAt: new Date('2026-09-01T08:00:00Z'),
            user: {
              id: 'barista-1',
              email: 'ion@noname.md',
              name: 'Ion',
              role: Role.STAFF,
              blockedAt: null,
              kdsPinHash: 'hash',
              kdsPinStoreId: 'store-1',
            },
          },
          {
            createdAt: new Date('2026-09-02T08:00:00Z'),
            user: {
              id: 'barista-2',
              email: 'ana@noname.md',
              name: 'Ana',
              role: Role.STAFF,
              blockedAt: null,
              kdsPinHash: 'hash',
              kdsPinStoreId: 'store-2',
            },
          },
        ]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'barista-1', role: Role.STAFF }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const scope = {
      resolveBrandIds: jest.fn().mockResolvedValue(['brand-1']),
      managesUser: jest.fn().mockResolvedValue(true),
    };
    const pins = {
      isValidFormat: () => true,
      hash: () => 'hash',
      isUsableHash: (h: string | null) => !!h && !h.startsWith('unset:'),
      assertConfigured: () => {
        if (!configured) {
          throw new ServiceUnavailableException({ code: 'KDS_PIN_NOT_CONFIGURED' });
        }
      },
    };
    const svc = new AdminStaffService(
      prisma as unknown as PrismaService,
      {} as PasswordService,
      pins as unknown as KdsPinService,
      scope as unknown as BrandScopeService,
    );
    return { svc, prisma };
  }

  it('says who already has a PIN for this store — one for another store does not count', async () => {
    const { svc } = build();
    const roster = await svc.list('store-1', owner);
    expect(roster.map((r) => [r.userId, r.hasKdsPin])).toEqual([
      ['barista-1', true],
      ['barista-2', false],
    ]);
  });

  it("keeps a store manager out of the brand's other stores", async () => {
    const { svc, prisma } = build(['store-2']);
    await expect(svc.setKdsPin('store-1', 'barista-1', '4821', manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('answers a PIN another barista of the store already uses with a 409 the admin can translate', async () => {
    const { svc, prisma } = build();
    prisma.user.update.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const error = await svc.setKdsPin('store-1', 'barista-1', '4821', manager).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_TAKEN' });
  });

  it('does not count a placeholder left by a build without KDS_PIN_SECRET as a PIN', async () => {
    const { svc, prisma } = build();
    const rows = await prisma.userStore.findMany();
    rows[0].user.kdsPinHash = 'unset:c3RvcmUtMQ';
    prisma.userStore.findMany.mockResolvedValueOnce(rows);
    const roster = await svc.list('store-1', owner);
    expect(roster.find((r) => r.userId === 'barista-1')?.hasKdsPin).toBe(false);
  });

  it('refuses to set a PIN with 503 KDS_PIN_NOT_CONFIGURED when the server has no secret', async () => {
    const { svc, prisma } = build(['store-1'], false);
    const error = await svc.setKdsPin('store-1', 'barista-1', '4821', manager).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_NOT_CONFIGURED' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

interface Account {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  blockedAt: Date | null;
  kdsPinHash: string | null;
  kdsPinStoreId: string | null;
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
    const account = (id: string, email: string, role: Role): Account => ({
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
        create: jest.fn(),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Account> }) =>
          Object.assign(userOf(where.id) ?? {}, data),
        ),
      },
    };
    const pins = {
      assertConfigured: () => undefined,
      isValidFormat: () => true,
      hash: () => 'hmac',
      isUsableHash: (h: string | null) => !!h,
    };
    const db = prisma as unknown as PrismaService;
    const svc = new AdminStaffService(
      db,
      { hash: async () => 'bcrypt' } as unknown as PasswordService,
      pins as unknown as KdsPinService,
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

  it('keeps every power for a super admin', async () => {
    const { svc, prisma, pivot } = world();
    pivot.push({ userId: 'victim', storeId: 'store-own', createdAt: at });
    await svc.setKdsPin('store-own', 'victim', '4821', superAdmin);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'victim' },
      data: { kdsPinHash: 'hmac', kdsPinStoreId: 'store-own' },
    });
  });
});
