import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { PasswordService } from '../../auth/services/password.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminStaffMembersService } from './admin-staff-members.service';

interface FakeUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: Role;
  blockedAt: Date | null;
  createdAt: Date;
  kdsPinHash: string | null;
  kdsPinStoreId: string | null;
}

interface StoreIdFilter {
  storeId?: { in: string[] };
}

/**
 * An in-memory stand-in for the slice of Prisma the service uses, so the
 * scope rules are checked against real set logic rather than call shapes.
 */
function world() {
  const stores = [
    { id: 'store-centre', brandId: 'brand-1', name: 'Centre' },
    { id: 'store-station', brandId: 'brand-1', name: 'Station' },
    { id: 'store-other', brandId: 'brand-2', name: 'Elsewhere' },
  ];
  const at = new Date('2026-09-01T08:00:00Z');
  const user = (id: string, role: Role, extra: Partial<FakeUser> = {}): FakeUser => ({
    id,
    email: `${id}@noname.md`,
    phone: null,
    name: id,
    role,
    blockedAt: null,
    createdAt: at,
    kdsPinHash: null,
    kdsPinStoreId: null,
    ...extra,
  });
  const users: FakeUser[] = [
    user('owner', Role.BRAND_ADMIN),
    user('manager-centre', Role.STORE_MANAGER),
    user('manager-station', Role.STORE_MANAGER),
    user('barista', Role.STAFF, { kdsPinHash: 'hash', kdsPinStoreId: 'store-station' }),
    user('cook', Role.STAFF),
    user('foreign-barista', Role.STAFF),
    user('customer', Role.CUSTOMER),
  ];
  let pivot = [
    { userId: 'manager-centre', storeId: 'store-centre', createdAt: at },
    { userId: 'manager-station', storeId: 'store-station', createdAt: at },
    { userId: 'barista', storeId: 'store-centre', createdAt: new Date('2026-09-03T08:00:00Z') },
    { userId: 'barista', storeId: 'store-station', createdAt: new Date('2026-09-02T08:00:00Z') },
    { userId: 'cook', storeId: 'store-station', createdAt: at },
    { userId: 'foreign-barista', storeId: 'store-other', createdAt: at },
  ];

  const withStores = (u: FakeUser, select?: { userStores?: { where?: StoreIdFilter } }) => {
    const filter = select?.userStores?.where?.storeId?.in;
    const userStores = pivot
      .filter((p) => p.userId === u.id && (!filter || filter.includes(p.storeId)))
      .map((p) => ({ storeId: p.storeId, createdAt: p.createdAt }));
    return { ...u, userStores };
  };

  const prisma = {
    store: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { brandId?: string | { in: string[] }; userStores?: { some: { userId: string } } };
        }) =>
          stores
            .filter((s) => {
              if (typeof where.brandId === 'string' && s.brandId !== where.brandId) return false;
              if (typeof where.brandId === 'object' && !where.brandId.in.includes(s.brandId)) return false;
              const holder = where.userStores?.some.userId;
              if (holder && !pivot.some((p) => p.userId === holder && p.storeId === s.id)) return false;
              return true;
            })
            .map((s) => ({ id: s.id, name: s.name })),
      ),
    },
    user: {
      findMany: jest.fn(
        async ({
          where,
          select,
        }: {
          where: { role: { in: Role[] }; userStores: { some: StoreIdFilter } };
          select: { userStores: { where: StoreIdFilter } };
        }) => {
          const ids = where.userStores.some.storeId?.in ?? [];
          return users
            .filter(
              (u) => where.role.in.includes(u.role) && pivot.some((p) => p.userId === u.id && ids.includes(p.storeId)),
            )
            .map((u) => withStores(u, select));
        },
      ),
      findUnique: jest.fn(
        async ({
          where,
          select,
        }: {
          where: { id?: string; email?: string };
          select?: { userStores?: { where?: StoreIdFilter } };
        }) => {
          const found = users.find((u) => (where.id ? u.id === where.id : u.email === where.email));
          return found ? withStores(found, select) : null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Partial<FakeUser> & { email: string; role: Role } }) => {
        const created = user(`new-${users.length}`, data.role, { email: data.email, name: data.name ?? null });
        users.push(created);
        return { id: created.id };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const target = users.find((u) => u.id === where.id);
        if (target) Object.assign(target, data);
        return target;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; kdsPinStoreId: { in: string[] } };
          data: Partial<FakeUser>;
        }) => {
          const hits = users.filter(
            (u) => u.id === where.id && u.kdsPinStoreId !== null && where.kdsPinStoreId.in.includes(u.kdsPinStoreId),
          );
          hits.forEach((u) => Object.assign(u, data));
          return { count: hits.length };
        },
      ),
    },
    userStore: {
      deleteMany: jest.fn(async ({ where }: { where: { userId: string; storeId: { in: string[] } } }) => {
        const before = pivot.length;
        pivot = pivot.filter((p) => !(p.userId === where.userId && where.storeId.in.includes(p.storeId)));
        return { count: before - pivot.length };
      }),
      createMany: jest.fn(async ({ data }: { data: { userId: string; storeId: string }[] }) => {
        const fresh = data.filter((d) => !pivot.some((p) => p.userId === d.userId && p.storeId === d.storeId));
        pivot.push(...fresh.map((d) => ({ ...d, createdAt: new Date('2026-10-04T08:00:00Z') })));
        return { count: fresh.length };
      }),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const scope = {
    resolveBrandIds: jest.fn(async (caller: AuthenticatedUser) => {
      if (caller.role === Role.SUPER_ADMIN) return null;
      if (caller.role === Role.BRAND_ADMIN) return ['brand-1'];
      const own = pivot.filter((p) => p.userId === caller.id).map((p) => p.storeId);
      return [...new Set(stores.filter((s) => own.includes(s.id)).map((s) => s.brandId))];
    }),
  };
  const passwords = { hash: jest.fn(async () => 'bcrypt') };

  const svc = new AdminStaffMembersService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    scope as unknown as BrandScopeService,
  );
  const storesOf = (userId: string) =>
    pivot
      .filter((p) => p.userId === userId)
      .map((p) => p.storeId)
      .sort();
  return { svc, prisma, users, storesOf };
}

