import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Resolves the set of brands a given admin user is allowed to act on.
 *
 * - SUPER_ADMIN → `null` (no restriction).
 * - BRAND_ADMIN → the single brand they own (via `Brand.ownerId`).
 * - STORE_MANAGER / STAFF / RIDER → every brand that owns a store the
 *   user is assigned to (via the `UserStore` pivot).
 * - CUSTOMER / unauthenticated → denied upstream, but we return an empty
 *   array as a safe fallback.
 *
 * Write-path checks: {@link assertBrand} throws ForbiddenException when a
 * BRAND_ADMIN (or below) tries to act on a brand outside their set.
 * SUPER_ADMIN bypass is a `null` scope — the caller passes the check.
 */
@Injectable()
export class BrandScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the brand-id set the user can see. `null` = no filter (super-admin).
   */
  async resolveBrandIds(user: AuthenticatedUser): Promise<string[] | null> {
    if (user.role === Role.SUPER_ADMIN) return null;
    if (user.role === Role.BRAND_ADMIN) {
      const brands = await this.prisma.brand.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });
      return brands.map((b) => b.id);
    }
    // STORE_MANAGER / STAFF / RIDER scope via their assigned stores.
    const rows = await this.prisma.userStore.findMany({
      where: { userId: user.id },
      select: { store: { select: { brandId: true } } },
    });
    const unique = new Set(rows.map((r) => r.store.brandId));
    return [...unique];
  }

  /** Throws if the given brand is not in the caller's scope (SUPER_ADMIN bypass). */
  async assertBrand(user: AuthenticatedUser, brandId: string): Promise<void> {
    const scope = await this.resolveBrandIds(user);
    if (scope === null) return;
    if (!scope.includes(brandId)) {
      throw new ForbiddenException('Resource belongs to a brand outside your scope');
    }
  }

  /**
   * Returns a Prisma `where` filter fragment that restricts rows to the
   * caller's brand scope. Returns `undefined` for SUPER_ADMIN (no filter).
   */
  async brandWhere(user: AuthenticatedUser): Promise<{ brandId?: { in: string[] } } | undefined> {
    const scope = await this.resolveBrandIds(user);
    if (scope === null) return undefined;
    return { brandId: { in: scope } };
  }
}
