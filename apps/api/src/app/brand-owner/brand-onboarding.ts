import { BrandModerationStatus, OrderStatus, type Prisma } from '@prisma/client';
import { BRAND_LAUNCH_STEPS, brandLaunch } from '@takeaway/utils';

import { ProductOptionGroupsService } from '../option-groups/product-option-groups.service';
import { hasSection } from '../payments/terminals/payment-terminals.service';
import type { PrismaService } from '../prisma/prisma.service';

/** A store a customer can order from: somewhere to collect the order, and a time it is open. */
export const READY_STORE_WHERE = {
  addressLine: { not: '' },
  workingHours: { some: { isClosed: false } },
} satisfies Prisma.StoreWhereInput;

/**
 * A product customers could see as far as the menu goes: shown, in a shown
 * category that is sold on its own (not «только как добавка»). It may have
 * no photo — the app shows it as a text row, the website and Telegram with
 * an illustration. It also needs a variant and an add-on (owner,
 * 2026-11-18), which a `where` cannot say: {@link listedProductCounts}.
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
  /** A product customers can see (photo or not): listed, with a variant and an add-on. */
  menu: boolean;
  /** Recommended: at least one product has a photo. Not counted towards the launch. */
  photos: boolean;
  /** The brand's own payment terminal is connected (docs/agroprombank-payments.md §13). */
  payments: boolean;
  approved: boolean;
  /** The brand has an order that was not cancelled or expired. */
  hasOrders: boolean;
  /** Required steps done of {@link ONBOARDING_STEPS}. */
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
  /** An active terminal of the brand with at least one complete section. */
  paymentTerminal: boolean;
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
    payments: f.paymentTerminal,
    approved,
    hasOrders: f.hasOrders,
    ...brandLaunch({ store, menu, payments: f.paymentTerminal, approved, hasOrders: f.hasOrders }),
  };
}

/** The facts of one brand, for the owner's checklist. */
export async function onboardingFactsOf(
  prisma: PrismaService,
  brand: { id: string; logoUrl: string | null; moderationStatus: BrandModerationStatus },
): Promise<OnboardingFacts> {
  const [readyStores, listed, photographedProducts, sold, terminals] = await Promise.all([
    prisma.store.count({ where: { brandId: brand.id, ...READY_STORE_WHERE } }),
    listedProductCounts(prisma, [brand.id]),
    prisma.product.count({ where: { brandId: brand.id, ...PHOTOGRAPHED_PRODUCT_WHERE } }),
    prisma.order.findFirst({ where: { store: { brandId: brand.id }, ...SOLD_ORDER_WHERE }, select: { id: true } }),
    prisma.paymentTerminal.findMany({ where: { brandId: brand.id, retiredAt: null } }),
  ]);
  return {
    logoUrl: brand.logoUrl,
    moderationStatus: brand.moderationStatus,
    readyStores,
    listedProducts: listed.get(brand.id) ?? 0,
    photographedProducts,
    paymentTerminal: terminals.some(terminalConnected),
    hasOrders: sold !== null,
  };
}

/** A terminal that takes money for at least one flow. */
function terminalConnected(row: Parameters<typeof hasSection>[0]): boolean {
  return hasSection(row, 'card') || hasSection(row, 'web') || hasSection(row, 'qr');
}

/**
 * Per brand, the products customers can see: listed ({@link
 * LISTED_PRODUCT_WHERE}) and offering a variant and an add-on — the rule the
 * API applies to every menu (`offersVariantAndAddon`), read through the same
 * builder. A brand with none is absent.
 */
export async function listedProductCounts(
  prisma: PrismaService,
  brandIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (brandIds.length === 0) return counts;
  const products = await prisma.product.findMany({
    where: { brandId: { in: [...brandIds] }, ...LISTED_PRODUCT_WHERE },
    select: { id: true, brandId: true },
  });
  const shown = await new ProductOptionGroupsService(prisma).offeringVariantAndAddon(products);
  for (const p of products) if (shown.has(p.id)) counts.set(p.brandId, (counts.get(p.brandId) ?? 0) + 1);
  return counts;
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
  const [stores, listed, photographed, selling, terminals] = await Promise.all([
    prisma.store.groupBy({
      by: ['brandId'],
      where: { brandId: { in: ids }, ...READY_STORE_WHERE },
      _count: { _all: true },
    }),
    listedProductCounts(prisma, ids),
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
    prisma.paymentTerminal.findMany({ where: { brandId: { in: ids }, retiredAt: null } }),
  ]);
  const count = (rows: Array<{ brandId: string; _count: { _all: number } }>, id: string) =>
    rows.find((r) => r.brandId === id)?._count._all ?? 0;
  const sold = new Set(selling.map((s) => s.brandId));
  const paying = new Set(terminals.filter(terminalConnected).map((t) => t.brandId));
  return new Map(
    brands.map((b) => [
      b.id,
      progressOf({
        logoUrl: b.logoUrl,
        moderationStatus: b.moderationStatus,
        readyStores: count(stores, b.id),
        listedProducts: listed.get(b.id) ?? 0,
        photographedProducts: count(photographed, b.id),
        paymentTerminal: paying.has(b.id),
        hasOrders: sold.has(b.id),
      }),
    ]),
  );
}
