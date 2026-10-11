import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { StaffMember, StaffRoleName } from '@takeaway/shared-types';

import { BrandScopeService } from '../../auth/services/brand-scope.service';
import { PasswordService } from '../../auth/services/password.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { codedConflict } from '../../common/http/coded-conflict';
import { PrismaService } from '../../prisma/prisma.service';

const STAFF_ROLES: Role[] = [Role.STORE_MANAGER, Role.STAFF, Role.MENU_EDITOR];

/**
 * What a build without KDS_PIN_SECRET stores instead of a PIN hash. Such a
 * row opens nothing, so it is not shown as a PIN.
 */
const UNSET_PIN_PREFIX = 'unset:';

/** Stores the caller manages: id → name. */
type Reach = Map<string, string>;

const MEMBER_SELECT = {
  id: true,
  email: true,
  phone: true,
  name: true,
  role: true,
  blockedAt: true,
  createdAt: true,
  kdsPinHash: true,
  kdsPinStoreId: true,
} satisfies Prisma.UserSelect;

type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER_SELECT }> & {
  userStores: { storeId: string; createdAt: Date }[];
};

/**
 * Person-centric staff management: an employee is one account with one
 * role, and the stores they work at are a list on that person — the owner
 * opens someone and ticks their stores, instead of opening a store and
 * adding people to it. Same `UserStore` pivot as the store-centric
 * `/admin/stores/:storeId/staff` endpoints, which stay for older clients.
 *
 * Reach — the stores a caller may assign:
 *   - SUPER_ADMIN → every store (of `brandId` when given);
 *   - BRAND_ADMIN → the stores of the brands they own;
 *   - STORE_MANAGER → only the stores they are assigned to.
 *
 * Everything is read and written inside the reach: a person's stores
 * outside it are neither shown nor touched, so a manager re-saving a
 * barista's stores never drops the barista from another manager's café.
 * A store manager also cannot hand out the manager role or edit other
 * managers, and nobody edits their own access here.
 *
 * An account is global (one role, one password, one kitchen PIN), so its
 * role is changed, and stores are added to it, only when every store it
 * works at is within the caller's brands — see
 * {@link BrandScopeService.managesUser}. Taking it off the caller's own
 * stores stays possible.
 */
