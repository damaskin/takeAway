import { Injectable } from '@nestjs/common';
import type { OptionGroupKind, OptionGroupType, Prisma } from '@prisma/client';
import type { ProductOptionGroup, ProductOptionItem } from '@takeaway/shared-types';
import { orderOptionGroups } from '@takeaway/utils';

import { activeStopWhere } from '../catalog/option-availability';
import { PrismaService } from '../prisma/prisma.service';

/** Whose products, and for which store (none: a product fetched on its own — nothing is stopped). */
export interface OptionGroupsContext {
  brandId: string;
  storeId?: string | null;
  now?: Date;
}

/** What the builder reads of one attached group (`ProductOptionGroup` with its catalog group). */
export interface AttachedGroupRow {
  productId: string;
  sortOrder: number;
  group: {
    id: string;
    kind: OptionGroupKind;
    type: OptionGroupType;
    name: string;
    minSelect: number | null;
    maxSelect: number | null;
    showIfOptionId: string | null;
    /** The group of the show-if option, to tell «not on the product» from «switched off by the brand». */
    showIfOption: { groupId: string } | null;
    sortOrder: number;
    options: ReadonlyArray<{
      id: string;
      name: string;
      note: string | null;
      isDefault: boolean;
      minQty: number | null;
      maxQty: number | null;
      defaultQty: number | null;
      sortOrder: number;
    }>;
  };
}

export interface OptionOverrideRow {
  productId: string;
  optionId: string;
  priceCents: number | null;
  isDefault: boolean | null;
}

export interface BrandSettingRow {
  optionId: string;
  priceCents: number;
  enabled: boolean;
}

/** `include` of a `ProductOptionGroup` row for {@link buildProductOptionGroups}. */
export const ATTACHED_GROUP_INCLUDE = {
  group: {
    include: {
      showIfOption: { select: { groupId: true } },
      options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
    },
  },
} satisfies Prisma.ProductOptionGroupInclude;

/**
 * One product's groups as a store's customers see them (docs/option-groups.md,
 * «Building a product's groups for a store»):
 *
 * 1. the attached groups, variants first, then by the product's order, then
 *    the catalog's;
 * 2. each group's options in catalog order, without those the brand switched
 *    off;
 * 3. a variant priced by the product (`priceCents ?? 0`), an add-on by the
 *    brand (`priceCents ?? 0`);
 * 4. the product's default over the catalog's;
 * 5. `available` = not stopped in the store;
 * 6. a group left with no options is left out.
 *
 * One more case the doc leaves open: a group shown only with an option of
 * another group on the product («Лёд» ← «Холодный») is left out when the
 * brand switched that option off — its condition can never hold, and the
 * rules would otherwise read the condition as «not on the product» and show
 * the ice counter on every hot latte.
 */
export function buildProductOptionGroups(
  rows: readonly AttachedGroupRow[],
  overrides: readonly OptionOverrideRow[],
  settings: ReadonlyMap<string, BrandSettingRow>,
  stoppedOptionIds: ReadonlySet<string>,
): ProductOptionGroup[] {
  const overrideOf = new Map(overrides.map((o) => [o.optionId, o]));
  const attachedGroupIds = new Set(rows.map((r) => r.group.id));
  const sorted = [...rows]
    .filter((r) => r.group.type !== 'D')
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.group.sortOrder - b.group.sortOrder ||
        a.group.name.localeCompare(b.group.name) ||
        a.group.id.localeCompare(b.group.id),
    );

  const groups: ProductOptionGroup[] = [];
  for (const group of orderOptionGroups(sorted.map((r) => r.group))) {
    const options: ProductOptionItem[] = [];
    for (const option of [...group.options].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const setting = settings.get(option.id);
      if (setting && !setting.enabled) continue;
      const override = overrideOf.get(option.id);
      const isC = group.type === 'C';
      options.push({
        id: option.id,
        name: option.name,
        note: option.note,
        isDefault: override?.isDefault ?? option.isDefault,
        minQty: isC ? option.minQty : null,
        maxQty: isC ? option.maxQty : null,
        defaultQty: isC ? option.defaultQty : null,
        priceCents: group.kind === 'VARIANT' ? (override?.priceCents ?? 0) : (setting?.priceCents ?? 0),
        available: !stoppedOptionIds.has(option.id),
        sortOrder: option.sortOrder,
      });
    }
    if (options.length === 0) continue;
    groups.push({
      id: group.id,
      kind: group.kind,
      type: group.type,
      name: group.name,
      minSelect: group.type === 'A' ? group.minSelect : null,
      maxSelect: group.type === 'A' ? group.maxSelect : null,
      showIfOptionId: group.showIfOptionId,
      options,
    });
  }

  // A condition on an option the brand switched off, in a group the product has.
  return groups.filter((group) => {
    const condition = sorted.find((r) => r.group.id === group.id)?.group;
    if (!condition?.showIfOptionId || !condition.showIfOption) return true;
    if (!attachedGroupIds.has(condition.showIfOption.groupId)) return true;
    return groups.some((g) => g.options.some((o) => o.id === condition.showIfOptionId));
  });
}

/**
 * Builds `ProductOptionGroup[]` — what a store's customers see of a product's
 * catalog groups — for product pages, the menu, the cart and the order path.
 * One read per table for any number of products, so a whole menu costs four
 * queries.
 */
@Injectable()
export class ProductOptionGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every product's groups; a product without any is absent from the map. */
  async forProducts(
    productIds: readonly string[],
    ctx: OptionGroupsContext,
  ): Promise<Map<string, ProductOptionGroup[]>> {
    const ids = [...new Set(productIds)];
    const result = new Map<string, ProductOptionGroup[]>();
    if (ids.length === 0) return result;

    const rows = await this.prisma.productOptionGroup.findMany({
      where: { productId: { in: ids } },
      include: ATTACHED_GROUP_INCLUDE,
    });
    if (rows.length === 0) return result;

    const optionIds = [...new Set(rows.flatMap((r) => r.group.options.map((o) => o.id)))];
    const storeId = ctx.storeId ?? null;
    const [overrides, settings, stops] = await Promise.all([
      this.prisma.productOptionOverride.findMany({ where: { productId: { in: ids } } }),
      this.prisma.brandOptionSetting.findMany({
        where: { brandId: ctx.brandId, optionId: { in: optionIds } },
        select: { optionId: true, priceCents: true, enabled: true },
      }),
      storeId
        ? this.prisma.storeOptionStop.findMany({
            where: { storeId, optionId: { in: optionIds }, ...activeStopWhere(ctx.now ?? new Date()) },
            select: { optionId: true },
          })
        : Promise.resolve([]),
    ]);

    const settingOf = new Map(settings.map((s) => [s.optionId, s]));
    const stopped = new Set(stops.map((s) => s.optionId));
    const rowsOf = groupBy(rows, (r) => r.productId);
    const overridesOf = groupBy(overrides, (o) => o.productId);
    for (const [productId, productRows] of rowsOf) {
      const groups = buildProductOptionGroups(productRows, overridesOf.get(productId) ?? [], settingOf, stopped);
      if (groups.length > 0) result.set(productId, groups);
    }
    return result;
  }

  /** One product's groups; empty when it has none. */
  async forProduct(productId: string, ctx: OptionGroupsContext): Promise<ProductOptionGroup[]> {
    return (await this.forProducts([productId], ctx)).get(productId) ?? [];
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
