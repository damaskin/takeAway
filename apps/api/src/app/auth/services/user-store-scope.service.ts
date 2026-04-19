import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export type StoreScope = '*' | readonly string[];

/**
 * Resolves the set of stores a user can act on. Used by controllers that
 * expose per-store data (admin orders feed, KDS board, delivery queue) so
 * a STORE_MANAGER / STAFF / RIDER only sees their assigned stores — while
 * BRAND_ADMIN and SUPER_ADMIN pass through as "all stores".
 *
 * Returns:
 *  - `'*'` for global roles — caller should apply no store filter.
 *  - `string[]` (possibly empty) for scoped roles — caller should filter.
 *    An empty array means the staff user has no store assignments yet and
 *    should see nothing, not "everything".
 */
@Injectable()
export class UserStoreScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async getScope(userId: string, role: Role): Promise<StoreScope> {
    if (role === Role.BRAND_ADMIN || role === Role.SUPER_ADMIN) return '*';
    if (role === Role.CUSTOMER) return [];
    const rows = await this.prisma.userStore.findMany({
      where: { userId },
      select: { storeId: true },
    });
    return rows.map((r) => r.storeId);
  }

  /**
   * Narrow a caller-supplied `storeId` to the user's allowed set. Throws if
   * the user explicitly asked for a store outside their scope; returns
   * undefined if the caller didn't specify a storeId (callers can then fall
   * back to scope-wide listing).
   */
  async assertAllowed(userId: string, role: Role, requestedStoreId?: string | null): Promise<string | undefined> {
    const scope = await this.getScope(userId, role);
    if (!requestedStoreId) return undefined;
    if (scope === '*') return requestedStoreId;
    if (scope.includes(requestedStoreId)) return requestedStoreId;
    // Deliberately throw instead of silently narrowing — a mismatched
    // storeId probably means a stale UI cache or a manual URL tweak; we'd
    // rather tell the client than silently return empty.
    const err = new Error('Store is outside your scope');
    (err as Error & { status: number }).status = 403;
    throw err;
  }

  /** Build a Prisma where-clause fragment for a `storeId` column. */
  buildStoreFilter(scope: StoreScope): { storeId?: { in: string[] } } | Record<string, never> {
    if (scope === '*') return {};
    return { storeId: { in: [...scope] } };
  }
}