@Injectable()
export class AdminStaffMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly scope: BrandScopeService,
  ) {}

  async list(user: AuthenticatedUser, brandId?: string): Promise<StaffMember[]> {
    const reach = await this.reach(user, brandId);
    if (reach.size === 0) return [];
    const storeIds = [...reach.keys()];
    const rows = await this.prisma.user.findMany({
      where: { role: { in: STAFF_ROLES }, userStores: { some: { storeId: { in: storeIds } } } },
      select: {
        ...MEMBER_SELECT,
        userStores: { where: { storeId: { in: storeIds } }, select: { storeId: true, createdAt: true } },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });
    return rows.map((row) => this.toMember(row, reach, user));
  }

  async get(userId: string, user: AuthenticatedUser, brandId?: string): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    const row = await this.findOnTeam(userId, reach);
    return this.toMember(row, reach, user);
  }

  /**
   * Replaces the person's stores within the caller's reach. Taking away the
   * last one takes the person off the team. A kitchen PIN bound to a store
   * the person no longer works at is cleared — it would otherwise keep
   * opening that store's tablet.
   */
  async setStores(userId: string, storeIds: string[], user: AuthenticatedUser, brandId?: string): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    this.assertWithinReach(storeIds, reach);
    const row = await this.findOnTeam(userId, reach);
    this.assertEditable(row, user);

    const current = row.userStores.map((s) => s.storeId);
    const wanted = new Set(storeIds);
    const toRemove = current.filter((id) => !wanted.has(id));
    const toAdd = storeIds.filter((id) => !current.includes(id));
    if (toAdd.length > 0) await this.assertManaged(userId, user);

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (toRemove.length > 0) {
      ops.push(this.prisma.userStore.deleteMany({ where: { userId, storeId: { in: toRemove } } }));
      ops.push(
        this.prisma.user.updateMany({
          where: { id: userId, kdsPinStoreId: { in: toRemove } },
          data: { kdsPinHash: null, kdsPinStoreId: null },
        }),
      );
    }
    if (toAdd.length > 0) {
      ops.push(
        this.prisma.userStore.createMany({
          data: toAdd.map((storeId) => ({ userId, storeId })),
          skipDuplicates: true,
        }),
      );
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);

    return this.reload(userId, reach, user);
  }

  async changeRole(
    userId: string,
    role: StaffRoleName,
    user: AuthenticatedUser,
    brandId?: string,
  ): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    this.assertRoleAllowed(role, user);
    const row = await this.findOnTeam(userId, reach);
    this.assertEditable(row, user);
    await this.assertManaged(userId, user);
    if (row.role !== role) {
      await this.prisma.user.update({ where: { id: userId }, data: { role } });
    }
    return this.reload(userId, reach, user);
  }

  /**
   * Invites someone to one or more stores. A new email gets an account with
   * a temporary password to rotate on first sign-in; an existing staff
   * account of the caller's brands (e.g. from a store outside a manager's
   * reach) joins with the requested role. Someone already on the team is
   * changed on their own page instead. Any other existing account — a
   * customer, an admin, staff of another brand — gets the same neutral 409.
   */
  async invite(
    input: { email: string; name?: string; role: StaffRoleName; tempPassword: string; storeIds: string[] },
    user: AuthenticatedUser,
    brandId?: string,
  ): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    this.assertWithinReach(input.storeIds, reach);
    this.assertRoleAllowed(input.role, user);
    const email = input.email.toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, userStores: { select: { storeId: true } } },
    });

    let userId: string;
    if (!existing) {
      const passwordHash = await this.passwords.hash(input.tempPassword);
      const created = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          passwordMustChange: true,
          name: input.name ?? null,
          role: input.role,
        },
        select: { id: true },
      });
      userId = created.id;
    } else {
      if (!STAFF_ROLES.includes(existing.role)) throw emailInUse();
      if (existing.userStores.some((s) => reach.has(s.storeId))) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'STAFF_ALREADY_ON_TEAM',
          userId: existing.id,
          message: 'This person already works here — change their stores on their page',
        });
      }
      if (!(await this.scope.managesUser(user, existing.id))) throw emailInUse();
      if (existing.role !== input.role) {
        // A manager inviting someone who manages another café would demote them.
        if (user.role === Role.STORE_MANAGER && existing.role === Role.STORE_MANAGER) {
          throw this.forbidden('STAFF_ROLE_NOT_ALLOWED', 'A store manager cannot change the role of another manager');
        }
        await this.prisma.user.update({ where: { id: existing.id }, data: { role: input.role } });
      }
      userId = existing.id;
    }

    await this.prisma.userStore.createMany({
      data: input.storeIds.map((storeId) => ({ userId, storeId })),
      skipDuplicates: true,
    });
    return this.reload(userId, reach, user);
  }

  private async reach(user: AuthenticatedUser, brandId?: string): Promise<Reach> {
    const brandIds = await this.scope.resolveBrandIds(user);
    if (brandId && brandIds !== null && !brandIds.includes(brandId)) {
      throw new ForbiddenException('Brand is outside your scope');
    }
    const where: Prisma.StoreWhereInput = {};
    if (brandId) where.brandId = brandId;
    else if (brandIds !== null) where.brandId = { in: brandIds };
    if (user.role === Role.STORE_MANAGER) where.userStores = { some: { userId: user.id } };
    const stores = await this.prisma.store.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return new Map(stores.map((s) => [s.id, s.name]));
  }

  /** The person, with their stores inside the reach; 404 unless they work at one of them. */
  private async findOnTeam(userId: string, reach: Reach): Promise<MemberRow> {
    const row = await this.load(userId, reach);
    if (!row || !STAFF_ROLES.includes(row.role) || row.userStores.length === 0) {
      throw new NotFoundException('Staff member not found');
    }
    return row;
  }

  private async reload(userId: string, reach: Reach, user: AuthenticatedUser): Promise<StaffMember> {
    const row = await this.load(userId, reach);
    if (!row) throw new NotFoundException('Staff member not found');
    return this.toMember(row, reach, user);
  }

  private load(userId: string, reach: Reach): Promise<MemberRow | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...MEMBER_SELECT,
        userStores: { where: { storeId: { in: [...reach.keys()] } }, select: { storeId: true, createdAt: true } },
      },
    });
  }

  private assertWithinReach(storeIds: string[], reach: Reach): void {
    const outside = storeIds.filter((id) => !reach.has(id));
    if (outside.length > 0) {
      throw this.forbidden('STAFF_STORE_OUT_OF_SCOPE', 'One or more stores are outside your scope');
    }
  }

  private async assertManaged(userId: string, user: AuthenticatedUser): Promise<void> {
    if (!(await this.scope.managesUser(user, userId))) {
      throw this.forbidden('STAFF_NOT_EDITABLE', 'You cannot change this person’s access');
    }
  }

  private assertRoleAllowed(role: StaffRoleName, user: AuthenticatedUser): void {
    if (user.role === Role.STORE_MANAGER && role === Role.STORE_MANAGER) {
      throw this.forbidden('STAFF_ROLE_NOT_ALLOWED', 'A store manager cannot appoint managers');
    }
  }

  private assertEditable(row: MemberRow, user: AuthenticatedUser): void {
    if (!this.isEditable(row, user)) {
      throw this.forbidden('STAFF_NOT_EDITABLE', 'You cannot change this person’s access');
    }
  }

  private isEditable(row: { id: string; role: Role }, user: AuthenticatedUser): boolean {
    if (row.id === user.id) return false;
    return !(user.role === Role.STORE_MANAGER && row.role === Role.STORE_MANAGER);
  }

  private forbidden(code: string, message: string): ForbiddenException {
    return new ForbiddenException({ statusCode: 403, error: 'Forbidden', code, message });
  }

  private toMember(row: MemberRow, reach: Reach, user: AuthenticatedUser): StaffMember {
    const stores = row.userStores
      .map((s) => ({ id: s.storeId, name: reach.get(s.storeId) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const since = row.userStores.reduce<Date | null>(
      (earliest, s) => (earliest === null || s.createdAt < earliest ? s.createdAt : earliest),
      null,
    );
    const pinStoreId = row.kdsPinStoreId && stores.some((s) => s.id === row.kdsPinStoreId) ? row.kdsPinStoreId : null;
    const pinUsable = !!row.kdsPinHash && !row.kdsPinHash.startsWith(UNSET_PIN_PREFIX);
    return {
      userId: row.id,
      email: row.email,
      phone: row.phone,
      name: row.name,
      role: row.role as StaffRoleName,
      blocked: row.blockedAt !== null,
      addedAt: (since ?? row.createdAt).toISOString(),
      stores,
      kdsPinStoreId: pinStoreId,
      hasKdsPin: pinStoreId !== null && pinUsable,
      editable: this.isEditable(row, user),
    };
  }
}

/** Same answer whatever the existing account is: no role, no name. */
function emailInUse(): ConflictException {
  return codedConflict(
    'STAFF_EMAIL_TAKEN',
    'This email is already in use. Ask the employee to use a different email.',
    'email',
  );
}
