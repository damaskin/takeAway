import * as L from 'leaflet';

/** What a store sells: same values as `StoreKind` in shared-types. */
export type StorePinSells = 'COFFEE' | 'FOOD';

/** Which pin a store gets on the map. */
export type StorePinKind = 'coffee' | 'food' | 'both';

/**
 * 24×24 glyphs (Material Icons, Apache 2.0) for what a store sells. The pins
 * draw them, and the pages draw the same ones on their «Кофе / Еда» chips so
 * the chips read as the map's legend.
 */
export const STORE_KIND_GLYPHS: Readonly<Record<StorePinSells, string>> = {
  // local_cafe
  COFFEE:
    'M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z',
  // restaurant
  FOOD: 'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z',
};

const PIN_FILL = 'var(--color-caramel, #c8702d)';

/**
 * The pin for a store selling [sells]: a cup for coffee, a fork and knife
 * for food, both side by side for a place that sells both. A store that has
 * not said what it sells is a coffee shop.
 */
export function storePinKind(sells: readonly StorePinSells[]): StorePinKind {
  const coffee = sells.includes('COFFEE');
  const food = sells.includes('FOOD');
  if (coffee && food) return 'both';
  return food ? 'food' : 'coffee';
}

/** Leaflet icon for a store pin; see {@link storePinKind}. */
export function storePinIcon(kind: StorePinKind): L.DivIcon {
  if (kind === 'both') {
    return L.divIcon({
      className: 'lib-store-pin lib-store-pin--both',
      iconSize: [48, 40],
      iconAnchor: [24, 40],
      html: `<svg width="48" height="40" viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0h18a15 15 0 0 1 0 30h-4l-5 10-5-10h-4a15 15 0 0 1 0-30z" fill="${PIN_FILL}"/>
        <rect x="3" y="3" width="42" height="24" rx="12" fill="#fff"/>
        ${glyph('COFFEE', 8, 7, 16)}
        ${glyph('FOOD', 24, 7, 16)}
      </svg>`,
    });
  }
  return L.divIcon({
    className: `lib-store-pin lib-store-pin--${kind}`,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
    html: `<svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C7.2 0 0 7.2 0 16c0 11 16 26 16 26s16-15 16-26C32 7.2 24.8 0 16 0z" fill="${PIN_FILL}"/>
      <circle cx="16" cy="16" r="11.5" fill="#fff"/>
      ${glyph(kind === 'food' ? 'FOOD' : 'COFFEE', 8, 8, 16)}
    </svg>`,
  });
}

function glyph(kind: StorePinSells, x: number, y: number, size: number): string {
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" data-glyph="${kind}">
    <path d="${STORE_KIND_GLYPHS[kind]}" fill="${PIN_FILL}"/>
  </svg>`;
}
