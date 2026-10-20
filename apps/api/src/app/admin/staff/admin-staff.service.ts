import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { KitchenPinsService } from '../../auth/services/kitchen-pins.service';
import { PasswordService } from '../../auth/services/password.service';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { codedConflict } from '../../common/http/coded-conflict';
import { PrismaService } from '../../prisma/prisma.service';
import { createLoginAccount } from './staff-login';

/**
 * Staff roster for a store — the UserStore pivot filtered to users with
 * `role ∈ {STORE_MANAGER, STAFF}`. Add-flow creates the user with an
 * email+password so they can immediately sign in to admin/KDS; the
 * BRAND_ADMIN hands them a temp password and the user changes it via
 * /forgot-password.
 *
 * Role transitions on add:
 *   - No user with this email         → create with the requested role.
 *   - Existing same role              → idempotent (re-use the row).
 *   - Existing other staff role       → allow rebind (MANAGER ↔ STAFF).
 *   - Existing CUSTOMER / RIDER       → refuse (different scope model).
 *   - Existing BRAND_ADMIN/SUPER_ADMIN → refuse (never demote admins here).
 *   - Existing staff of another brand  → refuse (staff accounts are global).
 * Every refusal is the same neutral 409, without the account's role.
 *
 * With a login instead of an email it is always a new account, and a taken
 * login is 409 LOGIN_IN_USE whoever holds it (see {@link createLoginAccount}).
 *
 * Role changes and kitchen PINs need the whole account to be the caller's:
 * see {@link BrandScopeService.managesUser}.
 */
