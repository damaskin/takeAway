import { Injectable, NotFoundException } from '@nestjs/common';
import type { StoreFulfillment } from '@prisma/client';

import { FeatureFlagsService } from '../config/feature-flags.service';
import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { isOpenAt, type WorkingHour } from '../kitchen/opening-hours';
import { PrismaService } from '../prisma/prisma.service';
import { activeStopWhere, AVAILABLE_OPTION, availableOptionAt } from './option-availability';
import { ListStoresQueryDto } from './dto/list-stores-query.dto';
import type { PickupSlotDto } from './dto/pickup-slot.dto';
import type { MenuDto } from './dto/product.dto';
import type { ProductDetailDto } from './dto/product.dto';
import type { StoreDetailDto, StoreListItemDto } from './dto/store.dto';

const EARTH_RADIUS_METERS = 6371000;

/** Just enough of a store's open shift, if any, to tell whether it has one. */
const OPEN_SHIFT = { where: { closedAt: null }, select: { id: true }, take: 1 } as const;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
    private readonly kitchen: KitchenLoadService,
  ) {}

  /**
   * Strip `DELIVERY` from a store's advertised fulfillment modes when the
   * delivery module is globally disabled. Single gate at the catalog
   * response layer — web/TMA toggles, checkout validators, and anything
   * that reads `store.fulfillmentTypes` automatically see the right set.
   */
  private filterFulfillment(types: StoreFulfillment[]): StoreFulfillment[] {
    if (this.flags.deliveryEnabled) return types;
    return types.filter((t) => t !== 'DELIVERY');
  }

  async listStores(query: ListStoresQueryDto): Promise<StoreListItemDto[]> {
    const stores = await this.prisma.store.findMany({
      where: {
        status: { not: 'CLOSED' },
        brand: { moderationStatus: 'APPROVED' },
      },
      include: {
        workingHours: { select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } },
        brand: { select: { name: true, logoUrl: true } },
        shifts: OPEN_SHIFT,
      },
      orderBy: [{ name: 'asc' }],
    });

    // One grouped query for every store's live queue, rather than one per
    // pin. `currentEtaSeconds` on the wire is now a computed figure: the
    // store's fixed overhead plus what the queue owes.
    const waits = await this.kitchen.queueWaitByStore(stores);

    const hasPoint = typeof query.lat === 'number' && typeof query.lng === 'number';
    const radius = query.radius ?? 5000;

    const now = new Date();

    return stores
      .map((s) => {
        const currentEtaSeconds = s.baseEtaSeconds + (waits.get(s.id) ?? 0);
        return {
          id: s.id,
          brandId: s.brandId,
          brandName: s.brand.name,
          logoUrl: s.brand.logoUrl,
          slug: s.slug,
          name: s.name,
          addressLine: s.addressLine,
          city: s.city,
          country: s.country,
          latitude: s.latitude,
          longitude: s.longitude,
          status: s.status,
          fulfillmentTypes: this.filterFulfillment(s.fulfillmentTypes),
          pickupPointType: s.pickupPointType,
          busyMeter: s.busyMeter,
          currentEtaSeconds,
          acceptingOrders: acceptingOrders(s),
          openNow: openNow(s, now, currentEtaSeconds),
          taxRateBps: s.taxRateBps,
          taxIncludedInPrice: s.taxIncludedInPrice,
          currency: s.currency,
          timezone: s.timezone,
          heroImageUrl: s.heroImageUrl,
          distanceMeters: hasPoint ? haversineMeters(query.lat!, query.lng!, s.latitude, s.longitude) : null,
        };
      })
      .filter((s) => !hasPoint || (s.distanceMeters ?? Infinity) <= radius)
      .sort((a, b) => {
        if (a.distanceMeters !== null && b.distanceMeters !== null) return a.distanceMeters - b.distanceMeters;
        return a.currentEtaSeconds - b.currentEtaSeconds;
      });
  }

  /**
   * Scheduled pickup windows a customer may actually choose. Resolves the
   * slug first so the public API keeps taking either form.
   */
  async getPickupSlots(idOrSlug: string): Promise<PickupSlotDto[]> {
    const store = await this.prisma.store.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        status: { not: 'CLOSED' },
        brand: { moderationStatus: 'APPROVED' },
      },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    const slots = await this.kitchen.pickupSlots(store.id);
    return slots.map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      taken: slot.taken,
      capacity: slot.capacity,
      available: slot.available,
    }));
  }

  async getStore(idOrSlug: string): Promise<StoreDetailDto> {
    const store = await this.prisma.store.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        brand: { moderationStatus: 'APPROVED' },
      },
      include: {
        workingHours: { orderBy: { weekday: 'asc' } },
        shifts: OPEN_SHIFT,
        brand: { select: { id: true, slug: true, name: true, logoUrl: true, themeOverrides: true } },
      },
    });
    if (!store) throw new NotFoundException('Store not found');

    const currentEtaSeconds =
      store.baseEtaSeconds + (await this.kitchen.queueWaitSeconds(store.id, store.kitchenParallelism));

    return {
      id: store.id,
      brandId: store.brandId,
      brandName: store.brand.name,
      logoUrl: store.brand.logoUrl,
      slug: store.slug,
      name: store.name,
      addressLine: store.addressLine,
      city: store.city,
      country: store.country,
      latitude: store.latitude,
      longitude: store.longitude,
      status: store.status,
      fulfillmentTypes: this.filterFulfillment(store.fulfillmentTypes),
      pickupPointType: store.pickupPointType,
      busyMeter: store.busyMeter,
      currentEtaSeconds,
      acceptingOrders: acceptingOrders(store),
      openNow: openNow(store, new Date(), currentEtaSeconds),
      taxRateBps: store.taxRateBps,
      taxIncludedInPrice: store.taxIncludedInPrice,
      currency: store.currency,
      heroImageUrl: store.heroImageUrl,
      distanceMeters: null,
      timezone: store.timezone,
      phone: store.phone,
      email: store.email,
      minOrderCents: store.minOrderCents,
      galleryUrls: store.galleryUrls,
      workingHours: store.workingHours.map((h) => ({
        weekday: h.weekday,
        opensAt: h.opensAt,
        closesAt: h.closesAt,
        isClosed: h.isClosed,
      })),
      brand: {
        id: store.brand.id,
        slug: store.brand.slug,
        name: store.brand.name,
        logoUrl: store.brand.logoUrl,
        themeOverrides: (store.brand.themeOverrides as Record<string, string> | null) ?? null,
      },
    };
  }

  async getMenu(storeIdOrSlug: string): Promise<MenuDto> {
    const store = await this.prisma.store.findFirst({
      where: {
        OR: [{ id: storeIdOrSlug }, { slug: storeIdOrSlug }],
        brand: { moderationStatus: 'APPROVED' },
      },
      select: { id: true, slug: true, brandId: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    const stopListEntries = await this.prisma.stopListEntry.findMany({
      where: { storeId: store.id, ...activeStopWhere() },
      select: { productId: true },
    });
    const stopList = new Set(stopListEntries.map((e) => e.productId));

    // Equal positions (everything created before ordering existed sits at 0)
    // fall back to creation order, the same tie-break the admin editor shows.
    // Only the products this store sells (ProductStore); a category left
    // with none of them is not shown in this store at all.
    const categories = await this.prisma.category.findMany({
      where: { brandId: store.brandId, visible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        products: {
          where: { visible: true, brandId: store.brandId, stores: { some: { storeId: store.id } } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    return {
      storeId: store.id,
      storeSlug: store.slug,
      categories: categories
        .filter((c) => c.products.length > 0)
        .map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description,
          iconUrl: c.iconUrl,
          sortOrder: c.sortOrder,
          availableFrom: c.availableFrom,
          availableTo: c.availableTo,
          products: c.products.map((p) => ({
            id: p.id,
            categoryId: p.categoryId,
            slug: p.slug,
            name: p.name,
            description: p.description,
            basePriceCents: p.basePriceCents,
            prepTimeSeconds: p.prepTimeSeconds,
            caffeineLevel: p.caffeineLevel,
            calories: p.calories,
            proteinsGrams: p.proteinsGrams,
            fatsGrams: p.fatsGrams,
            carbsGrams: p.carbsGrams,
            allergens: p.allergens,
            dietTags: p.dietTags,
            imageUrls: p.imageUrls,
            sortOrder: p.sortOrder,
            onStopList: stopList.has(p.id),
          })),
        })),
    };
  }

  /**
   * A product slug is unique within its brand only, and slugs are now made
   * from names, so two cafés selling «Латте» both have `latte`. The client
   * passes the store the customer is browsing and the lookup stays inside
   * that store's brand; without one, the oldest match wins so an old link
   * at least resolves the same way every time.
   */
  async getProduct(idOrSlug: string, storeIdOrSlug?: string): Promise<ProductDetailDto> {
    let store: { id: string; brandId: string } | undefined;
    if (storeIdOrSlug) {
      const found = await this.prisma.store.findFirst({
        where: { OR: [{ id: storeIdOrSlug }, { slug: storeIdOrSlug }] },
        select: { id: true, brandId: true },
      });
      if (!found) throw new NotFoundException('Store not found');
      store = found;
    }
    const now = new Date();
    // With a store: only a product that store sells, and without the
    // options made of what that store has run out of.
    const product = await this.prisma.product.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        visible: true,
        brand: { moderationStatus: 'APPROVED' },
        ...(store ? { brandId: store.brandId, stores: { some: { storeId: store.id } } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        variations: {
          orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
          include: {
            ingredient: {
              select: {
                isAvailable: true,
                ...(store
                  ? { storeStops: { where: { storeId: store.id, ...activeStopWhere(now) }, select: { storeId: true } } }
                  : {}),
              },
            },
          },
        },
        modifiers: {
          where: store ? availableOptionAt(store.id, now) : AVAILABLE_OPTION,
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    const variations = product.variations.filter(
      (v) => !v.ingredient || (v.ingredient.isAvailable && !(v.ingredient.storeStops?.length ?? 0)),
    );
    const defaults = defaultVariationIds(product.variations, variations);

    return {
      id: product.id,
      categoryId: product.categoryId,
      brandId: product.brandId,
      slug: product.slug,
      name: product.name,
      description: product.description,
      basePriceCents: product.basePriceCents,
      prepTimeSeconds: product.prepTimeSeconds,
      caffeineLevel: product.caffeineLevel,
      calories: product.calories,
      proteinsGrams: product.proteinsGrams,
      fatsGrams: product.fatsGrams,
      carbsGrams: product.carbsGrams,
      allergens: product.allergens,
      dietTags: product.dietTags,
      imageUrls: product.imageUrls,
      sortOrder: product.sortOrder,
      variations: variations.map((v) => ({
        id: v.id,
        type: v.type,
        name: v.name,
        priceDeltaCents: v.priceDeltaCents,
        prepTimeDeltaSeconds: v.prepTimeDeltaSeconds,
        sortOrder: v.sortOrder,
        isDefault: defaults.has(v.id),
      })),
      modifiers: product.modifiers.map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        priceDeltaCents: m.priceDeltaCents,
        prepTimeDeltaSeconds: m.prepTimeDeltaSeconds,
        minCount: m.minCount,
        maxCount: m.maxCount,
        sortOrder: m.sortOrder,
      })),
    };
  }
}

/**
 * The pre-selected variation of each type. When the default one is hidden
 * because its ingredient ran out (the house milk), the first remaining
 * choice of that type takes over — the one the cart falls back to — so the
 * screen and the price agree. A type that never had a default keeps none.
 */
function defaultVariationIds(
  all: ReadonlyArray<{ type: string; isDefault: boolean }>,
  shown: ReadonlyArray<{ id: string; type: string; isDefault: boolean }>,
): Set<string> {
  const ids = new Set<string>();
  for (const type of new Set(all.filter((v) => v.isDefault).map((v) => v.type))) {
    const ofType = shown.filter((v) => v.type === type);
    const pick = ofType.find((v) => v.isDefault) ?? ofType[0];
    if (pick) ids.add(pick.id);
  }
  return ids;
}

/**
 * The store takes orders at all right now: it is not switched off and staff
 * have started a shift. False means the clients show it as inactive.
 */
function acceptingOrders(store: { status: string; shifts: readonly unknown[] }): boolean {
  return store.status !== 'CLOSED' && store.shifts.length > 0;
}

/**
 * Whether an ASAP order placed now would be accepted: the store takes orders
 * (see acceptingOrders), and it is still open when that order would be ready —
 * the same working-hours check order creation enforces. Without this the
 * clients offered ASAP after hours and the customer met a bare 400 at checkout.
 */
function openNow(
  store: { status: string; shifts: readonly unknown[]; timezone: string; workingHours: readonly WorkingHour[] },
  now: Date,
  etaSeconds: number,
): boolean {
  if (!acceptingOrders(store)) return false;
  return isOpenAt(store.workingHours, new Date(now.getTime() + etaSeconds * 1000), store.timezone);
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a)));
}
