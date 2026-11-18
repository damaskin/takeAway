import { Injectable, NotFoundException } from '@nestjs/common';

import { activeStopWhere } from '../../catalog/option-availability';
import { PrismaService } from '../../prisma/prisma.service';
import { assertInScope, type BrandScope } from './admin-catalog.service';
import type { StoreAvailabilityDto } from './dto/admin-store-availability.dto';

/**
 * The stop-list of one store: which of the products it sells are off sale
 * there, and which catalog options it has run out of. Kitchen staff work
 * this screen, so it only ever toggles — creating, editing and deleting
 * products or options stays with the menu roles and the platform team.
 */
@Injectable()
export class StoreAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async get(storeId: string, scope: BrandScope): Promise<StoreAvailabilityDto> {
    const store = await this.findStore(storeId, scope);
    const now = new Date();
    const soldHere = { stores: { some: { storeId } } };

    const [products, options] = await Promise.all([
      this.prisma.product.findMany({
        where: { brandId: store.brandId, visible: true, ...soldHere },
        orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          categoryId: true,
          imageUrls: true,
          category: { select: { name: true } },
          stopListEntries: { where: { storeId, ...activeStopWhere(now) }, select: { expiresAt: true } },
        },
      }),
      // Options of the catalog groups the products sold here have, without
      // those the brand switched off (docs/option-groups.md).
      this.prisma.optionItem.findMany({
        where: {
          group: { products: { some: { product: soldHere } } },
          brandSettings: { none: { brandId: store.brandId, enabled: false } },
        },
        orderBy: [{ group: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          note: true,
          group: {
            select: {
              id: true,
              name: true,
              products: { where: { product: soldHere }, select: { product: { select: { name: true } } } },
            },
          },
          storeStops: { where: { storeId, ...activeStopWhere(now) }, select: { expiresAt: true } },
        },
      }),
    ]);

    return {
      storeId: store.id,
      storeName: store.name,
      timezone: store.timezone,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        categoryId: p.categoryId,
        categoryName: p.category.name,
        imageUrl: p.imageUrls[0] ?? null,
        stop: toStop(p.stopListEntries[0]),
      })),
      options: options.map((o) => ({
        id: o.id,
        name: o.name,
        note: o.note,
        groupId: o.group.id,
        groupName: o.group.name,
        stop: toStop(o.storeStops[0]),
        productNames: [...new Set(o.group.products.map((p) => p.product.name))].sort((a, b) => a.localeCompare(b)),
      })),
    };
  }

  private async findStore(storeId: string, scope: BrandScope) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, brandId: true, timezone: true },
    });
    if (!store) throw new NotFoundException('Store not found');
    assertInScope(scope, store.brandId);
    return store;
  }
}

function toStop(row: { expiresAt: Date | null } | undefined): { expiresAt: string | null } | null {
  if (!row) return null;
  return { expiresAt: row.expiresAt?.toISOString() ?? null };
}
