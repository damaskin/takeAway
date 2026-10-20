import { Injectable, NotFoundException } from '@nestjs/common';
import type { StoreFulfillment } from '@prisma/client';

import { FeatureFlagsService } from '../config/feature-flags.service';
import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { StoreAvailabilityService, type StoreAvailabilityView } from '../kitchen/store-availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { activeStopWhere, AVAILABLE_OPTION, availableOptionAt } from './option-availability';
import { SOLD_ON_ITS_OWN } from './product-listing';
import { busyMeterOf } from './store-availability';
import { storeKinds, storeKindWhere } from './store-kinds';
import { ListStoresQueryDto } from './dto/list-stores-query.dto';
import type { PickupSlotDto } from './dto/pickup-slot.dto';
import type { MenuDto } from './dto/product.dto';
import type { ProductDetailDto } from './dto/product.dto';
import type { StoreDetailDto, StoreListItemDto } from './dto/store.dto';

const EARTH_RADIUS_METERS = 6371000;

/** A store's open shift, if any, with the extension past the working hours. */
const OPEN_SHIFT = { where: { closedAt: null }, select: { extendedUntil: true }, take: 1 } as const;

/** The availability fields of the store DTOs. */
function availabilityFields(view: StoreAvailabilityView | undefined) {
  return {
    acceptingOrders: view?.acceptingOrders ?? false,
    openNow: view?.openNow ?? false,
    asapBlockedReason: view?.asapBlockedReason ?? null,
    opensAt: view?.opensAt?.toISOString() ?? null,
    closesAt: view?.closesAt?.toISOString() ?? null,
    pausedUntil: view?.pausedUntil?.toISOString() ?? null,
    pauseReason: view?.pauseReason ?? null,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
    private readonly kitchen: KitchenLoadService,
    private readonly availability: StoreAvailabilityService,
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
        ...storeKindWhere(query.kind),
      },
      include: {
        workingHours: { select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } },
        brand: { select: { name: true, logoUrl: true } },
        shifts: OPEN_SHIFT,
      },
      orderBy: [{ name: 'asc' }],
    });

    // A couple of grouped queries for every store's live queue and slots,
    // rather than a few per pin. `currentEtaSeconds` on the wire is a
    // computed figure: the store's fixed overhead plus what the queue owes
    // (and the busy wait while the kitchen has pressed «Загружены») plus a
    // typical order's cooking, pushed to the first slot with room.
    const availability = await this.availability.evaluate(stores);

    const hasPoint = typeof query.lat === 'number' && typeof query.lng === 'number';
    const radius = query.radius ?? 5000;

    return stores
      .map((s) => {
        const view = availability.get(s.id);
        const currentEtaSeconds = view?.currentEtaSeconds ?? s.baseEtaSeconds;
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
          busyMeter: busyMeterOf(s),
          currentEtaSeconds,
          ...availabilityFields(view),
          taxRateBps: s.taxRateBps,
          taxIncludedInPrice: s.taxIncludedInPrice,
          currency: s.currency,
          timezone: s.timezone,
          heroImageUrl: s.heroImageUrl,
          kinds: storeKinds(s.kinds),
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
   * Scheduled pickup windows a customer may actually choose over the next
   * 24 hours. Resolves the slug first so the public API keeps taking either
   * form. With `cartId`, a slot counts as full when that cart's kitchen
   * work would not fit it any more; a cart of another store is ignored.
   */
  async getPickupSlots(idOrSlug: string, cartId?: string): Promise<PickupSlotDto[]> {
    const store = await this.prisma.store.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        status: { not: 'CLOSED' },
        brand: { moderationStatus: 'APPROVED' },
      },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    let workSeconds = 0;
    if (cartId) {
      const cart = await this.prisma.cart.findUnique({
        where: { id: cartId },
        select: { storeId: true, items: { select: { quantity: true, unitPrepSeconds: true } } },
      });
      if (cart?.storeId === store.id) workSeconds = this.kitchen.timings(cart.items).workSeconds;
    }

    const slots = await this.kitchen.pickupSlots(store.id, { workSeconds });
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
        brand: { select: { id: true, slug: true, name: true, logoUrl: true } },
      },
    });
    if (!store) throw new NotFoundException('Store not found');

    const view = (await this.availability.evaluate([store])).get(store.id);
    const currentEtaSeconds = view?.currentEtaSeconds ?? store.baseEtaSeconds;

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
      busyMeter: busyMeterOf(store),
      currentEtaSeconds,
      ...availabilityFields(view),
      taxRateBps: store.taxRateBps,
      taxIncludedInPrice: store.taxIncludedInPrice,
      currency: store.currency,
      heroImageUrl: store.heroImageUrl,
      kinds: storeKinds(store.kinds),
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
        // One takeAway look for every brand (owner decision, 2026-10-11):
        // a brand's colours are no longer handed to the storefronts. The
        // column stays, so this line is the rollback; the field stays on
        // the wire as null for the app builds that read it.
        themeOverrides: null,
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
    // with none of them is not shown in this store at all. Nor is one that
    // holds add-ons, which are not ordered on their own.
    const categories = await this.prisma.category.findMany({
      where: { brandId: store.brandId, ...SOLD_ON_ITS_OWN },
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
          kind: c.kind,
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
            categoryKind: c.kind,
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
    // options made of what that store has run out of. Never one the menu
    // leaves out with its category (hidden, or add-ons only).
    const product = await this.prisma.product.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        visible: true,
        category: SOLD_ON_ITS_OWN,
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
        category: { select: { kind: true } },
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
      categoryKind: product.category.kind,
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
        group: m.group,
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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a)));
}
