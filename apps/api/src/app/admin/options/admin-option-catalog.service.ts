import { Injectable, NotFoundException } from '@nestjs/common';
import type { OptionGroup, OptionItem, Prisma } from '@prisma/client';
import type { CatalogGroup, CatalogOption } from '@takeaway/shared-types';

import { PrismaService } from '../../prisma/prisma.service';
import { menuBadRequest, menuConflict, prismaCode } from '../catalog/admin-menu.errors';
import type {
  CreateCatalogGroupDto,
  CreateCatalogOptionDto,
  UpdateCatalogGroupDto,
  UpdateCatalogOptionDto,
} from './dto/admin-options.dto';
import { assertNoProblem, groupProblem, qtyProblem } from './option-catalog.rules';

/** The catalog in admin order: by position, then name; options likewise. */
export const CATALOG_ORDER = [
  { sortOrder: 'asc' },
  { name: 'asc' },
] satisfies Prisma.OptionGroupOrderByWithRelationInput[];
const WITH_OPTIONS = {
  options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
} satisfies Prisma.OptionGroupInclude;

export function toCatalogOption(row: OptionItem): CatalogOption {
  return {
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    note: row.note,
    isDefault: row.isDefault,
    minQty: row.minQty,
    maxQty: row.maxQty,
    defaultQty: row.defaultQty,
    sortOrder: row.sortOrder,
  };
}

export function toCatalogGroup(row: OptionGroup & { options: OptionItem[] }, productCount?: number): CatalogGroup {
  return {
    id: row.id,
    kind: row.kind,
    type: row.type,
    name: row.name,
    minSelect: row.minSelect,
    maxSelect: row.maxSelect,
    showIfOptionId: row.showIfOptionId,
    sortOrder: row.sortOrder,
    options: row.options.map(toCatalogOption),
    ...(productCount === undefined ? {} : { productCount }),
  };
}

/**
 * The platform's options catalog («Добавки и варианты»): groups and their
 * options, kept by the takeAway team (SUPER_ADMIN; the controller holds the
 * role). Every brand sees the same catalog and attaches its groups to its
 * products; prices, switches and stops are the brands' and stores' own.
 *
 * A group attached to a product cannot be deleted (409
 * OPTION_GROUP_IN_USE). Deleting an option takes its brand prices, stops
 * and product overrides with it; a cart line made with it leaves the cart
 * at checkout (CART_CHANGED, OPTION_UNAVAILABLE).
 */
