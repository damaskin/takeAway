import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { assertInScope, type BrandScope } from './admin-catalog.service';
import { menuConflict, prismaCode } from './admin-menu.errors';
import type { CreateIngredientDto, IngredientAdminDto, UpdateIngredientDto } from './dto/admin-ingredient.dto';

const WITH_USAGE = {
  modifiers: { select: { product: { select: { id: true, name: true } } } },
  variations: { select: { product: { select: { id: true, name: true } } } },
} satisfies Prisma.IngredientInclude;

type IngredientWithUsage = Prisma.IngredientGetPayload<{ include: typeof WITH_USAGE }>;

/**
 * The brand's ingredient library: the add-ins product options are made of,
 * each with one in-stock switch. Switching one off hides every option that
 * uses it from customers (see `AVAILABLE_OPTION`) and leaves the products
 * on the menu; switching it on brings the options back as they were.
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
        data: { brandId: dto.brandId, name: dto.name, isAvailable: dto.isAvailable ?? true },
        include: WITH_USAGE,
      })
      .catch((err: unknown) => rethrowNameTaken(err, dto.name));
    return toDto(row);
  }

  async update(id: string, dto: UpdateIngredientDto, scope: BrandScope): Promise<IngredientAdminDto> {
    await this.find(id, scope);
    const row = await this.prisma.ingredient
      .update({ where: { id }, data: dto, include: WITH_USAGE })
      .catch((err: unknown) => {
        if (prismaCode(err) === 'P2025') throw new NotFoundException('Ingredient not found');
        return rethrowNameTaken(err, dto.name);
      });
    return toDto(row);
  }

  /** The options stay on their products, no longer tracked (always shown). */
  async delete(id: string, scope: BrandScope): Promise<void> {
    await this.find(id, scope);
    await this.prisma.ingredient.delete({ where: { id } }).catch((err: unknown) => {
      if (prismaCode(err) === 'P2025') throw new NotFoundException('Ingredient not found');
      throw err;
    });
  }

  private async find(id: string, scope: BrandScope) {
    const row = await this.prisma.ingredient.findUnique({ where: { id }, select: { brandId: true } });
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
