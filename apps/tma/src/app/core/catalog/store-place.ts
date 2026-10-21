import type { StoreListItem } from '@takeaway/shared-types';

/** A field a café left as a dash or blank — «—» is what a POS import writes. */
const PLACEHOLDER = /^[\s\-–—.]*$/;

/**
 * «Ленина 1, Тирасполь», or an empty string while the café has not filled
 * its address in: printing the dashes it has instead reads as broken.
 */
export function storeAddress(store: Pick<StoreListItem, 'addressLine' | 'city'>): string {
  return [store.addressLine, store.city]
    .map((part) => (part ?? '').trim())
    .filter((part) => !PLACEHOLDER.test(part))
    .join(', ');
}

/**
 * False for a store still sitting at the 0,0 a new store starts with: a pin
 * there lands in the Gulf of Guinea and drags the map over to Africa.
 */
export function hasLocation(store: Pick<StoreListItem, 'latitude' | 'longitude'>): boolean {
  const { latitude: lat, longitude: lng } = store;
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/** Every word of the query is in the store's name or address, in any case; an empty query keeps all. */
export function storeMatchesQuery(store: Pick<StoreListItem, 'name' | 'addressLine' | 'city'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${store.name} ${storeAddress(store)}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * Nearest first; stores without a distance keep the API's order after those
 * with one. Stable, so `sortStoresByAvailability` over it still puts the
 * stores that take orders first, the nearest first within each group.
 */
export function sortStoresByDistance<T extends { distanceMeters: number | null }>(stores: readonly T[]): T[] {
  return stores
    .map((store, index) => ({ store, index }))
    .sort((a, b) => (a.store.distanceMeters ?? Infinity) - (b.store.distanceMeters ?? Infinity) || a.index - b.index)
    .map((entry) => entry.store);
}
