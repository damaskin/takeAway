import { BrandModerationStatus, type Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';

/** A store a customer can order from: somewhere to collect the order, and a time it is open. */
export const READY_STORE_WHERE = {
  addressLine: { not: '' },
  workingHours: { some: { isClosed: false } },
} satisfies Prisma.StoreWhereInput;

/** A product with at least one photo. */
export const PHOTOGRAPHED_PRODUCT_WHERE = { imageUrls: { isEmpty: false } } satisfies Prisma.ProductWhereInput;

/** Brand details, a store, a menu, payments, moderation — the «Запуск бренда» checklist. */
export const ONBOARDING_STEPS = 5;

/** Where a brand stands on the launch checklist, from its real data. */
export interface OnboardingProgress {
  /** A logo is uploaded. */
  brandProfile: boolean;
  /** A store with an address and opening hours. */
  store: boolean;
  /** A category and a product with a photo. */
  menu: boolean;
  approved: boolean;
  /** Steps done of {@link ONBOARDING_STEPS}; payments always count, there is nothing to do for them. */
  done: number;
  total: number;
  /** Every step done and the brand approved: it has launched. */
  complete: boolean;
}

export interface OnboardingFacts {
  logoUrl: string | null;
  moderationStatus: BrandModerationStatus;
  readyStores: number;
  categories: number;
  photographedProducts: number;
}

export function progressOf(f: OnboardingFacts): OnboardingProgress {
  const brandProfile = Boolean(f.logoUrl);
  const store = f.readyStores > 0;
  const menu = f.categories > 0 && f.photographedProducts > 0;
  const approved = f.moderationStatus === BrandModerationStatus.APPROVED;
  const done = [brandProfile, store, menu, true, approved].filter(Boolean).length;
  return { brandProfile, store, menu, approved, done, total: ONBOARDING_STEPS, complete: done === ONBOARDING_STEPS };
}

/**
 * The checklist of many brands at once — the platform admin's brands list —
 * in three grouped queries rather than three per brand.
 */
export async function onboardingProgressOf(
  prisma: PrismaService,
  brands: ReadonlyArray<{ id: string; logoUrl: string | null; moderationStatus: BrandModerationStatus }>,
): Promise<Map<string, OnboardingProgress>> {
  const ids = brands.map((b) => b.id);
  if (ids.length === 0) return new Map();
  const [stores, categories, products] = await Promise.all([
    prisma.store.groupBy({
      by: ['brandId'],
      where: { brandId: { in: ids }, ...READY_STORE_WHERE },
      _count: { _all: true },
    }),
    prisma.category.groupBy({ by: ['brandId'], where: { brandId: { in: ids } }, _count: { _all: true } }),
    prisma.product.groupBy({
      by: ['brandId'],
      where: { brandId: { in: ids }, ...PHOTOGRAPHED_PRODUCT_WHERE },
      _count: { _all: true },
    }),
  ]);
  const count = (rows: Array<{ brandId: string; _count: { _all: number } }>, id: string) =>
    rows.find((r) => r.brandId === id)?._count._all ?? 0;
  return new Map(
    brands.map((b) => [
      b.id,
      progressOf({
        logoUrl: b.logoUrl,
        moderationStatus: b.moderationStatus,
        readyStores: count(stores, b.id),
        categories: count(categories, b.id),
        photographedProducts: count(products, b.id),
      }),
    ]),
  );
}
