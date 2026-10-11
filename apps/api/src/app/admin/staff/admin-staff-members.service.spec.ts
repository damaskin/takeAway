import { ConflictException, ForbiddenException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { PasswordService } from '../../auth/services/password.service';
import type { TokensService } from '../../auth/services/tokens.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminStaffMembersService } from './admin-staff-members.service';
import type { StaffInviteMailer } from './staff-invite-mailer.service';

interface FakeUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: Role;
  passwordHash?: string;
  passwordMustChange?: boolean;
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
    passwordResetToken: {
      updateMany: jest.fn(async (_args: { where: { userId: string; consumedAt: null } }) => ({ count: 1 })),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const resolveBrandIds = async (caller: AuthenticatedUser): Promise<string[] | null> => {
    if (caller.role === Role.SUPER_ADMIN) return null;
    if (caller.role === Role.BRAND_ADMIN) return ['brand-1'];
    const own = pivot.filter((p) => p.userId === caller.id).map((p) => p.storeId);
    return [...new Set(stores.filter((s) => own.includes(s.id)).map((s) => s.brandId))];
  };
  const scope = {
    resolveBrandIds: jest.fn(resolveBrandIds),
    // Same rule as BrandScopeService.managesUser, over the in-memory pivot.
    managesUser: jest.fn(async (caller: AuthenticatedUser, userId: string) => {
      const brands = await resolveBrandIds(caller);
      if (brands === null) return true;
      return pivot
        .filter((p) => p.userId === userId)
        .every((p) => brands.includes(stores.find((s) => s.id === p.storeId)?.brandId ?? ''));
    }),
  };
  const passwords = { hash: jest.fn(async (plain: string) => `bcrypt(${plain})`) };
  const inviteMailer = {
    send: jest.fn(async () => 'SENT' as const),
    sendPasswordReset: jest.fn(async (): Promise<'SENT' | 'FAILED' | 'NOT_CONFIGURED'> => 'SENT'),
  };
  const tokens = { revokeAll: jest.fn(async () => 2) };

  const svc = new AdminStaffMembersService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    scope as unknown as BrandScopeService,
    inviteMailer as unknown as StaffInviteMailer,
    tokens as unknown as TokensService,
  );
  const storesOf = (userId: string) =>
    pivot
      .filter((p) => p.userId === userId)
      .map((p) => p.storeId)
      .sort();
  return { svc, prisma, users, storesOf, inviteMailer, tokens };
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

    it('emails a new account its invite and reports how that went', async () => {
      const { svc, inviteMailer } = world();
      inviteMailer.send.mockResolvedValueOnce('NOT_CONFIGURED' as never);
      const member = await svc.invite(invite(['store-centre']), owner, 'brand-1');
      expect(inviteMailer.send).toHaveBeenCalledWith({
        userId: member.userId,
        email: 'new.person@noname.md',
        name: 'New',
        role: 'STAFF',
        storeIds: ['store-centre'],
        newAccount: true,
      });
      expect(member.inviteEmail).toBe('NOT_CONFIGURED');
      expect(member.accountCreated).toBe(true);
    });

    it('does not email anyone when the invite is refused', async () => {
      const { svc, inviteMailer } = world();
      await svc.invite(invite(['store-centre', 'store-other']), owner, 'brand-1').catch(() => undefined);
      expect(inviteMailer.send).not.toHaveBeenCalled();
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

    it('refuses staff of another brand: no link, no role change, the same answer as for a customer', async () => {
      const { svc, storesOf, prisma, users } = world();
      const foreign = await svc
        .invite({ ...invite(['store-centre'], 'STORE_MANAGER'), email: 'foreign-barista@noname.md' }, owner, 'brand-1')
        .catch((e: unknown) => e);
      const customer = await svc
        .invite({ ...invite(['store-centre']), email: 'customer@noname.md' }, owner, 'brand-1')
        .catch((e: unknown) => e);

      expect(foreign).toBeInstanceOf(ConflictException);
      expect((foreign as HttpException).getResponse()).toEqual((customer as HttpException).getResponse());
      expect(JSON.stringify((foreign as HttpException).getResponse())).not.toMatch(/STAFF"|CUSTOMER|noname\.md/);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(storesOf('foreign-barista')).toEqual(['store-other']);
      expect(users.find((u) => u.id === 'foreign-barista')?.role).toBe(Role.STAFF);
    });

    it('lets a super admin still add staff of another brand', async () => {
      const { svc, storesOf } = world();
      await svc.invite({ ...invite(['store-centre']), email: 'foreign-barista@noname.md' }, superAdmin, 'brand-1');
      expect(storesOf('foreign-barista')).toEqual(['store-centre', 'store-other']);
    });
  });

  describe('someone who also works for another brand', () => {
    /** Links the other brand's barista to Centre, as a super admin could. */
    async function shared() {
      const w = world();
      const foreign = { email: 'foreign-barista@noname.md', role: 'STAFF' as const, tempPassword: 'temporary-1' };
      await w.svc.invite({ ...foreign, storeIds: ['store-centre'] }, superAdmin, 'brand-1');
      w.prisma.user.update.mockClear();
      return w;
    }

    it('keeps their role out of the brand’s hands', async () => {
      const { svc, prisma } = await shared();
      const error = await svc.changeRole('foreign-barista', 'MENU_EDITOR', owner, 'brand-1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(codeOf(error)).toBe('STAFF_NOT_EDITABLE');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('adds none of the brand’s stores to them, but lets the brand take them off its own', async () => {
      const { svc, storesOf } = await shared();
      const error = await svc
        .setStores('foreign-barista', ['store-centre', 'store-station'], owner, 'brand-1')
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('STAFF_NOT_EDITABLE');
      expect(storesOf('foreign-barista')).toEqual(['store-centre', 'store-other']);

      await svc.setStores('foreign-barista', [], owner, 'brand-1');
      expect(storesOf('foreign-barista')).toEqual(['store-other']);
    });

    it('lets a super admin change their role', async () => {
      const { svc } = await shared();
      const member = await svc.changeRole('foreign-barista', 'MENU_EDITOR', superAdmin, 'brand-1');
      expect(member.role).toBe(Role.MENU_EDITOR);
    });

    it('keeps their password out of the brand’s hands', async () => {
      const { svc, prisma, tokens, inviteMailer } = await shared();
      const error = await svc.resetPassword('foreign-barista', owner, 'brand-1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(codeOf(error)).toBe('STAFF_NOT_EDITABLE');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(tokens.revokeAll).not.toHaveBeenCalled();
      expect(inviteMailer.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    let logs: jest.SpyInstance;
    beforeEach(() => {
      logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });
    afterEach(() => logs.mockRestore());

    it('gives the owner a new temporary password once, ends every session and mails a link', async () => {
      const { svc, users, prisma, tokens, inviteMailer } = world();

      const result = await svc.resetPassword('barista', owner, 'brand-1');

      expect(result.resetEmail).toBe('SENT');
      expect(result.tempPassword).toHaveLength(12);
      expect(result.tempPassword).toMatch(/[a-z]/);
      expect(result.tempPassword).toMatch(/[A-Z]/);
      expect(result.tempPassword).toMatch(/[2-9]/);
      const barista = users.find((u) => u.id === 'barista');
      expect(barista).toMatchObject({ passwordHash: `bcrypt(${result.tempPassword})`, passwordMustChange: true });
      expect(tokens.revokeAll).toHaveBeenCalledWith('barista');
      // Links mailed before stop working; the new one is issued after that.
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'barista', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      expect(inviteMailer.sendPasswordReset).toHaveBeenCalledWith({
        userId: 'barista',
        email: 'barista@noname.md',
        name: 'barista',
        storeIds: ['store-centre', 'store-station'],
      });
    });

    it('logs who reset whose password, and never the password itself', async () => {
      const { svc } = world();
      const { tempPassword } = await svc.resetPassword('cook', owner, 'brand-1');
      const lines = logs.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain('Staff password reset: user cook by owner (BRAND_ADMIN); sessions ended: 2; email: SENT');
      expect(lines.join(' ')).not.toContain(tempPassword);
    });

    it('still hands the password over when the email cannot go out', async () => {
      const { svc, inviteMailer } = world();
      inviteMailer.sendPasswordReset.mockResolvedValueOnce('NOT_CONFIGURED');
      await expect(svc.resetPassword('cook', owner, 'brand-1')).resolves.toMatchObject({
        resetEmail: 'NOT_CONFIGURED',
      });

      inviteMailer.sendPasswordReset.mockRejectedValueOnce(new Error('db down'));
      const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const failed = await svc.resetPassword('cook', owner, 'brand-1');
      errors.mockRestore();
      expect(failed.resetEmail).toBe('FAILED');
      expect(failed.tempPassword).toHaveLength(12);
    });

    it('changes nothing when the sessions cannot be ended', async () => {
      const { svc, prisma, tokens } = world();
      tokens.revokeAll.mockRejectedValueOnce(new Error('redis down'));
      await expect(svc.resetPassword('cook', owner, 'brand-1')).rejects.toThrow('redis down');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('is for the owner and the platform admin, not a store manager', async () => {
      const { svc, tokens } = world();
      const error = await svc.resetPassword('barista', managerCentre).catch((e: unknown) => e);
      expect(codeOf(error)).toBe('STAFF_NOT_EDITABLE');
      expect(tokens.revokeAll).not.toHaveBeenCalled();

      await expect(svc.resetPassword('barista', superAdmin, 'brand-1')).resolves.toMatchObject({ resetEmail: 'SENT' });
    });

    it('reaches only the brand’s own team', async () => {
      const { svc, tokens } = world();
      await expect(svc.resetPassword('foreign-barista', owner, 'brand-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.resetPassword('customer', owner, 'brand-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(tokens.revokeAll).not.toHaveBeenCalled();
    });
  });
});
