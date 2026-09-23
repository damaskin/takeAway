import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export type StoreScope = '*' | readonly string[];

/**
 * Resolves the set of stores a user can act on. Used by controllers that
 * expose per-store data (admin orders feed, KDS board, delivery queue,
 * riders, store settings) so each account reaches only its own stores:
 *
 *  - SUPER_ADMIN → `'*'`, no store filter.
 *  - BRAND_ADMIN → every store of the brands it owns. It used to be `'*'`
 *    too; since anyone can register a business, that handed every new
 *    account the kitchen screens, orders and riders of all other brands.
 *  - STORE_MANAGER / STAFF / RIDER → the stores they are assigned to.
 *
 * An empty array means "nothing" — a brand with no stores yet, or staff with
 * no assignment — never "everything".
 */
@Injectable()
export class UserStoreScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async getScope(userId: string, role: Role): Promise<StoreScope> {
    if (role === Role.SUPER_ADMIN) return '*';
    if (role === Role.CUSTOMER) return [];
    if (role === Role.BRAND_ADMIN) {
      const stores = await this.prisma.store.findMany({
        where: { brand: { ownerId: userId } },
        select: { id: true },
      });
      return stores.map((s) => s.id);
    }
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
    throw new ForbiddenException('Store is outside your scope');
  }

  /** Build a Prisma where-clause fragment for a `storeId` column. */
  buildStoreFilter(scope: StoreScope): { storeId?: { in: string[] } } | Record<string, never> {
    if (scope === '*') return {};
    return { storeId: { in: [...scope] } };
  }
}
