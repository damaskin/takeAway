import { Injectable, NotFoundException } from '@nestjs/common';
import { CategoryOptionKind, type Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { assertInScope, type BrandScope } from './admin-catalog.service';
import { prismaCode } from './admin-menu.errors';
import { copyCategoryOptions } from './category-option-copy';
import { linkedIngredient, linkId, optionDefaults, optionGroup } from './ingredient-link';
import type {
  AddCategoryOptionsDto,
  ApplyCategoryOptionsResultDto,
  CategoryOptionDto,
  CategoryOptionInputDto,
  UpdateCategoryOptionDto,
} from './dto/admin-category-option.dto';

const WITH_INGREDIENT = {
  ingredient: { select: { id: true, name: true, isAvailable: true } },
} as const satisfies Prisma.CategoryOptionInclude;

type OptionRow = Prisma.CategoryOptionGetPayload<{ include: typeof WITH_INGREDIENT }>;

/** Applying a set to a big category touches every product: more room than the 5 s default. */
const APPLY_TIMEOUT_MS = 60_000;

/**
 * A category's option set («Опции категории»): the options its products
 * are meant to have, set up once — typically from a ready-made preset
 * (`OPTION_PRESETS` in shared-types) — instead of on every product.
 *
 * The set is a template. A new product of the category gets a copy of it,
 * and «apply» copies what is missing onto every product of the category;
 * the cart, checkout and orders keep reading each product's own options.
 * So a product can still have its own price for an add-on, or an extra
 * option, and nothing in the set is ever inherited behind its back.
 */
@Injectable()
export class AdminCategoryOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(categoryId: string, scope: BrandScope): Promise<CategoryOptionDto[]> {
    await this.findCategory(categoryId, scope);
    return this.rows(this.prisma, categoryId);
  }

  /**
   * Appends options to the set, skipping the ones it already has, so a
   * preset sent twice adds nothing. Every add-on and milk is linked to the
   * brand library, created there (at the price and in the group given)
   * when missing — the stop-list and library prices then work for it.
   */
  async add(categoryId: string, dto: AddCategoryOptionsDto, scope: BrandScope): Promise<CategoryOptionDto[]> {
    const category = await this.findCategory(categoryId, scope);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.categoryOption.findMany({ where: { categoryId } });
      let sortOrder = current.reduce((max, o) => Math.max(max, o.sortOrder), -1) + 1;
      for (const input of dto.options) {
        const option = await this.resolve(tx, category.brandId, input);
        if (current.some((o) => sameSetOption(o, option))) continue;
        if (option.isDefault) {
          await tx.categoryOption.updateMany({
            where: { categoryId, kind: CategoryOptionKind.VARIATION, variationType: option.variationType },
            data: { isDefault: false },
          });
          for (const o of current) if (o.variationType === option.variationType) o.isDefault = false;
        }
        const created = await tx.categoryOption.create({ data: { categoryId, ...option, sortOrder: sortOrder++ } });
        current.push(created);
      }
      return this.rows(tx, categoryId);
    });
  }

  async update(
    categoryId: string,
    optionId: string,
    dto: UpdateCategoryOptionDto,
    scope: BrandScope,
  ): Promise<CategoryOptionDto[]> {
    await this.findCategory(categoryId, scope);
    const option = await this.findOption(categoryId, optionId);
    const isVariation = option.kind === CategoryOptionKind.VARIATION;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault && isVariation) {
        await tx.categoryOption.updateMany({
          where: { categoryId, variationType: option.variationType, isDefault: true, id: { not: optionId } },
          data: { isDefault: false },
        });
      }
      await tx.categoryOption.update({
        where: { id: optionId },
        data: {
          name: dto.name?.trim(),
          priceDeltaCents: dto.priceDeltaCents,
          sortOrder: dto.sortOrder,
          // A choice group has no add-on label, an add-on no default.
          ...(isVariation ? { isDefault: dto.isDefault } : { group: dto.group, maxCount: dto.maxCount }),
        },
      });
      return this.rows(tx, categoryId);
    });
  }

  /** Takes the option out of the set; products that already have it keep it. */
  async remove(categoryId: string, optionId: string, scope: BrandScope): Promise<void> {
    await this.findCategory(categoryId, scope);
    await this.findOption(categoryId, optionId);
    await this.prisma.categoryOption.delete({ where: { id: optionId } }).catch((err: unknown) => {
      if (prismaCode(err) === 'P2025') throw new NotFoundException('Category option not found');
      throw err;
    });
  }

  /**
   * Copies the set onto every product of the category, adding only what
   * each one lacks (see `planOptionCopy`). Two clicks at once must not add
   * an option twice, so applies to one category take turns.
   */
  async apply(categoryId: string, scope: BrandScope): Promise<ApplyCategoryOptionsResultDto> {
    await this.findCategory(categoryId, scope);
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const lockKey = `category-options:${categoryId}`;
            await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS l`;
            return copyCategoryOptions(tx, categoryId);
          },
          { timeout: APPLY_TIMEOUT_MS },
        );
      } catch (err) {
        // An editor added an option of the same slug meanwhile: the next pass sees it.
        if (prismaCode(err) !== 'P2002' || attempt >= 3) throw err;
      }
    }
  }

  /** Gives every product of the category the category's default preparation time. */
  async applyPrepTime(categoryId: string, scope: BrandScope): Promise<{ products: number }> {
    const category = await this.findCategory(categoryId, scope);
    if (category.defaultPrepTimeSeconds === null) return { products: 0 };
    const { count } = await this.prisma.product.updateMany({
      where: { categoryId, prepTimeSeconds: { not: category.defaultPrepTimeSeconds } },
      data: { prepTimeSeconds: category.defaultPrepTimeSeconds },
    });
    return { products: count };
  }

  /** A set option ready to store: linked to the library, named and priced from it where left out. */
  private async resolve(tx: Prisma.TransactionClient, brandId: string, input: CategoryOptionInputDto) {
    const isVariation = input.kind === CategoryOptionKind.VARIATION;
    const variationType = isVariation ? (input.variationType ?? null) : null;
    // Add-ons and milk come from the library; a size or a cup is not stocked.
    const autoLink = !isVariation || variationType === 'MILK';
    const linked = await linkedIngredient(
      tx,
      brandId,
      input.ingredientId,
      input.name,
      autoLink,
      input.priceDeltaCents,
      isVariation ? null : (input.group ?? null),
    );
    const { name, priceDeltaCents } = optionDefaults(input, linked);
    return {
      kind: input.kind,
      variationType,
      name,
      priceDeltaCents,
      group: isVariation ? null : optionGroup(input.group, linked),
      isDefault: isVariation && (input.isDefault ?? false),
      maxCount: isVariation ? 1 : (input.maxCount ?? 1),
      ingredientId: linkId(linked) ?? null,
    };
  }

  private async findCategory(id: string, scope: BrandScope) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, brandId: true, defaultPrepTimeSeconds: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    assertInScope(scope, category.brandId);
    return category;
  }

  private async findOption(categoryId: string, optionId: string) {
    const option = await this.prisma.categoryOption.findUnique({
      where: { id: optionId },
      select: { categoryId: true, kind: true, variationType: true },
    });
    if (!option || option.categoryId !== categoryId) throw new NotFoundException('Category option not found');
    return option;
  }

  private async rows(db: Prisma.TransactionClient, categoryId: string): Promise<CategoryOptionDto[]> {
    const rows = await db.categoryOption.findMany({
      where: { categoryId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: WITH_INGREDIENT,
    });
    return rows.map(toDto);
  }
}

/** The set has this option already: same kind and group type, and the same add-on or name. */
function sameSetOption(
  a: { kind: CategoryOptionKind; variationType: string | null; name: string; ingredientId: string | null },
  b: { kind: CategoryOptionKind; variationType: string | null; name: string; ingredientId: string | null },
): boolean {
  if (a.kind !== b.kind || a.variationType !== b.variationType) return false;
  if (a.ingredientId && b.ingredientId) return a.ingredientId === b.ingredientId;
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

function toDto(row: OptionRow): CategoryOptionDto {
  return {
    id: row.id,
    categoryId: row.categoryId,
    kind: row.kind,
    variationType: row.variationType,
    name: row.name,
    priceDeltaCents: row.priceDeltaCents,
    group: row.group,
    isDefault: row.isDefault,
    maxCount: row.maxCount,
    sortOrder: row.sortOrder,
    ingredientId: row.ingredientId,
    ingredient: row.ingredient,
  };
}