@Injectable()
export class AdminStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly kitchenPins: KitchenPinsService,
    private readonly scope: BrandScopeService,
  ) {}

  async list(storeId: string, user: AuthenticatedUser) {
    const store = await this.assertStore(storeId, user);
    const rows = await this.prisma.userStore.findMany({
      where: {
        storeId,
        user: { role: { in: [Role.STORE_MANAGER, Role.STAFF, Role.MENU_EDITOR] } },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            login: true,
            name: true,
            role: true,
            blockedAt: true,
            kdsPinHash: true,
            kdsPinStoreId: true,
            kdsPinBrandId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      userId: r.user.id,
      email: r.user.email,
      login: r.user.login,
      name: r.user.name,
      role: r.user.role,
      blocked: r.user.blockedAt !== null,
      addedAt: r.createdAt.toISOString(),
      // The person's PIN opens every store of its brand they work at; an
      // old PIN opens its one store. The hash itself never leaves the API,
      // and a placeholder left by a build without KDS_PIN_SECRET is no PIN.
      hasKdsPin: this.kitchenPins.opensStore(r.user, store, true),
    }));
  }

  async add(
    storeId: string,
    input: { email?: string; login?: string; name?: string; role: Role; tempPassword: string },
    user: AuthenticatedUser,
  ) {
    await this.assertStore(storeId, user);
    if (input.login !== undefined) {
      if (input.email !== undefined) throw new BadRequestException('Send either email or login');
      const created = await createLoginAccount(this.prisma, {
        login: input.login.trim().toLowerCase(),
        passwordHash: await this.passwords.hash(input.tempPassword),
        name: input.name ?? null,
        role: input.role,
      });
      return this.roster(storeId, created.id, user);
    }
    if (input.email === undefined) throw new BadRequestException('Send either email or login');
    const email = input.email.toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, name: true, email: true },
    });

    let userId: string;
    if (!existing) {
      const passwordHash = await this.passwords.hash(input.tempPassword);
      const created = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          // Force rotation on first login — invited staff shouldn't keep
          // the temp password the BRAND_ADMIN typed in.
          passwordMustChange: true,
          name: input.name ?? null,
          role: input.role,
        },
        select: { id: true },
      });
      userId = created.id;
    } else if (
      existing.role === Role.STORE_MANAGER ||
      existing.role === Role.STAFF ||
      existing.role === Role.MENU_EDITOR
    ) {
      if (!(await this.scope.managesUser(user, existing.id))) throw emailInUse();
      userId = existing.id;
      if (existing.role !== input.role) {
        await this.prisma.user.update({ where: { id: userId }, data: { role: input.role } });
      }
    } else {
      throw emailInUse();
    }
    return this.roster(storeId, userId, user);
  }

  /** Puts the person on the store's roster and answers their row of it. */
  private async roster(storeId: string, userId: string, user: AuthenticatedUser) {
    try {
      await this.prisma.userStore.create({ data: { userId, storeId } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Staff member is already rostered for this store');
      }
      throw err;
    }

    const entry = (await this.list(storeId, user)).find((r) => r.userId === userId);
    if (!entry) throw new NotFoundException('Staff was added but could not be loaded back');
    return entry;
  }

  async changeRole(storeId: string, userId: string, role: Role, user: AuthenticatedUser) {
    await this.assertStore(storeId, user);
    const pivot = await this.prisma.userStore.findUnique({
      where: { userId_storeId: { userId, storeId } },
      include: { user: { select: { role: true } } },
    });
    if (!pivot) throw new NotFoundException('Staff is not rostered for this store');
    const staffRoles: Role[] = [Role.STORE_MANAGER, Role.STAFF, Role.MENU_EDITOR];
    if (!staffRoles.includes(pivot.user.role)) {
      throw new ForbiddenException('Cannot change role of a non-staff user here');
    }
    await this.assertManaged(userId, user);
    await this.prisma.user.update({ where: { id: userId }, data: { role } });
    const entry = (await this.list(storeId, user)).find((r) => r.userId === userId);
    if (!entry) throw new NotFoundException('Staff was updated but could not be reloaded');
    return entry;
  }

  /**
   * Sets (or rotates) the person's kitchen PIN from one of their stores —
   * the endpoint of builds before 2026-10-20. The PIN is the person's one
   * PIN for every store of the brand, the same as `PUT
   * /admin/staff/:userId/kds-pin`; the store only says where the caller
   * opened it. A PIN already used at the brand is 409 `KDS_PIN_TAKEN`.
   */
  async setKdsPin(storeId: string, userId: string, pin: string, user: AuthenticatedUser): Promise<void> {
    const store = await this.assertStore(storeId, user);
    const rostered = await this.prisma.userStore.findUnique({
      where: { userId_storeId: { userId, storeId } },
    });
    if (!rostered) throw new NotFoundException('Staff is not rostered for this store');
    // A PIN signs in as the account: never for one that also works elsewhere.
    await this.assertManaged(userId, user);

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || (target.role !== Role.STORE_MANAGER && target.role !== Role.STAFF)) {
      throw new NotFoundException('User is not eligible for a KDS PIN');
    }
    // A PIN belongs to one brand: 409 KDS_PIN_MULTI_BRAND for someone who
    // also works for another one (only a platform admin gets this far).
    await this.kitchenPins.brandOf(userId);
    await this.kitchenPins.assign(userId, store.brandId, pin);
  }

  /** Resets the person's PIN when it opens this store's tablet. */
  async clearKdsPin(storeId: string, userId: string, user: AuthenticatedUser): Promise<void> {
    const store = await this.assertStore(storeId, user);
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kdsPinHash: true, kdsPinBrandId: true, kdsPinStoreId: true },
    });
    const rostered = await this.prisma.userStore.findUnique({
      where: { userId_storeId: { userId, storeId } },
      select: { storeId: true },
    });
    if (target && this.kitchenPins.opensStore(target, store, !!rostered)) await this.kitchenPins.clear(userId);
  }

  async remove(storeId: string, userId: string, user: AuthenticatedUser): Promise<void> {
    await this.assertStore(storeId, user);
    const deleted = await this.prisma.userStore.deleteMany({
      where: { storeId, userId, user: { role: { in: [Role.STORE_MANAGER, Role.STAFF, Role.MENU_EDITOR] } } },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Staff is not rostered for this store');
    }
  }

  private async assertManaged(userId: string, user: AuthenticatedUser): Promise<void> {
    if (!(await this.scope.managesUser(user, userId))) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'STAFF_NOT_EDITABLE',
        message: 'You cannot change this person’s access',
      });
    }
  }

  private async assertStore(storeId: string, user: AuthenticatedUser): Promise<{ id: string; brandId: string }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, brandId: true } });
    if (!store) throw new NotFoundException('Store not found');
    const scope = await this.scope.resolveBrandIds(user);
    if (scope !== null && !scope.includes(store.brandId)) {
      throw new ForbiddenException('Store belongs to a brand outside your scope');
    }
    // The brand scope alone let the manager of one café hire staff and set
    // kitchen PINs at every other café of the brand.
    if (user.role === Role.STORE_MANAGER) {
      const assigned = await this.prisma.userStore.findUnique({
        where: { userId_storeId: { userId: user.id, storeId } },
        select: { storeId: true },
      });
      if (!assigned) throw new ForbiddenException('Store is outside your scope');
    }
    return store;
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