@Injectable()
export class AdminOptionCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CatalogGroup[]> {
    const rows = await this.prisma.optionGroup.findMany({
      orderBy: CATALOG_ORDER,
      include: { ...WITH_OPTIONS, _count: { select: { products: true } } },
    });
    return rows.map((row) => toCatalogGroup(row, row._count.products));
  }

  async createGroup(dto: CreateCatalogGroupDto): Promise<CatalogGroup> {
    const shape = {
      kind: dto.kind,
      type: dto.type,
      minSelect: dto.minSelect ?? null,
      maxSelect: dto.maxSelect ?? null,
    };
    assertNoProblem(groupProblem(shape));
    const showIfOptionId = dto.showIfOptionId ?? null;
    if (showIfOptionId) await this.assertShowIfOption(showIfOptionId, null);
    const sortOrder = dto.sortOrder ?? (await this.nextGroupSortOrder());
    const row = await this.prisma.optionGroup
      .create({
        data: { ...shape, name: dto.name, showIfOptionId, sortOrder },
        include: WITH_OPTIONS,
      })
      .catch((err: unknown) => rethrowNameTaken(err, dto.name));
    return toCatalogGroup(row, 0);
  }

  /**
   * Fields left out keep their values. A group switched to B or C loses its
   * min/max unless the request sets them (and is refused if it does); one
   * switched to C has its options' counters checked.
   */
  async updateGroup(id: string, dto: UpdateCatalogGroupDto): Promise<CatalogGroup> {
    const before = await this.prisma.optionGroup.findUnique({ where: { id }, include: WITH_OPTIONS });
    if (!before) throw new NotFoundException('Option group not found');
    const type = dto.type ?? before.type;
    const keepsBounds = type === 'A';
    const shape = {
      kind: dto.kind ?? before.kind,
      type,
      minSelect: dto.minSelect !== undefined ? dto.minSelect : keepsBounds ? before.minSelect : null,
      maxSelect: dto.maxSelect !== undefined ? dto.maxSelect : keepsBounds ? before.maxSelect : null,
    };
    assertNoProblem(groupProblem(shape));
    if (type === 'C' && before.type !== 'C') {
      for (const option of before.options) assertNoProblem(qtyProblem(option));
    }
    const showIfOptionId = dto.showIfOptionId !== undefined ? dto.showIfOptionId : before.showIfOptionId;
    if (dto.showIfOptionId) await this.assertShowIfOption(dto.showIfOptionId, id);

    const row = await this.prisma.optionGroup
      .update({
        where: { id },
        data: {
          ...shape,
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          showIfOptionId,
        },
        include: { ...WITH_OPTIONS, _count: { select: { products: true } } },
      })
      .catch((err: unknown) => {
        if (prismaCode(err) === 'P2025') throw new NotFoundException('Option group not found');
        return rethrowNameTaken(err, dto.name);
      });
    return toCatalogGroup(row, row._count.products);
  }

  /** 409 OPTION_GROUP_IN_USE while any product (of any brand) has it attached. */
  async deleteGroup(id: string): Promise<void> {
    const group = await this.prisma.optionGroup.findUnique({
      where: { id },
      select: { name: true, _count: { select: { products: true } } },
    });
    if (!group) throw new NotFoundException('Option group not found');
    if (group._count.products > 0) {
      throw menuConflict('OPTION_GROUP_IN_USE', `"${group.name}" is attached to ${group._count.products} product(s)`, {
        productCount: group._count.products,
      });
    }
    await this.prisma.optionGroup.delete({ where: { id } }).catch((err: unknown) => {
      if (prismaCode(err) === 'P2025') throw new NotFoundException('Option group not found');
      if (prismaCode(err) === 'P2003') {
        // Attached in the meantime (ProductOptionGroup restricts the delete).
        throw menuConflict('OPTION_GROUP_IN_USE', `"${group.name}" is attached to a product`);
      }
      throw err;
    });
  }

  async createOption(groupId: string, dto: CreateCatalogOptionDto): Promise<CatalogOption> {
    const group = await this.prisma.optionGroup.findUnique({ where: { id: groupId }, select: { type: true } });
    if (!group) throw new NotFoundException('Option group not found');
    const qty = group.type === 'C' ? qtyOf(dto, null) : NO_QTY;
    assertNoProblem(group.type === 'C' ? qtyProblem(qty) : null);
    const sortOrder = dto.sortOrder ?? (await this.nextOptionSortOrder(groupId));
    const row = await this.prisma.optionItem
      .create({
        data: {
          groupId,
          name: dto.name,
          note: dto.note ?? null,
          isDefault: dto.isDefault ?? false,
          ...qty,
          sortOrder,
        },
      })
      .catch((err: unknown) => rethrowNameTaken(err, dto.name));
    return toCatalogOption(row);
  }

  async updateOption(id: string, dto: UpdateCatalogOptionDto): Promise<CatalogOption> {
    const before = await this.prisma.optionItem.findUnique({ where: { id }, include: { group: true } });
    if (!before) throw new NotFoundException('Option not found');
    const isC = before.group.type === 'C';
    const qty = isC ? qtyOf(dto, before) : NO_QTY;
    assertNoProblem(isC ? qtyProblem(qty) : null);
    const row = await this.prisma.optionItem
      .update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...qty,
        },
      })
      .catch((err: unknown) => {
        if (prismaCode(err) === 'P2025') throw new NotFoundException('Option not found');
        return rethrowNameTaken(err, dto.name);
      });
    return toCatalogOption(row);
  }

  /**
   * Its brand prices, store stops and product overrides go with it (foreign
   * keys cascade); a group shown only with it is shown always from now on.
   */
  async deleteOption(id: string): Promise<void> {
    await this.prisma.optionItem.delete({ where: { id } }).catch((err: unknown) => {
      if (prismaCode(err) === 'P2025') throw new NotFoundException('Option not found');
      throw err;
    });
  }

  /** The condition is an existing option, and not one of the group itself. */
  private async assertShowIfOption(optionId: string, groupId: string | null): Promise<void> {
    const option = await this.prisma.optionItem.findUnique({ where: { id: optionId }, select: { groupId: true } });
    if (!option) throw menuBadRequest('OPTION_GROUP_INVALID', 'The condition names an option that does not exist');
    if (groupId !== null && option.groupId === groupId) {
      throw menuBadRequest('OPTION_GROUP_INVALID', 'A group cannot be shown on a condition of its own option');
    }
  }

  private async nextGroupSortOrder(): Promise<number> {
    const { _max } = await this.prisma.optionGroup.aggregate({ _max: { sortOrder: true } });
    return (_max.sortOrder ?? 0) + 10;
  }

  private async nextOptionSortOrder(groupId: string): Promise<number> {
    const { _max } = await this.prisma.optionItem.aggregate({ where: { groupId }, _max: { sortOrder: true } });
    return (_max.sortOrder ?? 0) + 10;
  }
}

const NO_QTY = { minQty: null, maxQty: null, defaultQty: null };

/** A C option's counter after the request: fields left out keep their values. */
function qtyOf(
  dto: Pick<UpdateCatalogOptionDto, 'minQty' | 'maxQty' | 'defaultQty'>,
  before: Pick<OptionItem, 'minQty' | 'maxQty' | 'defaultQty'> | null,
): { minQty: number | null; maxQty: number | null; defaultQty: number | null } {
  return {
    minQty: dto.minQty !== undefined ? dto.minQty : (before?.minQty ?? null),
    maxQty: dto.maxQty !== undefined ? dto.maxQty : (before?.maxQty ?? null),
    defaultQty: dto.defaultQty !== undefined ? dto.defaultQty : (before?.defaultQty ?? null),
  };
}

function rethrowNameTaken(err: unknown, name: string | undefined): never {
  if (prismaCode(err) === 'P2002') {
    throw menuConflict('OPTION_NAME_TAKEN', `"${name ?? ''}" is already taken`, name ? { name } : {});
  }
  throw err;
}
