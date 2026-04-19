import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandModerationStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { SetBrandModerationDto } from './dto/admin-brand-moderation.dto';
import type { CreateBrandDto, UpdateBrandDto } from './dto/admin-brand.dto';
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
  listStores(brandId?: string) {
    return this.prisma.store.findMany({
      where: brandId ? { brandId } : undefined,
      orderBy: { name: 'asc' },
      include: { workingHours: true },
    });
  }

  async getStore(id: string) {
    const store = await this.prisma.store.findUnique({ where: { id }, include: { workingHours: true } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  createStore(dto: CreateStoreDto) {
    const { workingHours, ...rest } = dto;
    return this.prisma.store.create({
      data: {
        ...rest,
        workingHours: workingHours?.length ? { create: workingHours } : undefined,
      },
      include: { workingHours: true },
    });
  }

  async updateStore(id: string, dto: UpdateStoreDto) {
    await this.getStore(id);
    const { workingHours: _ignored, ...rest } = dto;
    return this.prisma.store.update({
      where: { id },
      data: rest,
      include: { workingHours: true },
    });
  }

  async deleteStore(id: string) {
    await this.getStore(id);
    await this.prisma.store.delete({ where: { id } });
  }

  async replaceWorkingHours(storeId: string, dto: ReplaceWorkingHoursDto) {
    await this.getStore(storeId);
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
  listStopList(storeId: string) {
    return this.prisma.stopListEntry.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, name: true, slug: true } } },
    });
  }

  async addStopListEntry(storeId: string, dto: AddStopListEntryDto) {
    await this.getStore(storeId);
    return this.prisma.stopListEntry.upsert({
      where: { storeId_productId: { storeId, productId: dto.productId } },
      create: { storeId, productId: dto.productId, reason: dto.reason, expiresAt: dto.expiresAt },
      update: { reason: dto.reason, expiresAt: dto.expiresAt },
    });
  }

  async removeStopListEntry(storeId: string, productId: string) {
    await this.prisma.stopListEntry.delete({ where: { storeId_productId: { storeId, productId } } }).catch(() => {
      throw new NotFoundException('Stop-list entry not found');
    });
  }

  // ── Categories ────────────────────────────────────────────────────────────
  listCategories(brandId?: string) {
    return this.prisma.category.findMany({
      where: brandId ? { brandId } : undefined,
      orderBy: [{ brandId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async getCategory(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  createCategory(dto: CreateCategoryDto) {
    return this.prisma.category.create({ data: dto });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    await this.getCategory(id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async deleteCategory(id: string) {
    await this.getCategory(id);
    await this.prisma.category.delete({ where: { id } });
  }

  async reorderCategories(dto: ReorderCategoriesDto) {
    await this.prisma.$transaction(
      dto.orderedIds.map((id, index) => this.prisma.category.update({ where: { id }, data: { sortOrder: index } })),
    );
  }

  // ── Products ──────────────────────────────────────────────────────────────
  listProducts(brandId?: string, categoryId?: string) {
    return this.prisma.product.findMany({
      where: {
        ...(brandId ? { brandId } : {}),
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async getProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { variations: true, modifiers: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  createProduct(dto: CreateProductDto) {
    return this.prisma.product.create({ data: dto });
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.getProduct(id);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async deleteProduct(id: string) {
    await this.getProduct(id);
    await this.prisma.product.delete({ where: { id } });
  }

  async toggleProductVisibility(id: string, dto: ToggleVisibilityDto) {
    await this.getProduct(id);
    return this.prisma.product.update({ where: { id }, data: { visible: dto.visible } });
  }

  // ── Variations ────────────────────────────────────────────────────────────
  async createVariation(productId: string, dto: CreateVariationDto) {
    await this.getProduct(productId);
    return this.prisma.variation.create({ data: { productId, ...dto } });
  }

  updateVariation(id: string, dto: UpdateVariationDto) {
    return this.prisma.variation.update({ where: { id }, data: dto }).catch(() => {
      throw new NotFoundException('Variation not found');
    });
  }

  async deleteVariation(id: string) {
    await this.prisma.variation.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Variation not found');
    });
  }

  // ── Modifiers ─────────────────────────────────────────────────────────────
  async createModifier(productId: string, dto: CreateModifierDto) {
    await this.getProduct(productId);
    return this.prisma.modifier.create({ data: { productId, ...dto } });
  }

  updateModifier(id: string, dto: UpdateModifierDto) {
    return this.prisma.modifier.update({ where: { id }, data: dto }).catch(() => {
      throw new NotFoundException('Modifier not found');
    });
  }

  async deleteModifier(id: string) {
    await this.prisma.modifier.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Modifier not found');
    });
  }
}
