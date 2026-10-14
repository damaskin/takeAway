import { BrandModerationStatus, OrderStatus, type Prisma } from '@prisma/client';
import { BRAND_LAUNCH_STEPS, brandLaunch } from '@takeaway/utils';

import type { PrismaService } from '../prisma/prisma.service';

/** A store a customer can order from: somewhere to collect the order, and a time it is open. */
export const READY_STORE_WHERE = {
  addressLine: { not: '' },
  workingHours: { some: { isClosed: false } },
} satisfies Prisma.StoreWhereInput;

/**
 * A product customers can see: shown, in a shown category that is sold on
 * its own (not «только как добавка»). It may have no photo — the app shows
 * it as a text row, the website and Telegram with an illustration.
 */
export const LISTED_PRODUCT_WHERE = {
  visible: true,
  category: { visible: true, addOnsOnly: false },
} satisfies Prisma.ProductWhereInput;

/** A product with at least one photo — recommended, not required. */
export const PHOTOGRAPHED_PRODUCT_WHERE = { imageUrls: { isEmpty: false } } satisfies Prisma.ProductWhereInput;

/** An order that went through: a test sale counts, a cancelled or expired one does not. */
export const SOLD_ORDER_WHERE = {
  status: { notIn: [OrderStatus.CANCELLED, OrderStatus.EXPIRED] },
} satisfies Prisma.OrderWhereInput;

/** A store, a menu, payments, moderation — the required steps of «Запуск бренда». */
export const ONBOARDING_STEPS = BRAND_LAUNCH_STEPS.length;

/**
 * Where a brand stands on the launch checklist, from its real data. The rule
 * itself — what is required and when a brand has launched — is
 * `brandLaunch` in `@takeaway/utils`, shared with the admin.
 */
export interface OnboardingProgress {
  /** Recommended: a logo is uploaded. Not counted towards the launch. */
  brandProfile: boolean;
  /** A store with an address and opening hours. */
  store: boolean;
  /** A product customers can see (photo or not). */
  menu: boolean;
  /** Recommended: at least one product has a photo. Not counted towards the launch. */
  photos: boolean;
  approved: boolean;
  /** The brand has an order that was not cancelled or expired. */
  hasOrders: boolean;
  /** Required steps done of {@link ONBOARDING_STEPS}; payments always count, there is nothing to do for them. */
  done: number;
  total: number;
  /** Launched: every required step done and the brand approved — or it has sold already. */
  complete: boolean;
}

export interface OnboardingFacts {
  logoUrl: string | null;
  moderationStatus: BrandModerationStatus;
  readyStores: number;
  listedProducts: number;
  photographedProducts: number;
  hasOrders: boolean;
}

export function progressOf(f: OnboardingFacts): OnboardingProgress {
  const store = f.readyStores > 0;
  const menu = f.listedProducts > 0;
  const approved = f.moderationStatus === BrandModerationStatus.APPROVED;
  return {
    brandProfile: Boolean(f.logoUrl),
    store,
    menu,
    photos: f.photographedProducts > 0,
    approved,
    hasOrders: f.hasOrders,
    ...brandLaunch({ store, menu, approved, hasOrders: f.hasOrders }),
  };
}

/** The facts of one brand, for the owner's checklist. */
export async function onboardingFactsOf(
  prisma: PrismaService,
  brand: { id: string; logoUrl: string | null; moderationStatus: BrandModerationStatus },
): Promise<OnboardingFacts> {
  const [readyStores, listedProducts, photographedProducts, sold] = await Promise.all([
    prisma.store.count({ where: { brandId: brand.id, ...READY_STORE_WHERE } }),
    prisma.product.count({ where: { brandId: brand.id, ...LISTED_PRODUCT_WHERE } }),
    prisma.product.count({ where: { brandId: brand.id, ...PHOTOGRAPHED_PRODUCT_WHERE } }),
    prisma.order.findFirst({ where: { store: { brandId: brand.id }, ...SOLD_ORDER_WHERE }, select: { id: true } }),
  ]);
  return {
    logoUrl: brand.logoUrl,
    moderationStatus: brand.moderationStatus,
    readyStores,
    listedProducts,
    photographedProducts,
    hasOrders: sold !== null,
  };
}

/**
 * The checklist of many brands at once — the platform admin's brands list —
 * in four grouped queries rather than four per brand.
 */
export async function onboardingProgressOf(
  prisma: PrismaService,
  brands: ReadonlyArray<{ id: string; logoUrl: string | null; moderationStatus: BrandModerationStatus }>,
): Promise<Map<string, OnboardingProgress>> {
  const ids = brands.map((b) => b.id);
  if (ids.length === 0) return new Map();
  const [stores, listed, photographed, selling] = await Promise.all([
    prisma.store.groupBy({
      by: ['brandId'],
      where: { brandId: { in: ids }, ...READY_STORE_WHERE },
      _count: { _all: true },
    }),
    prisma.product.groupBy({
      by: ['brandId'],
      where: { brandId: { in: ids }, ...LISTED_PRODUCT_WHERE },
      _count: { _all: true },
    }),
    prisma.product.groupBy({
      by: ['brandId'],
      where: { brandId: { in: ids }, ...PHOTOGRAPHED_PRODUCT_WHERE },
      _count: { _all: true },
    }),
    // The brands with a store that has sold — one row per brand.
    prisma.store.findMany({
      where: { brandId: { in: ids }, orders: { some: SOLD_ORDER_WHERE } },
      distinct: ['brandId'],
      select: { brandId: true },
    }),
  ]);
  const count = (rows: Array<{ brandId: string; _count: { _all: number } }>, id: string) =>
    rows.find((r) => r.brandId === id)?._count._all ?? 0;
  const sold = new Set(selling.map((s) => s.brandId));
  return new Map(
    brands.map((b) => [
      b.id,
      progressOf({
        logoUrl: b.logoUrl,
        moderationStatus: b.moderationStatus,
        readyStores: count(stores, b.id),
        listedProducts: count(listed, b.id),
        photographedProducts: count(photographed, b.id),
        hasOrders: sold.has(b.id),
      }),
    ]),
  );
}
