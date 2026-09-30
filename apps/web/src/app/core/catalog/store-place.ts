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
