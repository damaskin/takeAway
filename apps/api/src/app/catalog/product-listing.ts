import type { Prisma } from '@prisma/client';

/**
 * Lists every product of the brand in a store — what a new store starts
 * with, so opening a second café does not mean ticking every product again.
 * The owner narrows it down afterwards from the product form.
 */
export async function listBrandMenuInStore(
  db: Prisma.TransactionClient,
  storeId: string,
  brandId: string,
): Promise<void> {
  const products = await db.product.findMany({ where: { brandId }, select: { id: true } });
  if (products.length === 0) return;
  await db.productStore.createMany({
    data: products.map((p) => ({ productId: p.id, storeId })),
    skipDuplicates: true,
  });
}

/** Ids of every store of the brand — where a product goes when nobody picked. */
export async function brandStoreIds(db: Prisma.TransactionClient, brandId: string): Promise<string[]> {
  const stores = await db.store.findMany({ where: { brandId }, select: { id: true } });
  return stores.map((s) => s.id);
}

/** What the admin reads of a product's listing: the ids of the stores selling it. */
export const LISTING_INCLUDE = { stores: { select: { storeId: true } } } as const satisfies Prisma.ProductInclude;

/** A product row with `stores` swapped for the plain `storeIds` list the admin works with. */
export function withStoreIds<T extends { stores: ReadonlyArray<{ storeId: string }> }>(
  row: T,
): Omit<T, 'stores'> & { storeIds: string[] } {
  const { stores, ...rest } = row;
  return { ...rest, storeIds: stores.map((s) => s.storeId) };
}
