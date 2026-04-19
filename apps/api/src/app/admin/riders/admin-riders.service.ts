import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * CRUD for the rider roster — the UserStore pivot filtered to users with
 * `role = RIDER`. Used by admin to rostera couriers per store without SQL.
 *
 * Role transitions on add:
 *   - No user with this phone   → create one with role=RIDER
 *   - Existing CUSTOMER          → promote to RIDER (safe: no scope to lose)
 *   - Existing RIDER             → leave role alone
 *   - Existing STAFF/MANAGER/…   → refuse (downgrade would strip other scope)
 *
 * Removing the pivot doesn't revoke the RIDER role — a rider can be
 * rostered at multiple stores and removed from just one.
 */
@Injectable()
export class AdminRidersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async add(storeId: string, phone: string, name?: string) {
    await this.assertStore(storeId);

    const existing = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, role: true, name: true },
    });

    let userId: string;
    if (!existing) {
      const created = await this.prisma.user.create({
        data: { phone, role: Role.RIDER, name: name ?? null },
        select: { id: true },
      });
      userId = created.id;
    } else if (existing.role === Role.RIDER) {
      userId = existing.id;
    } else if (existing.role === Role.CUSTOMER) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          role: Role.RIDER,
          ...(name && !existing.name ? { name } : {}),
        },
      });
      userId = existing.id;
    } else {
      throw new ConflictException(
        `User ${phone} already has role ${existing.role}; change their role before adding as rider`,
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
