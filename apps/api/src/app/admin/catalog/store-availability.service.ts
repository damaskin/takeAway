import { Injectable, NotFoundException } from '@nestjs/common';

import { activeStopWhere } from '../../catalog/option-availability';
import { PrismaService } from '../../prisma/prisma.service';
import { assertInScope, type BrandScope } from './admin-catalog.service';
import type { SetIngredientStopDto, StoreAvailabilityDto } from './dto/admin-store-availability.dto';

/**
 * The stop-list of one store: which of the products it sells are off sale
 * there, and which add-ins (ingredients of the brand library) it has run out
 * of. Kitchen staff work this screen, so it only ever toggles — creating,
 * editing and deleting products or ingredients stays with the menu roles.
 */
@Injectable()
export class StoreAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async get(storeId: string, scope: BrandScope): Promise<StoreAvailabilityDto> {
    const store = await this.findStore(storeId, scope);
    const now = new Date();
    const soldHere = { stores: { some: { storeId } } };

    const [products, ingredients] = await Promise.all([
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
      // Only the add-ins this store actually uses: an ingredient of a product
      // sold elsewhere is no business of this kitchen.
      this.prisma.ingredient.findMany({
        where: {
          brandId: store.brandId,
          OR: [{ modifiers: { some: { product: soldHere } } }, { variations: { some: { product: soldHere } } }],
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isAvailable: true,
          storeStops: { where: { storeId, ...activeStopWhere(now) }, select: { expiresAt: true } },
          modifiers: { where: { product: soldHere }, select: { product: { select: { name: true } } } },
          variations: { where: { product: soldHere }, select: { product: { select: { name: true } } } },
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
      ingredients: ingredients.map((i) => ({
        id: i.id,
        name: i.name,
        isAvailable: i.isAvailable,
        stop: toStop(i.storeStops[0]),
        productNames: [...new Set([...i.modifiers, ...i.variations].map((o) => o.product.name))].sort((a, b) =>
          a.localeCompare(b),
        ),
      })),
    };
  }

  /** The store has run out of this add-in; other stores of the brand keep selling it. */
  async stopIngredient(storeId: string, ingredientId: string, dto: SetIngredientStopDto, scope: BrandScope) {
    const store = await this.findStore(storeId, scope);
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: ingredientId },
      select: { brandId: true },
    });
    if (!ingredient || ingredient.brandId !== store.brandId) throw new NotFoundException('Ingredient not found');
    const expiresAt = dto.expiresAt ?? null;
    const row = await this.prisma.storeIngredientStop.upsert({
      where: { storeId_ingredientId: { storeId, ingredientId } },
      create: { storeId, ingredientId, expiresAt },
      update: { expiresAt, createdAt: new Date() },
    });
    return { storeId: row.storeId, ingredientId: row.ingredientId, expiresAt: row.expiresAt };
  }

  /** Back in stock here. Idempotent: lifting a stop nobody set is not an error. */
  async resumeIngredient(storeId: string, ingredientId: string, scope: BrandScope): Promise<void> {
    await this.findStore(storeId, scope);
    await this.prisma.storeIngredientStop.deleteMany({ where: { storeId, ingredientId } });
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
