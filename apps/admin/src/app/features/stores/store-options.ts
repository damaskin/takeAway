import type { LatLng } from '@takeaway/ui-kit';

/** Currencies a store can take, the launch markets' first. Mirrors the API's Currency enum. */
export const STORE_CURRENCIES = ['MDL', 'RUP', 'EUR', 'USD', 'GBP', 'AED', 'THB', 'IDR'] as const;

/** Mirrors STORE_SLUG_PATTERN on the API: it becomes the /stores/<slug> URL. */
export const STORE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where the map opens when a store has no location yet. */
export const CHISINAU: LatLng = { lat: 47.0105, lng: 28.8638 };

/** Moldovan and Transnistrian brands are almost always in MD. */
export function defaultCountryFor(currency: string | null | undefined): string {
  return currency === 'MDL' || currency === 'RUP' ? 'MD' : '';
}
