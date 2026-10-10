import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { codedConflict } from '../../common/http/coded-conflict';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * CRUD for the rider roster — the UserStore pivot filtered to users with
 * `role = RIDER`. Used by admin to rostera couriers per store without SQL.
 *
 * Role transitions on add:
 *   - No user with this phone               → create one with role=RIDER
 *   - Existing RIDER of the caller's brands → leave role alone
 *   - Any other existing account            → refuse with the same neutral 409
 *     (RIDER_PHONE_TAKEN): a customer is never turned into a rider behind
 *     their back, a courier of another brand is not taken over, and the
 *     answer names neither the account's role nor its name.
 *
 * Removing the pivot doesn't revoke the RIDER role — a rider can be
 * rostered at multiple stores and removed from just one.
 */
@Injectable()
export class AdminRidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BrandScopeService,
  ) {}

  async list(storeId: string) {
    await this.assertStore(storeId);
    const rows = await this.prisma.userStore.findMany({
      where: { storeId, user: { role: Role.RIDER } },
      include: { user: { select: { id: true, phone: true, name: true, blockedAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      userId: r.user.id,
      phone: r.user.phone,
      name: r.user.name,
      blocked: r.user.blockedAt !== null,
      addedAt: r.createdAt.toISOString(),
    }));
  }

  async add(storeId: string, phone: string, name: string | undefined, user: AuthenticatedUser) {
    await this.assertStore(storeId);

    const existing = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, role: true },
    });

    let userId: string;
    if (!existing) {
      const created = await this.prisma.user.create({
        data: { phone, role: Role.RIDER, name: name ?? null },
        select: { id: true },
      });
      userId = created.id;
    } else if (existing.role === Role.RIDER && (await this.scope.managesUser(user, existing.id))) {
      userId = existing.id;
    } else {
      throw codedConflict(
        'RIDER_PHONE_TAKEN',
        'This phone number is already in use. Ask the courier to use a different number.',
        'phone',
      );
    }

    try {
      await this.prisma.userStore.create({ data: { userId, storeId } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Rider is already rostered for this store');
      }
      throw err;
    }

    const entry = (await this.list(storeId)).find((r) => r.userId === userId);
    if (!entry) throw new NotFoundException('Rider was added but could not be loaded back');
    return entry;
  }

  async remove(storeId: string, userId: string): Promise<void> {
    await this.assertStore(storeId);
    const deleted = await this.prisma.userStore.deleteMany({
      where: { storeId, userId, user: { role: Role.RIDER } },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Rider is not rostered for this store');
    }
  }

  private async assertStore(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) throw new NotFoundException('Store not found');
  }
}
