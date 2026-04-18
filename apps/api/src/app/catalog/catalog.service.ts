import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { ListStoresQueryDto } from './dto/list-stores-query.dto';
import type { MenuDto } from './dto/product.dto';
import type { ProductDetailDto } from './dto/product.dto';
import type { StoreDetailDto, StoreListItemDto } from './dto/store.dto';

const EARTH_RADIUS_METERS = 6371000;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listStores(query: ListStoresQueryDto): Promise<StoreListItemDto[]> {
    const stores = await this.prisma.store.findMany({
      where: { status: { not: 'CLOSED' } },
      orderBy: [{ currentEtaSeconds: 'asc' }, { name: 'asc' }],
    });

    const hasPoint = typeof query.lat === 'number' && typeof query.lng === 'number';
    const radius = query.radius ?? 5000;

    return stores
      .map((s) => ({
        id: s.id,
        brandId: s.brandId,
        slug: s.slug,
        name: s.name,
        addressLine: s.addressLine,
        city: s.city,
        country: s.country,
        latitude: s.latitude,
        longitude: s.longitude,
        status: s.status,
        fulfillmentTypes: s.fulfillmentTypes,
        pickupPointType: s.pickupPointType,
        busyMeter: s.busyMeter,
        currentEtaSeconds: s.currentEtaSeconds,
        currency: s.currency,
        heroImageUrl: s.heroImageUrl,
        distanceMeters: hasPoint ? haversineMeters(query.lat!, query.lng!, s.latitude, s.longitude) : null,
      }))
      .filter((s) => !hasPoint || (s.distanceMeters ?? Infinity) <= radius)
      .sort((a, b) => {
        if (a.distanceMeters !== null && b.distanceMeters !== null) return a.distanceMeters - b.distanceMeters;
        return a.currentEtaSeconds - b.currentEtaSeconds;
      });
  }

  async getStore(idOrSlug: string): Promise<StoreDetailDto> {
    const store = await this.prisma.store.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { workingHours: { orderBy: { weekday: 'asc' } } },
    });
    if (!store) throw new NotFoundException('Store not found');

    return {
      id: store.id,
      brandId: store.brandId,
      slug: store.slug,
      name: store.name,
      addressLine: store.addressLine,
      city: store.city,
      country: store.country,
      latitude: store.latitude,
      longitude: store.longitude,
      status: store.status,
      fulfillmentTypes: store.fulfillmentTypes,
      pickupPointType: store.pickupPointType,
      busyMeter: store.busyMeter,
      currentEtaSeconds: store.currentEtaSeconds,
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
    };
  }

  async getMenu(storeIdOrSlug: string): Promise<MenuDto> {
    const store = await this.prisma.store.findFirst({
      where: { OR: [{ id: storeIdOrSlug }, { slug: storeIdOrSlug }] },
      select: { id: true, slug: true, brandId: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    const stopListEntries = await this.prisma.stopListEntry.findMany({
      where: { storeId: store.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { productId: true },
    });
    const stopList = new Set(stopListEntries.map((e) => e.productId));

    const categories = await this.prisma.category.findMany({
      where: { brandId: store.brandId, visible: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          where: { visible: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return {
      storeId: store.id,
      storeSlug: store.slug,
      categories: categories.map((c) => ({
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

  async getProduct(idOrSlug: string): Promise<ProductDetailDto> {
    const product = await this.prisma.product.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], visible: true },
      include: {
        variations: { orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] },
        modifiers: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    return {
      id: product.id,
      categoryId: product.categoryId,
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
      variations: product.variations.map((v) => ({
        id: v.id,
        type: v.type,
        name: v.name,
        priceDeltaCents: v.priceDeltaCents,
        prepTimeDeltaSeconds: v.prepTimeDeltaSeconds,
        sortOrder: v.sortOrder,
        isDefault: v.isDefault,
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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a)));
}
