import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { assertInScope, type BrandScope, dropCartLines, modifierCount } from './admin-catalog.service';
import { menuConflict, prismaCode } from './admin-menu.errors';
import type { CreateIngredientDto, IngredientAdminDto, UpdateIngredientDto } from './dto/admin-ingredient.dto';

const WITH_USAGE = {
  modifiers: { select: { product: { select: { id: true, name: true } } } },
  variations: { select: { product: { select: { id: true, name: true } } } },
} satisfies Prisma.IngredientInclude;

type IngredientWithUsage = Prisma.IngredientGetPayload<{ include: typeof WITH_USAGE }>;

/**
 * The brand's add-ons library («Добавки») — the one place an add-on is
 * defined: name, usual price, in stock or not. Products offer an add-on
 * through an option pointing here (an extra, or a milk). Switching one off
 * hides every option that uses it from customers (see `AVAILABLE_OPTION`)
 * and leaves the products on the menu; switching it on brings the options
 * back as they were.
 *
 * Taking an add-on off one product deletes that product's option and keeps
 * the entry; deleting the entry here takes it off every product.
 */
@Injectable()
export class AdminIngredientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: BrandScope, brandId: string): Promise<IngredientAdminDto[]> {
    assertInScope(scope, brandId);
    const rows = await this.prisma.ingredient.findMany({
      where: { brandId },
      orderBy: { name: 'asc' },
      include: WITH_USAGE,
    });
    return rows.map(toDto);
  }

  async create(dto: CreateIngredientDto, scope: BrandScope): Promise<IngredientAdminDto> {
    assertInScope(scope, dto.brandId);
    const row = await this.prisma.ingredient
      .create({
        data: {
          brandId: dto.brandId,
          name: dto.name,
          priceCents: dto.priceCents ?? 0,
          isAvailable: dto.isAvailable ?? true,
        },
        include: WITH_USAGE,
      })
      .catch((err: unknown) => rethrowNameTaken(err, dto.name));
    return toDto(row);
  }

  /**
   * The entry and the options made of it stay in step: a new name or price
   * reaches every option that still carries the old one. An option given a
   * name or price of its own on one product («Сироп (двойной)», a dearer
   * shot in the large size) keeps it.
   */
  async update(id: string, dto: UpdateIngredientDto, scope: BrandScope): Promise<IngredientAdminDto> {
    const before = await this.find(id, scope);
    const row = await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.ingredient.update({ where: { id }, data: dto, include: WITH_USAGE });
        if (dto.name !== undefined && dto.name !== before.name) {
          const rename = { where: { ingredientId: id, name: before.name }, data: { name: dto.name } };
          await tx.modifier.updateMany(rename);
          await tx.variation.updateMany(rename);
        }
        if (dto.priceCents !== undefined && dto.priceCents !== before.priceCents) {
          const reprice = {
            where: { ingredientId: id, priceDeltaCents: before.priceCents },
            data: { priceDeltaCents: dto.priceCents },
          };
          await tx.modifier.updateMany(reprice);
          await tx.variation.updateMany(reprice);
        }
        return updated;
      })
      .catch((err: unknown) => {
        if (prismaCode(err) === 'P2025') throw new NotFoundException('Ingredient not found');
        return rethrowNameTaken(err, dto.name);
      });
    return toDto(row);
  }

  /**
   * Deletes the add-on and takes it off every product that offers it: its
   * extras and milks go, and so do the cart lines made with them (the carts
   * are re-totalled; placed orders keep their own snapshot).
   */
  async delete(id: string, scope: BrandScope): Promise<void> {
    await this.find(id, scope);
    await this.prisma
      .$transaction(async (tx) => {
        const [modifiers, variations] = await Promise.all([
          tx.modifier.findMany({ where: { ingredientId: id }, select: { id: true, productId: true } }),
          tx.variation.findMany({ where: { ingredientId: id }, select: { id: true, productId: true } }),
        ]);
        const productIds = [...new Set([...modifiers, ...variations].map((o) => o.productId))];
        if (productIds.length > 0) {
          const modifierIds = modifiers.map((m) => m.id);
          const variationIds = new Set(variations.map((v) => v.id));
          const lines = await tx.cartItem.findMany({
            where: { productId: { in: productIds } },
            select: { id: true, cartId: true, variationIds: true, modifiersJson: true },
          });
          await dropCartLines(
            tx,
            lines.filter(
              (line) =>
                line.variationIds.some((v) => variationIds.has(v)) ||
                modifierIds.some((m) => modifierCount(line.modifiersJson, m) > 0),
            ),
          );
          await tx.modifier.deleteMany({ where: { ingredientId: id } });
          await tx.variation.deleteMany({ where: { ingredientId: id } });
        }
        await tx.ingredient.delete({ where: { id } });
      })
      .catch((err: unknown) => {
        if (prismaCode(err) === 'P2025') throw new NotFoundException('Ingredient not found');
        throw err;
      });
  }

  private async find(id: string, scope: BrandScope) {
    const row = await this.prisma.ingredient.findUnique({
      where: { id },
      select: { brandId: true, name: true, priceCents: true },
    });
    if (!row) throw new NotFoundException('Ingredient not found');
    assertInScope(scope, row.brandId);
    return row;
  }
}

function toDto(row: IngredientWithUsage): IngredientAdminDto {
  const products = new Map<string, string>();
  for (const option of [...row.modifiers, ...row.variations]) products.set(option.product.id, option.product.name);
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    priceCents: row.priceCents,
    isAvailable: row.isAvailable,
    products: [...products].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rethrowNameTaken(err: unknown, name: string | undefined): never {
  if (prismaCode(err) === 'P2002') {
    throw menuConflict('INGREDIENT_NAME_TAKEN', `"${name ?? ''}" is already in the library`, name ? { name } : {});
  }
  throw err;
}
