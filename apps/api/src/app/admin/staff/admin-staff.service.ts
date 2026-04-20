import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { PasswordService } from '../../auth/services/password.service';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

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
 */
@Injectable()
export class AdminStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly scope: BrandScopeService,
  ) {}

  async list(storeId: string, user: AuthenticatedUser) {
    await this.assertStore(storeId, user);
    const rows = await this.prisma.userStore.findMany({
      where: {
        storeId,
        user: { role: { in: [Role.STORE_MANAGER, Role.STAFF] } },
      },
      include: { user: { select: { id: true, email: true, name: true, role: true, blockedAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      userId: r.user.id,
      email: r.user.email,
      name: r.user.name,
      role: r.user.role,
      blocked: r.user.blockedAt !== null,
      addedAt: r.createdAt.toISOString(),
    }));
  }

  async add(
    storeId: string,
    input: { email: string; name?: string; role: Role; tempPassword: string },
    user: AuthenticatedUser,
  ) {
    await this.assertStore(storeId, user);
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
    } else if (existing.role === Role.STORE_MANAGER || existing.role === Role.STAFF) {
      userId = existing.id;
      if (existing.role !== input.role) {
        await this.prisma.user.update({ where: { id: userId }, data: { role: input.role } });
      }
    } else {
      throw new ConflictException(
        `User ${email} already has role ${existing.role}; change their role first or pick a different email`,
      );
    }

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

  async remove(storeId: string, userId: string, user: AuthenticatedUser): Promise<void> {
    await this.assertStore(storeId, user);
    const deleted = await this.prisma.userStore.deleteMany({
      where: { storeId, userId, user: { role: { in: [Role.STORE_MANAGER, Role.STAFF] } } },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Staff is not rostered for this store');
    }
  }

  private async assertStore(storeId: string, user: AuthenticatedUser): Promise<void> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, brandId: true } });
    if (!store) throw new NotFoundException('Store not found');
    const scope = await this.scope.resolveBrandIds(user);
    if (scope !== null && !scope.includes(store.brandId)) {
      throw new ForbiddenException('Store belongs to a brand outside your scope');
    }
  }
}