const owner = { id: 'owner', role: Role.BRAND_ADMIN } as AuthenticatedUser;
const superAdmin = { id: 'root', role: Role.SUPER_ADMIN } as AuthenticatedUser;
const managerCentre = { id: 'manager-centre', role: Role.STORE_MANAGER } as AuthenticatedUser;

function codeOf(error: unknown): unknown {
  return ((error as HttpException).getResponse() as { code?: string }).code;
}

describe('AdminStaffMembersService — staff as people', () => {
  describe('list', () => {
    it('lists each person of the brand once, with every store they work at', async () => {
      const { svc } = world();
      const team = await svc.list(owner, 'brand-1');
      expect(team.map((m) => m.userId).sort()).toEqual(['barista', 'cook', 'manager-centre', 'manager-station']);
      const barista = team.find((m) => m.userId === 'barista');
      expect(barista?.stores.map((s) => s.name)).toEqual(['Centre', 'Station']);
      expect(barista?.addedAt).toBe('2026-09-02T08:00:00.000Z');
      expect(barista).toMatchObject({ hasKdsPin: true, kdsPinStoreId: 'store-station', editable: true });
    });

    it('keeps other brands, customers and the owner out', async () => {
      const { svc } = world();
      const ids = (await svc.list(owner)).map((m) => m.userId);
      expect(ids).not.toContain('foreign-barista');
      expect(ids).not.toContain('customer');
      expect(ids).not.toContain('owner');
    });

    it("refuses another brand's id", async () => {
      const { svc } = world();
      await expect(svc.list(owner, 'brand-2')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("shows a store manager only their own stores' people, and only those stores", async () => {
      const { svc } = world();
      const team = await svc.list(managerCentre, 'brand-1');
      expect(team.map((m) => m.userId).sort()).toEqual(['barista', 'manager-centre']);
      const barista = team.find((m) => m.userId === 'barista');
      expect(barista?.stores.map((s) => s.id)).toEqual(['store-centre']);
      // The PIN opens Station, which this manager does not run.
      expect(barista).toMatchObject({ hasKdsPin: false, kdsPinStoreId: null });
      expect(team.find((m) => m.userId === 'manager-centre')?.editable).toBe(false);
    });

    it('does not count a placeholder hash left by a build without KDS_PIN_SECRET as a PIN', async () => {
      const { svc, users } = world();
      const barista = users.find((u) => u.id === 'barista');
      if (barista) barista.kdsPinHash = 'unset:c3RvcmU';
      const member = await svc.get('barista', owner, 'brand-1');
      expect(member.hasKdsPin).toBe(false);
    });

    it('lets a super admin pick any brand', async () => {
      const { svc } = world();
      expect((await svc.list(superAdmin, 'brand-2')).map((m) => m.userId)).toEqual(['foreign-barista']);
    });
  });

  describe('get', () => {
    it('answers 404 for someone outside the reach', async () => {
      const { svc } = world();
      await expect(svc.get('foreign-barista', owner, 'brand-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.get('cook', managerCentre)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.get('customer', owner)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setStores', () => {
    it('replaces the stores and clears a PIN bound to a store that was taken away', async () => {
      const { svc, storesOf, users } = world();
      const member = await svc.setStores('cook', ['store-centre'], owner, 'brand-1');
      expect(storesOf('cook')).toEqual(['store-centre']);
      expect(member.stores.map((s) => s.id)).toEqual(['store-centre']);

      const after = await svc.setStores('barista', ['store-centre'], owner, 'brand-1');
      expect(storesOf('barista')).toEqual(['store-centre']);
      expect(users.find((u) => u.id === 'barista')).toMatchObject({ kdsPinHash: null, kdsPinStoreId: null });
      expect(after.hasKdsPin).toBe(false);
    });

    it('keeps the PIN when its store stays', async () => {
      const { svc, users } = world();
      await svc.setStores('barista', ['store-station'], owner, 'brand-1');
      expect(users.find((u) => u.id === 'barista')?.kdsPinStoreId).toBe('store-station');
    });

    it('takes the person off the team when the last store goes', async () => {
      const { svc, storesOf } = world();
      const member = await svc.setStores('cook', [], owner, 'brand-1');
      expect(member.stores).toEqual([]);
      expect(storesOf('cook')).toEqual([]);
      await expect(svc.get('cook', owner, 'brand-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a store of another brand and changes nothing', async () => {
      const { svc, storesOf, prisma } = world();
      const error = await svc.setStores('cook', ['store-other'], owner, 'brand-1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(codeOf(error)).toBe('STAFF_STORE_OUT_OF_SCOPE');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(storesOf('cook')).toEqual(['store-station']);
    });

    it("lets a store manager assign only their own stores and leaves the person's other stores alone", async () => {
      const { svc, storesOf } = world();
      const error = await svc
        .setStores('barista', ['store-centre', 'store-station'], managerCentre)
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('STAFF_STORE_OUT_OF_SCOPE');

      // Unticking Centre removes the barista from this manager's café only.
      await svc.setStores('barista', [], managerCentre);
      expect(storesOf('barista')).toEqual(['store-station']);
    });

    it('keeps a store manager away from other managers and from their own access', async () => {
      const { svc, storesOf } = world();
      await svc.setStores('manager-station', ['store-station', 'store-centre'], owner, 'brand-1');
      const peer = await svc.setStores('manager-station', [], managerCentre).catch((e: unknown) => e);
      expect(codeOf(peer)).toBe('STAFF_NOT_EDITABLE');
      const self = await svc.setStores('manager-centre', [], managerCentre).catch((e: unknown) => e);
      expect(codeOf(self)).toBe('STAFF_NOT_EDITABLE');
      expect(storesOf('manager-centre')).toEqual(['store-centre']);
    });
  });

  describe('changeRole', () => {
    it('lets the owner change the role', async () => {
      const { svc } = world();
      const member = await svc.changeRole('cook', 'STORE_MANAGER', owner, 'brand-1');
      expect(member.role).toBe(Role.STORE_MANAGER);
    });

    it('does not let a store manager appoint a manager', async () => {
      const { svc, users } = world();
      const error = await svc.changeRole('barista', 'STORE_MANAGER', managerCentre).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(codeOf(error)).toBe('STAFF_ROLE_NOT_ALLOWED');
      expect(users.find((u) => u.id === 'barista')?.role).toBe(Role.STAFF);
    });

    it('lets a store manager move a barista to menu editing', async () => {
      const { svc } = world();
      const member = await svc.changeRole('barista', 'MENU_EDITOR', managerCentre);
      expect(member.role).toBe(Role.MENU_EDITOR);
    });
  });

  describe('invite', () => {
    const invite = (storeIds: string[], role: 'STAFF' | 'STORE_MANAGER' | 'MENU_EDITOR' = 'STAFF') => ({
      email: 'New.Person@noname.md',
      name: 'New',
      role,
      tempPassword: 'temporary-1',
      storeIds,
    });

    it('creates the account and assigns every chosen store', async () => {
      const { svc, storesOf, prisma } = world();
      const member = await svc.invite(invite(['store-centre', 'store-station']), owner, 'brand-1');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'new.person@noname.md' }) }),
      );
      expect(storesOf(member.userId)).toEqual(['store-centre', 'store-station']);
      expect(member.stores).toHaveLength(2);
    });

    it('refuses stores outside the reach before creating anyone', async () => {
      const { svc, prisma } = world();
      const error = await svc.invite(invite(['store-centre', 'store-other']), owner, 'brand-1').catch((e) => e);
      expect(codeOf(error)).toBe('STAFF_STORE_OUT_OF_SCOPE');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('does not let a store manager invite a manager or invite into a store they do not run', async () => {
      const { svc } = world();
      const role = await svc.invite(invite(['store-centre'], 'STORE_MANAGER'), managerCentre).catch((e) => e);
      expect(codeOf(role)).toBe('STAFF_ROLE_NOT_ALLOWED');
      const store = await svc.invite(invite(['store-station']), managerCentre).catch((e) => e);
      expect(codeOf(store)).toBe('STAFF_STORE_OUT_OF_SCOPE');
    });

    it('sends someone already on the team to their page instead', async () => {
      const { svc } = world();
      const error = await svc
        .invite({ ...invite(['store-centre']), email: 'cook@noname.md' }, owner, 'brand-1')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(codeOf(error)).toBe('STAFF_ALREADY_ON_TEAM');
    });

    it('refuses an email that belongs to a customer or an admin', async () => {
      const { svc } = world();
      const error = await svc
        .invite({ ...invite(['store-centre']), email: 'customer@noname.md' }, owner, 'brand-1')
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('STAFF_EMAIL_TAKEN');
    });

    it('adds staff of another brand without a new account', async () => {
      const { svc, storesOf, prisma } = world();
      const member = await svc.invite(
        { ...invite(['store-centre']), email: 'foreign-barista@noname.md' },
        owner,
        'brand-1',
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(member.userId).toBe('foreign-barista');
      expect(storesOf('foreign-barista')).toEqual(['store-centre', 'store-other']);
      expect(member.stores.map((s) => s.id)).toEqual(['store-centre']);
    });
  });
});
