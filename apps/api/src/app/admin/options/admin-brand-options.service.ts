import { Injectable, NotFoundException } from '@nestjs/common';
import type { BrandOptionCatalog, BrandOptionSetting } from '@takeaway/shared-types';

import { activeStopWhere } from '../../catalog/option-availability';
import { PrismaService } from '../../prisma/prisma.service';
import { assertInScope, type BrandScope } from '../catalog/admin-catalog.service';
import { CATALOG_ORDER, toCatalogGroup } from './admin-option-catalog.service';
import type { OptionStopDto, SetOptionStopDto, UpdateBrandOptionDto } from './dto/admin-options.dto';

/**
 * A brand's side of the options catalog: the price of each add-on (one for
 * the whole brand), which options it does not have at all, and — per store —
 * what has run out. A brand never adds or renames options; that is the
 * catalog's (SUPER_ADMIN).
 */
@Injectable()
export class AdminBrandOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The whole catalog with the brand's price, switch and stopped stores for every option. */
  async catalog(scope: BrandScope, brandId: string): Promise<BrandOptionCatalog> {
    assertInScope(scope, brandId);
    await this.assertBrand(brandId);
    const now = new Date();
    const [groups, settings, stops] = await Promise.all([
      this.prisma.optionGroup.findMany({
        orderBy: CATALOG_ORDER,
        include: { options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
      }),
      this.prisma.brandOptionSetting.findMany({ where: { brandId } }),
      this.prisma.storeOptionStop.findMany({
        where: { store: { brandId }, ...activeStopWhere(now) },
        select: { storeId: true, optionId: true },
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
    };
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
