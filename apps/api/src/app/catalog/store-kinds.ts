import type { Prisma, StoreKind } from '@prisma/client';

/**
 * What a store sells, as the public API sends it: never empty. Every store
 * was a coffee shop before kinds existed, and the column defaults to that,
 * so an empty list — which the admin does not allow — still reads as coffee.
 */
export function storeKinds(kinds: readonly StoreKind[] | null | undefined): StoreKind[] {
  return kinds && kinds.length > 0 ? [...kinds] : ['COFFEE'];
}

/** The `?kind=` filter of the store list, with the same "empty is coffee" rule. */
export function storeKindWhere(kind: StoreKind | undefined): Prisma.StoreWhereInput {
  if (!kind) return {};
  if (kind === 'COFFEE') return { OR: [{ kinds: { has: 'COFFEE' } }, { kinds: { isEmpty: true } }] };
  return { kinds: { has: kind } };
}
