/**
 * What a store sells, as the API's `kinds` lists it. Same values as
 * `StoreKind` in shared-types, spelled out here so a store from an API that
 * predates the field still type-checks.
 */
export type StoreSells = 'COFFEE' | 'FOOD';

/** The kind filter on the stores map: every store, or the ones selling one kind. */
export type StoreKindFilter = 'ALL' | StoreSells;

const KNOWN_KINDS: readonly StoreSells[] = ['COFFEE', 'FOOD'];

/**
 * What the store sells, coffee first. A store from an API without the field,
 * or one whose business has not said, counts as a coffee shop: that is what
 * every store on the platform was before food came in.
 */
export function storeKinds(store: { id: string; kinds?: readonly string[] | null }): StoreSells[] {
  const kinds = KNOWN_KINDS.filter((kind) => store.kinds?.includes(kind));
  return kinds.length > 0 ? kinds : ['COFFEE'];
}

/** True when the store belongs under the chip: everything for `ALL`, else the kind it sells. */
export function storeMatchesKind(
  store: { id: string; kinds?: readonly string[] | null },
  filter: StoreKindFilter,
): boolean {
  return filter === 'ALL' || storeKinds(store).includes(filter);
}
