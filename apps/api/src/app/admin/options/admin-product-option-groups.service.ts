import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProductOptionGroupsConfig } from '@takeaway/shared-types';

import { PrismaService } from '../../prisma/prisma.service';
import { assertInScope, type BrandScope } from '../catalog/admin-catalog.service';
import { menuBadRequest } from '../catalog/admin-menu.errors';
import type { ProductOptionGroupsConfigDto } from './dto/admin-options.dto';

/**
 * Which catalog groups a product has, in which order, and the product's own
 * values for single options: what a variant adds to the base price (a latte
 * M and a cappuccino M cost different money), and another default (a dish's
 * signature sauce). The product editor reads and saves it as one piece.
 *
 * Once a product has a group it is ordered through its groups alone; its
 * older variations and extras stay in the database and are not offered.
 */
@Injectable()
export class AdminProductOptionGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(scope: BrandScope, productId: string): Promise<ProductOptionGroupsConfig> {
    await this.findProduct(scope, productId);
    return this.read(productId);
  }

  /**
   * Replaces the product's groups and overrides. 400 OPTION_GROUP_INVALID
   * for a group that does not exist, is reserved (D) or is listed twice,
   * and for a price on an add-on option (add-ons are priced per brand);
   * 400 OPTION_NOT_ON_PRODUCT for an override of an option outside the
   * groups sent. An override with nothing in it is dropped.
   */
  async replace(
    scope: BrandScope,
    productId: string,
    dto: ProductOptionGroupsConfigDto,
  ): Promise<ProductOptionGroupsConfig> {
    await this.findProduct(scope, productId);

    const groupIds = dto.groups.map((g) => g.groupId);
    if (new Set(groupIds).size !== groupIds.length) {
      throw menuBadRequest('OPTION_GROUP_INVALID', 'A group is listed twice');
    }
    const groups = await this.prisma.optionGroup.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, kind: true, type: true, options: { select: { id: true } } },
    });
    const found = new Map(groups.map((g) => [g.id, g]));
    const unknown = groupIds.filter((id) => !found.has(id));
    if (unknown.length > 0) {
      throw menuBadRequest('OPTION_GROUP_INVALID', `Unknown option group: ${unknown.join(', ')}`, {
        groupIds: unknown,
      });
    }
    if (groups.some((g) => g.type === 'D')) {
      throw menuBadRequest('OPTION_GROUP_INVALID', 'A group of type D cannot be attached');
    }

    const groupOfOption = new Map(groups.flatMap((g) => g.options.map((o) => [o.id, g] as const)));
    const overrides = dto.overrides.filter((o) => (o.priceCents ?? null) !== null || (o.isDefault ?? null) !== null);
    const optionIds = overrides.map((o) => o.optionId);
    if (new Set(optionIds).size !== optionIds.length) {
      throw menuBadRequest('OPTION_GROUP_INVALID', 'An option is overridden twice');
    }
    const outside = optionIds.filter((id) => !groupOfOption.has(id));
    if (outside.length > 0) {
      throw menuBadRequest('OPTION_NOT_ON_PRODUCT', `Not an option of the product's groups: ${outside.join(', ')}`, {
        optionIds: outside,
      });
    }
    const pricedAddons = overrides.filter(
      (o) => (o.priceCents ?? null) !== null && groupOfOption.get(o.optionId)?.kind !== 'VARIANT',
    );
    if (pricedAddons.length > 0) {
      throw menuBadRequest('OPTION_GROUP_INVALID', 'An add-on is priced for the whole brand, not per product', {
        optionIds: pricedAddons.map((o) => o.optionId),
      });
    }

    await this.prisma.$transaction([
      this.prisma.productOptionGroup.deleteMany({ where: { productId } }),
      this.prisma.productOptionOverride.deleteMany({ where: { productId } }),
      this.prisma.productOptionGroup.createMany({
        data: dto.groups.map((g) => ({ productId, groupId: g.groupId, sortOrder: g.sortOrder })),
      }),
      this.prisma.productOptionOverride.createMany({
        data: overrides.map((o) => ({
          productId,
          optionId: o.optionId,
          priceCents: o.priceCents ?? null,
          isDefault: o.isDefault ?? null,
        })),
      }),
    ]);
    return this.read(productId);
  }

  private async read(productId: string): Promise<ProductOptionGroupsConfig> {
    const [groups, overrides] = await Promise.all([
      this.prisma.productOptionGroup.findMany({
        where: { productId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { groupId: true, sortOrder: true },
      }),
      this.prisma.productOptionOverride.findMany({
        where: { productId },
        orderBy: { optionId: 'asc' },
        select: { optionId: true, priceCents: true, isDefault: true },
      }),
    ]);
    return { groups, overrides };
  }

  private async findProduct(scope: BrandScope, productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { brandId: true } });
    if (!product) throw new NotFoundException('Product not found');
    assertInScope(scope, product.brandId);
  }
}
