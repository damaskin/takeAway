import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { LegacyOptionsSummary } from '@takeaway/shared-types';

import { PrismaService } from '../../prisma/prisma.service';
import { dropCartLines, modifierCount } from '../catalog/admin-catalog.service';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * A brand's older per-product options — `Variation`, `Modifier`, the
 * category option sets and the add-ons library with its store stops — and
 * the one action that clears them so the brand moves to the catalog
 * (Maxim's answer 9: delete, then attach catalog groups anew; nothing is
 * migrated). SUPER_ADMIN only; on prod only with the owner's OK.
 *
 * Placed orders keep their snapshots. Cart lines made with older options
 * are dropped and their carts re-totalled, as when an add-on is deleted.
 */
@Injectable()
export class AdminLegacyOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(brandId: string): Promise<LegacyOptionsSummary> {
    await this.assertBrand(brandId);
    return count(this.prisma, brandId);
  }

  /** Deletes everything {@link summary} counts, in one transaction; answers what was deleted. */
  async clear(brandId: string): Promise<LegacyOptionsSummary> {
    await this.assertBrand(brandId);
    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.count({
        where: { brandId, OR: [{ variations: { some: {} } }, { modifiers: { some: {} } }] },
      });

      const lines = await tx.cartItem.findMany({
        where: { product: { brandId } },
        select: { id: true, cartId: true, variationIds: true, modifiersJson: true },
      });
      await dropCartLines(
        tx,
        lines.filter((line) => line.variationIds.length > 0 || hasModifiers(line.modifiersJson)),
      );

      const categoryOptions = await tx.categoryOption.deleteMany({ where: { category: { brandId } } });
      const modifiers = await tx.modifier.deleteMany({ where: { product: { brandId } } });
      const variations = await tx.variation.deleteMany({ where: { product: { brandId } } });
      await tx.storeIngredientStop.deleteMany({ where: { ingredient: { brandId } } });
      const ingredients = await tx.ingredient.deleteMany({ where: { brandId } });

      return {
        products,
        variations: variations.count,
        modifiers: modifiers.count,
        categoryOptions: categoryOptions.count,
        ingredients: ingredients.count,
      };
    });
  }

  private async assertBrand(brandId: string): Promise<void> {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) throw new NotFoundException('Brand not found');
  }
}

async function count(db: Db, brandId: string): Promise<LegacyOptionsSummary> {
  const [products, variations, modifiers, categoryOptions, ingredients] = await Promise.all([
    db.product.count({ where: { brandId, OR: [{ variations: { some: {} } }, { modifiers: { some: {} } }] } }),
    db.variation.count({ where: { product: { brandId } } }),
    db.modifier.count({ where: { product: { brandId } } }),
    db.categoryOption.count({ where: { category: { brandId } } }),
    db.ingredient.count({ where: { brandId } }),
  ]);
  return { products, variations, modifiers, categoryOptions, ingredients };
}

/** Whether a cart row's `{ modifierId: count }` takes any extra. */
function hasModifiers(json: Prisma.JsonValue): boolean {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  return Object.keys(json).some((id) => modifierCount(json, id) > 0);
}
