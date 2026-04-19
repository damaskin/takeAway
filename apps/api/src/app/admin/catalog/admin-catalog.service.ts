import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BrandModerationStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { SetBrandModerationDto } from './dto/admin-brand-moderation.dto';
import type { CreateBrandDto, UpdateBrandDto } from './dto/admin-brand.dto';

/** `null` = no brand restriction (super-admin). */
type BrandScope = string[] | null;

function assertInScope(scope: BrandScope, brandId: string): void {
  if (scope === null) return;
  if (!scope.includes(brandId)) {
    throw new ForbiddenException('Resource belongs to a brand outside your scope');
  }
}
import type { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/admin-category.dto';
import type {
  CreateModifierDto,
  CreateProductDto,
  CreateVariationDto,
  ToggleVisibilityDto,
  UpdateModifierDto,
  UpdateProductDto,
  UpdateVariationDto,
} from './dto/admin-product.dto';
import type { AddStopListEntryDto } from './dto/admin-stop-list.dto';
import type { CreateStoreDto, ReplaceWorkingHoursDto, UpdateStoreDto } from './dto/admin-store.dto';

@Injectable()
export class AdminCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Brands ────────────────────────────────────────────────────────────────
  listBrands(status?: BrandModerationStatus) {
    return this.prisma.brand.findMany({
      where: status ? { moderationStatus: status } : undefined,
      orderBy: [{ moderationStatus: 'asc' }, { name: 'asc' }],
      include: {
        owner: { select: { id: true, email: true, name: true, phone: true } },
        _count: { select: { stores: true, products: true } },
      },
    });
  }

  async getBrand(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, email: true, name: true, phone: true } },
        _count: { select: { stores: true, products: true } },
      },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  createBrand(dto: CreateBrandDto) {
    return this.prisma.brand.create({ data: dto });
  }

  async updateBrand(id: string, dto: UpdateBrandDto) {
    await this.getBrand(id);
    return this.prisma.brand.update({ where: { id }, data: dto });
  }

  async setBrandModeration(id: string, dto: SetBrandModerationDto) {
    await this.getBrand(id);
    return this.prisma.brand.update({
      where: { id },
      data: {
        moderationStatus: dto.status,
        moderationNote: dto.note ?? null,
        moderatedAt: new Date(),
      },
    });
  }

  // ── Stores ────────────────────────────────────────────────────────────────
  listStores(scope: BrandScope, brandId?: string) {
    if (brandId && scope !== null && !scope.includes(brandId)) return [];
    const where = brandId ? { brandId } : scope !== null ? { brandId: { in: scope } } : undefined;
    return this.prisma.store.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { workingHours: true },
    });
  }

  async getStore(id: string, scope: BrandScope = null) {
    const store = await this.prisma.store.findUnique({ where: { id }, include: { workingHours: true } });
    if (!store) throw new NotFoundException('Store not found');
    assertInScope(scope, store.brandId);
    return store;
  }

  createStore(dto: CreateStoreDto, scope: BrandScope = null) {
    assertInScope(scope, dto.brandId);
    const { workingHours, ...rest } = dto;
    return this.prisma.store.create({
      data: {
        ...rest,
        workingHours: workingHours?.length ? { create: workingHours } : undefined,
      },
      include: { workingHours: true },
    });
  }

  async updateStore(id: string, dto: UpdateStoreDto, scope: BrandScope = null) {
    await this.getStore(id, scope);
    const { workingHours: _ignored, ...rest } = dto;
    return this.prisma.store.update({
      where: { id },
      data: rest,
      include: { workingHours: true },
    });
  }

  async deleteStore(id: string, scope: BrandScope = null) {
    await this.getStore(id, scope);
    await this.prisma.store.delete({ where: { id } });
  }

  async replaceWorkingHours(storeId: string, dto: ReplaceWorkingHoursDto, scope: BrandScope = null) {
    await this.getStore(storeId, scope);
    await this.prisma.$transaction([
      this.prisma.storeWorkingHour.deleteMany({ where: { storeId } }),
      this.prisma.storeWorkingHour.createMany({
        data: dto.hours.map((h) => ({
          storeId,
          weekday: h.weekday,
          opensAt: h.opensAt,
          closesAt: h.closesAt,
          isClosed: h.isClosed ?? false,
        })),
      }),
    ]);
    return this.prisma.storeWorkingHour.findMany({ where: { storeId }, orderBy: { weekday: 'asc' } });
  }

  // ── Stop list ─────────────────────────────────────────────────────────────
  async listStopList(storeId: string, scope: BrandScope = null) {
    await this.getStore(storeId, scope);
    return this.prisma.stopListEntry.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, name: true, slug: true } } },
    });
  }

  async addStopListEntry(storeId: string, dto: AddStopListEntryDto, scope: BrandScope = null) {
    await this.getStore(storeId, scope);
    return this.prisma.stopListEntry.upsert({
      where: { storeId_productId: { storeId, productId: dto.productId } },
      create: { storeId, productId: dto.productId, reason: dto.reason, expiresAt: dto.expiresAt },
      update: { reason: dto.reason, expiresAt: dto.expiresAt },
    });
  }

  async removeStopListEntry(storeId: string, productId: string, scope: BrandScope = null) {
    await this.getStore(storeId, scope);
    await this.prisma.stopListEntry.delete({ where: { storeId_productId: { storeId, productId } } }).catch(() => {
      throw new NotFoundException('Stop-list entry not found');
    });
  }

  // ── Categories ────────────────────────────────────────────────────────────
  listCategories(scope: BrandScope, brandId?: string) {
    if (brandId && scope !== null && !scope.includes(brandId)) return [];
    const where = brandId ? { brandId } : scope !== null ? { brandId: { in: scope } } : undefined;
    return this.prisma.category.findMany({
      where,
      orderBy: [{ brandId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async getCategory(id: string, scope: BrandScope = null) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    assertInScope(scope, category.brandId);
    return category;
  }

  createCategory(dto: CreateCategoryDto, scope: BrandScope = null) {
    assertInScope(scope, dto.brandId);
    return this.prisma.category.create({ data: dto });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, scope: BrandScope = null) {
    await this.getCategory(id, scope);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async deleteCategory(id: string, scope: BrandScope = null) {
    await this.getCategory(id, scope);
    await this.prisma.category.delete({ where: { id } });
  }

  async reorderCategories(dto: ReorderCategoriesDto, scope: BrandScope = null) {
    if (scope !== null) {
      const cats = await this.prisma.category.findMany({
        where: { id: { in: dto.orderedIds } },
        select: { brandId: true },
      });
      for (const c of cats) assertInScope(scope, c.brandId);
    }
    await this.prisma.$transaction(
      dto.orderedIds.map((id, index) => this.prisma.category.update({ where: { id }, data: { sortOrder: index } })),
    );
  }

  // ── Products ──────────────────────────────────────────────────────────────
  listProducts(scope: BrandScope, brandId?: string, categoryId?: string) {
    if (brandId && scope !== null && !scope.includes(brandId)) return [];
    return this.prisma.product.findMany({
      where: {
        ...(brandId ? { brandId } : scope !== null ? { brandId: { in: scope } } : {}),
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async getProduct(id: string, scope: BrandScope = null) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { variations: true, modifiers: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    assertInScope(scope, product.brandId);
    return product;
  }

  createProduct(dto: CreateProductDto, scope: BrandScope = null) {
    assertInScope(scope, dto.brandId);
    return this.prisma.product.create({ data: dto });
  }

  async updateProduct(id: string, dto: UpdateProductDto, scope: BrandScope = null) {
    await this.getProduct(id, scope);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async deleteProduct(id: string, scope: BrandScope = null) {
    await this.getProduct(id, scope);
    await this.prisma.product.delete({ where: { id } });
  }

  async toggleProductVisibility(id: string, dto: ToggleVisibilityDto, scope: BrandScope = null) {
    await this.getProduct(id, scope);
    return this.prisma.product.update({ where: { id }, data: { visible: dto.visible } });
  }

  // ── Variations ────────────────────────────────────────────────────────────
  async createVariation(productId: string, dto: CreateVariationDto, scope: BrandScope = null) {
    await this.getProduct(productId, scope);
    return this.prisma.variation.create({ data: { productId, ...dto } });
  }

  async updateVariation(id: string, dto: UpdateVariationDto, scope: BrandScope = null) {
    if (scope !== null) {
      const existing = await this.prisma.variation.findUnique({
        where: { id },
        select: { product: { select: { brandId: true } } },
      });
      if (!existing) throw new NotFoundException('Variation not found');
      assertInScope(scope, existing.product.brandId);
    }
    return this.prisma.variation.update({ where: { id }, data: dto }).catch(() => {
      throw new NotFoundException('Variation not found');
    });
  }

  async deleteVariation(id: string, scope: BrandScope = null) {
    if (scope !== null) {
      const existing = await this.prisma.variation.findUnique({
        where: { id },
        select: { product: { select: { brandId: true } } },
      });
      if (!existing) throw new NotFoundException('Variation not found');
      assertInScope(scope, existing.product.brandId);
    }
    await this.prisma.variation.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Variation not found');
    });
  }

  // ── Modifiers ─────────────────────────────────────────────────────────────
  async createModifier(productId: string, dto: CreateModifierDto, scope: BrandScope = null) {
    await this.getProduct(productId, scope);
    return this.prisma.modifier.create({ data: { productId, ...dto } });
  }

  async updateModifier(id: string, dto: UpdateModifierDto, scope: BrandScope = null) {
    if (scope !== null) {
      const existing = await this.prisma.modifier.findUnique({
        where: { id },
        select: { product: { select: { brandId: true } } },
      });
      if (!existing) throw new NotFoundException('Modifier not found');
      assertInScope(scope, existing.product.brandId);
    }
    return this.prisma.modifier.update({ where: { id }, data: dto }).catch(() => {
      throw new NotFoundException('Modifier not found');
    });
  }

  async deleteModifier(id: string, scope: BrandScope = null) {
    if (scope !== null) {
      const existing = await this.prisma.modifier.findUnique({
        where: { id },
        select: { product: { select: { brandId: true } } },
      });
      if (!existing) throw new NotFoundException('Modifier not found');
      assertInScope(scope, existing.product.brandId);
    }
    await this.prisma.modifier.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Modifier not found');
    });
  }
}
