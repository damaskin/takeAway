import { Injectable, NotFoundException } from '@nestjs/common';
import type { BrandOptionCatalog, BrandOptionSetting, BrandProductOptionPrice } from '@takeaway/shared-types';

import { activeStopWhere } from '../../catalog/option-availability';
import { PrismaService } from '../../prisma/prisma.service';
import { assertInScope, type BrandScope } from '../catalog/admin-catalog.service';
import { menuBadRequest } from '../catalog/admin-menu.errors';
import { CATALOG_ORDER, toCatalogGroup } from './admin-option-catalog.service';
import type {
  ApplyGroupPriceDto,
  OptionStopDto,
  SetOptionStopDto,
  UpdateBrandOptionDto,
} from './dto/admin-options.dto';

/**
 * A brand's side of the options catalog: the price of each add-on (one for
 * the whole brand; a product may set its own), which options it does not
 * have at all, and — per store — what has run out. A brand never adds or
 * renames options; that is the catalog's (SUPER_ADMIN). Variant prices live
 * in the product cards; «Добавки» shows them read-only (`productPrices`).
 */
@Injectable()
export class AdminBrandOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The whole catalog with the brand's price, switch and stopped stores for
   * every option, and the prices its products set (`productPrices`): every
   * variant option of a group attached to a product, with what it adds there
   * (0 when the product set none), and every add-on a product prices itself.
   */
  async catalog(scope: BrandScope, brandId: string): Promise<BrandOptionCatalog> {
    assertInScope(scope, brandId);
    await this.assertBrand(brandId);
    const now = new Date();
    const [groups, settings, stops, attached, overrides] = await Promise.all([
      this.prisma.optionGroup.findMany({
        orderBy: CATALOG_ORDER,
        include: { options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
      }),
      this.prisma.brandOptionSetting.findMany({ where: { brandId } }),
      this.prisma.storeOptionStop.findMany({
        where: { store: { brandId }, ...activeStopWhere(now) },
        select: { storeId: true, optionId: true },
      }),
      this.prisma.productOptionGroup.findMany({
        where: { product: { brandId } },
        select: {
          product: { select: { id: true, name: true } },
          group: { select: { kind: true, options: { select: { id: true } } } },
        },
      }),
      this.prisma.productOptionOverride.findMany({
        where: { product: { brandId }, priceCents: { not: null } },
        select: { productId: true, optionId: true, priceCents: true },
      }),
    ]);
    const settingOf = new Map(settings.map((s) => [s.optionId, s]));
    const stoppedAt = new Map<string, string[]>();
    for (const stop of stops) stoppedAt.set(stop.optionId, [...(stoppedAt.get(stop.optionId) ?? []), stop.storeId]);
    return {
      groups: groups.map((g) => toCatalogGroup(g)),
      settings: groups.flatMap((g) =>
        g.options.map((o) => ({
          optionId: o.id,
          priceCents: settingOf.get(o.id)?.priceCents ?? 0,
          enabled: settingOf.get(o.id)?.enabled ?? true,
          stoppedStoreIds: (stoppedAt.get(o.id) ?? []).sort(),
        })),
      ),
      productPrices: productPrices(attached, overrides),
    };
  }

  /**
   * «Применить ко всем»: one add-on price for every option of the group, for
   * the whole brand (syrups: +5 on one, then on all). The options keep their
   * «Есть у нас» switch. A variant group is priced per product: 400
   * OPTION_GROUP_INVALID. Answers the group's settings.
   */
  async applyGroupPrice(
    scope: BrandScope,
    brandId: string,
    groupId: string,
    dto: ApplyGroupPriceDto,
  ): Promise<BrandOptionSetting[]> {
    assertInScope(scope, brandId);
    await this.assertBrand(brandId);
    const group = await this.prisma.optionGroup.findUnique({
      where: { id: groupId },
      select: { kind: true, options: { select: { id: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    });
    if (!group) throw new NotFoundException('Option group not found');
    if (group.kind !== 'ADDON') {
      throw menuBadRequest('OPTION_GROUP_INVALID', 'A variant is priced in each product card, not for the brand');
    }
    const optionIds = group.options.map((o) => o.id);
    await this.prisma.$transaction(
      optionIds.map((optionId) =>
        this.prisma.brandOptionSetting.upsert({
          where: { brandId_optionId: { brandId, optionId } },
          create: { brandId, optionId, priceCents: dto.priceCents, enabled: true },
          update: { priceCents: dto.priceCents },
        }),
      ),
    );
    const [rows, stops] = await Promise.all([
      this.prisma.brandOptionSetting.findMany({ where: { brandId, optionId: { in: optionIds } } }),
      this.prisma.storeOptionStop.findMany({
        where: { optionId: { in: optionIds }, store: { brandId }, ...activeStopWhere() },
        select: { storeId: true, optionId: true },
        orderBy: { storeId: 'asc' },
      }),
    ]);
    const rowOf = new Map(rows.map((r) => [r.optionId, r]));
    return optionIds.map((optionId) => ({
      optionId,
      priceCents: rowOf.get(optionId)?.priceCents ?? dto.priceCents,
      enabled: rowOf.get(optionId)?.enabled ?? true,
      stoppedStoreIds: stops.filter((s) => s.optionId === optionId).map((s) => s.storeId),
    }));
  }

  /** Sets the brand's price of an option and whether it has it; fields left out keep their values. */
  async update(
    scope: BrandScope,
    brandId: string,
    optionId: string,
    dto: UpdateBrandOptionDto,
  ): Promise<BrandOptionSetting> {
    assertInScope(scope, brandId);
    await this.assertBrand(brandId);
    const option = await this.prisma.optionItem.findUnique({ where: { id: optionId }, select: { id: true } });
    if (!option) throw new NotFoundException('Option not found');
    const row = await this.prisma.brandOptionSetting.upsert({
      where: { brandId_optionId: { brandId, optionId } },
      create: { brandId, optionId, priceCents: dto.priceCents ?? 0, enabled: dto.enabled ?? true },
      update: {
        ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
    const stops = await this.prisma.storeOptionStop.findMany({
      where: { optionId, store: { brandId }, ...activeStopWhere() },
      select: { storeId: true },
      orderBy: { storeId: 'asc' },
    });
    return {
      optionId: row.optionId,
      priceCents: row.priceCents,
      enabled: row.enabled,
      stoppedStoreIds: stops.map((s) => s.storeId),
    };
  }

  /** The store has run out of the option; the brand's other stores keep selling it. */
  async stop(scope: BrandScope, storeId: string, optionId: string, dto: SetOptionStopDto): Promise<OptionStopDto> {
    await this.findStore(storeId, scope);
    const option = await this.prisma.optionItem.findUnique({ where: { id: optionId }, select: { id: true } });
    if (!option) throw new NotFoundException('Option not found');
    const expiresAt = dto.expiresAt ?? null;
    const row = await this.prisma.storeOptionStop.upsert({
      where: { storeId_optionId: { storeId, optionId } },
      create: { storeId, optionId, expiresAt },
      update: { expiresAt, createdAt: new Date() },
    });
    return { storeId: row.storeId, optionId: row.optionId, expiresAt: row.expiresAt?.toISOString() ?? null };
  }

  /** Back in stock in the store. Idempotent: lifting a stop nobody set is not an error. */
  async resume(scope: BrandScope, storeId: string, optionId: string): Promise<void> {
    await this.findStore(storeId, scope);
    await this.prisma.storeOptionStop.deleteMany({ where: { storeId, optionId } });
  }

  private async assertBrand(brandId: string): Promise<void> {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) throw new NotFoundException('Brand not found');
  }

  private async findStore(storeId: string, scope: BrandScope): Promise<{ id: string; brandId: string }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, brandId: true } });
    if (!store) throw new NotFoundException('Store not found');
    assertInScope(scope, store.brandId);
    return store;
  }
}

/**
 * What the brand's product cards say about option prices, for «Добавки»:
 * every variant option of an attached group with what it adds on that
 * product (0 without an override), and every add-on a product prices itself
 * — by option, then product name.
 */
function productPrices(
  attached: ReadonlyArray<{
    product: { id: string; name: string };
    group: { kind: 'VARIANT' | 'ADDON'; options: ReadonlyArray<{ id: string }> };
  }>,
  overrides: ReadonlyArray<{ productId: string; optionId: string; priceCents: number | null }>,
): BrandProductOptionPrice[] {
  const priceOf = new Map(overrides.map((o) => [`${o.productId}:${o.optionId}`, o.priceCents]));
  const out: BrandProductOptionPrice[] = [];
  for (const { product, group } of attached) {
    for (const option of group.options) {
      const own = priceOf.get(`${product.id}:${option.id}`);
      if (group.kind === 'VARIANT') {
        out.push({ optionId: option.id, productId: product.id, productName: product.name, priceCents: own ?? 0 });
      } else if (own !== undefined && own !== null) {
        out.push({ optionId: option.id, productId: product.id, productName: product.name, priceCents: own });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.optionId.localeCompare(b.optionId) ||
      a.productName.localeCompare(b.productName) ||
      a.productId.localeCompare(b.productId),
  );
}
