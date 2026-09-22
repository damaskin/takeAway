import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrandModerationStatus, Role, StoreStatus, type Store, type StoreWorkingHour } from '@prisma/client';

import { slugify, uniqueSlug } from '../../common/text/slug';
import { canonicalTimeZone, prevailingTimeZone } from '../../common/time/time-zone';
import { PrismaService } from '../../prisma/prisma.service';
import { missingChecks, storeReadiness, type StoreReadiness } from './store-readiness';
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
import type { SetBrandOwnerDto } from './dto/admin-brand-owner.dto';
import { PasswordService } from '../../auth/services/password.service';
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

type StoreWithHours = Store & { workingHours: StoreWorkingHour[] };

/** A store as the admin sees it: the row, its hours and what it still lacks. */
export type StoreView = StoreWithHours & { readiness: StoreReadiness };

/**
 * A 409 the admin can act on: `code` is stable for the UI to translate,
 * `message` is for everyone else reading the response.
 */
function conflict(code: string, message: string, extra: Record<string, unknown> = {}): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code, message, ...extra });
}

function isPrismaError(err: unknown, code: string): err is { code: string; meta?: { target?: unknown } } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

/** A slug someone else already has is the owner's to change, not a server fault. */
function storeWriteError(err: unknown): unknown {
  if (isPrismaError(err, 'P2002')) {
    const target = err.meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : typeof target === 'string' ? [target] : [];
    if (fields.some((f) => f.includes('slug'))) {
      return conflict('STORE_SLUG_TAKEN', 'Another store already uses this slug — pick a different one');
    }
  }
  return err;
}

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

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

  /** Minimal brand list filtered to the caller's scope. `null` = no filter. */
  listBrandsForScope(scope: BrandScope) {
    return this.prisma.brand.findMany({
      where: scope === null ? undefined : { id: { in: scope } },
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, currency: true, locale: true, logoUrl: true },
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

  /**
   * Creates a brand from the super-admin panel. Unlike self-serve sign-up,
   * there is nobody left to moderate it — the operator creating it *is* the
   * moderator — so it lands APPROVED and is immediately usable as the active
   * brand for stores and menu. Returned with `owner`/`_count` so the brands
   * page can splice it straight into its list.
   */
  createBrand(dto: CreateBrandDto) {
    return this.prisma.brand.create({
      data: {
        ...dto,
        moderationStatus: BrandModerationStatus.APPROVED,
        moderatedAt: new Date(),
      },
      include: {
        owner: { select: { id: true, email: true, name: true, phone: true } },
        _count: { select: { stores: true, products: true } },
      },
    });
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

  async getBrandOwner(brandId: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: { owner: { select: { id: true, email: true, name: true } } },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand.owner ?? null;
  }

  async setBrandOwner(brandId: string, dto: SetBrandOwnerDto) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) throw new NotFoundException('Brand not found');

    const email = dto.email.toLowerCase();
    let user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (!user) {
      if (!dto.tempPassword)
        throw new BadRequestException('tempPassword is required when creating a new owner account');
      const passwordHash = await this.passwords.hash(dto.tempPassword);
      user = await this.prisma.user.create({
        data: { email, passwordHash, passwordMustChange: true, name: dto.name ?? null, role: Role.BRAND_ADMIN },
        select: { id: true, role: true },
      });
    } else if (user.role === Role.SUPER_ADMIN) {
      throw new ForbiddenException('Cannot assign SUPER_ADMIN as brand owner');
    } else if (user.role !== Role.BRAND_ADMIN) {
      await this.prisma.user.update({ where: { id: user.id }, data: { role: Role.BRAND_ADMIN } });
    }

    const updated = await this.prisma.brand.update({
      where: { id: brandId },
      data: { ownerId: user.id },
      select: { owner: { select: { id: true, email: true, name: true } } },
    });
    return updated.owner;
  }

  // ── Stores ────────────────────────────────────────────────────────────────
  async listStores(scope: BrandScope, brandId?: string): Promise<StoreView[]> {
    if (brandId && scope !== null && !scope.includes(brandId)) return [];
    const where = brandId ? { brandId } : scope !== null ? { brandId: { in: scope } } : undefined;
    const stores = await this.prisma.store.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { workingHours: true },
    });
    return this.withReadiness(stores);
  }

  async getStore(id: string, scope: BrandScope = null) {
    const store = await this.prisma.store.findUnique({ where: { id }, include: { workingHours: true } });
    if (!store) throw new NotFoundException('Store not found');
    assertInScope(scope, store.brandId);
    return store;
  }

  /** The store editor's view: readiness, and whether orders already pin its currency. */
  async getStoreDetail(id: string, scope: BrandScope = null): Promise<StoreView & { hasOrders: boolean }> {
    const store = await this.getStore(id, scope);
    return this.detail(store);
  }

  /**
   * A new store starts CLOSED — it has no hours, maybe no menu, and the
   * form it came from knows nothing about tax or kitchen capacity. The
   * owner opens it from the admin once the readiness checks pass.
   */
  async createStore(dto: CreateStoreDto, scope: BrandScope = null): Promise<StoreView & { hasOrders: boolean }> {
    assertInScope(scope, dto.brandId);
    const brand = await this.prisma.brand.findUnique({
      where: { id: dto.brandId },
      select: { id: true, slug: true, currency: true },
    });
    if (!brand) throw new NotFoundException('Brand not found');

    const { workingHours, fulfillmentTypes, slug, currency, timezone, ...rest } = dto;
    let store: StoreWithHours;
    try {
      store = await this.prisma.store.create({
        data: {
          ...rest,
          slug: slug ?? (await this.generateStoreSlug(brand.slug, dto.name)),
          currency: currency ?? brand.currency,
          timezone: timezone ? canonicalTimeZone(timezone) : ((await this.brandTimeZone(brand.id)) ?? 'UTC'),
          status: StoreStatus.CLOSED,
          // Default to pure pickup when the caller doesn't specify — covers
          // the simple "add store" UI flow. `pickupPointType` has a Prisma
          // default (COUNTER) so no override needed here.
          fulfillmentTypes: fulfillmentTypes?.length ? fulfillmentTypes : ['TAKEAWAY'],
          workingHours: workingHours?.length ? { create: workingHours } : undefined,
        },
        include: { workingHours: true },
      });
    } catch (err) {
      throw storeWriteError(err);
    }
    return this.detail(store);
  }

  async updateStore(
    id: string,
    dto: UpdateStoreDto,
    scope: BrandScope = null,
  ): Promise<StoreView & { hasOrders: boolean }> {
    const store = await this.getStore(id, scope);
    const { workingHours: _ignored, timezone, currency, status, ...rest } = dto;

    // Every placed order carries the store's currency; switching it under
    // them would mix two currencies in one store's reports and refunds.
    if (currency != null && currency !== store.currency && (await this.storeHasOrders(id))) {
      throw conflict(
        'STORE_CURRENCY_LOCKED',
        'The currency cannot change once the store has orders — create a new store for the new currency',
      );
    }

    // Only switching a closed store on is gated: an open store keeps
    // accepting edits even if it predates the readiness checks.
    if (store.status === StoreStatus.CLOSED && status != null && status !== StoreStatus.CLOSED) {
      const readinessOf = await this.readinessResolver([store.brandId]);
      const missing = missingChecks(
        readinessOf({
          ...store,
          latitude: rest.latitude ?? store.latitude,
          longitude: rest.longitude ?? store.longitude,
          timezone: timezone ?? store.timezone,
        }),
      );
      if (missing.length > 0) {
        throw conflict('STORE_NOT_READY', `The store cannot open yet: ${missing.join(', ')}`, { missing });
      }
    }

    let updated: StoreWithHours;
    try {
      updated = await this.prisma.store.update({
        where: { id },
        data: {
          ...rest,
          ...(timezone != null ? { timezone: canonicalTimeZone(timezone) } : {}),
          ...(currency != null ? { currency } : {}),
          ...(status != null ? { status } : {}),
        },
        include: { workingHours: true },
      });
    } catch (err) {
      throw storeWriteError(err);
    }
    return this.detail(updated);
  }

  /**
   * Orders keep a foreign key to their store, so a store that has taken
   * one cannot be deleted without deleting sales history. Closing it keeps
   * the history and stops new orders, which is what the owner wants.
   */
  async deleteStore(id: string, scope: BrandScope = null) {
    await this.getStore(id, scope);
    const hasOrders = () => conflict('STORE_HAS_ORDERS', 'The store has orders — close it instead of deleting it');
    if (await this.storeHasOrders(id)) throw hasOrders();
    try {
      await this.prisma.store.delete({ where: { id } });
    } catch (err) {
      // An order placed between the check and the delete.
      if (isPrismaError(err, 'P2003')) throw hasOrders();
      throw err;
    }
  }

  private async detail(store: StoreWithHours): Promise<StoreView & { hasOrders: boolean }> {
    const readinessOf = await this.readinessResolver([store.brandId]);
    return { ...store, readiness: readinessOf(store), hasOrders: await this.storeHasOrders(store.id) };
  }

  private async withReadiness(stores: StoreWithHours[]): Promise<StoreView[]> {
    if (stores.length === 0) return [];
    const readinessOf = await this.readinessResolver(stores.map((s) => s.brandId));
    return stores.map((store) => ({ ...store, readiness: readinessOf(store) }));
  }

  /**
   * Loads what readiness needs to know about the brands — two queries,
   * whatever the number of stores — and returns the per-store check.
   */
  private async readinessResolver(brandIds: string[]): Promise<(store: StoreWithHours) => StoreReadiness> {
    const ids = [...new Set(brandIds)];
    const [products, brands] = await Promise.all([
      // Only what the storefront menu would actually show.
      this.prisma.product.groupBy({
        by: ['brandId'],
        where: { brandId: { in: ids }, visible: true, category: { visible: true } },
        _count: { _all: true },
      }),
      this.prisma.brand.findMany({ where: { id: { in: ids } }, select: { id: true, moderationStatus: true } }),
    ]);
    const productCount = new Map(products.map((p) => [p.brandId, p._count._all]));
    const brandStatus = new Map(brands.map((b) => [b.id, b.moderationStatus]));
    return (store) =>
      storeReadiness({
        latitude: store.latitude,
        longitude: store.longitude,
        timezone: store.timezone,
        workingHours: store.workingHours,
        visibleProducts: productCount.get(store.brandId) ?? 0,
        brandStatus: brandStatus.get(store.brandId) ?? null,
      });
  }

  private async storeHasOrders(storeId: string): Promise<boolean> {
    const order = await this.prisma.order.findFirst({ where: { storeId }, select: { id: true } });
    return order !== null;
  }

  /**
   * Slugs are unique across every brand, so the brand's own slug leads:
   * `/stores/noname-coffee-tsentr` rather than whichever brand typed
   * «Центр» first getting `tsentr` and the next one `tsentr-2`.
   */
  private generateStoreSlug(brandSlug: string, name: string): Promise<string> {
    const own = slugify(name);
    const namesBrand = own === brandSlug || own.startsWith(`${brandSlug}-`);
    const base = namesBrand ? name : `${brandSlug} ${name}`;
    return uniqueSlug(
      base,
      async (candidate) =>
        (await this.prisma.store.findUnique({ where: { slug: candidate }, select: { id: true } })) !== null,
      brandSlug || 'store',
    );
  }

  /** The zone the brand's other stores keep — the best guess for one nobody set. */
  private async brandTimeZone(brandId: string): Promise<string | null> {
    const stores = await this.prisma.store.findMany({ where: { brandId }, select: { timezone: true } });
    return prevailingTimeZone(stores.map((s) => s.timezone));
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

  async createProduct(dto: CreateProductDto, scope: BrandScope = null) {
    assertInScope(scope, dto.brandId);
    await this.assertCategoryOfBrand(dto.categoryId, dto.brandId);
    return this.prisma.product.create({ data: dto });
  }

  async updateProduct(id: string, dto: UpdateProductDto, scope: BrandScope = null) {
    const product = await this.getProduct(id, scope);
    if (dto.categoryId) await this.assertCategoryOfBrand(dto.categoryId, product.brandId);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  /**
   * Category ids are public (they come with every menu), and the public menu
   * lists a category's products. Without this check a brand could file its
   * own product under a competitor's category and appear in their menu.
   */
  private async assertCategoryOfBrand(categoryId: string, brandId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { brandId: true } });
    if (!category || category.brandId !== brandId) {
      throw new BadRequestException('The category belongs to another brand');
    }
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
