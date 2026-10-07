import { InjectionToken } from '@angular/core';
import * as L from 'leaflet';

/** Where the shared map gets its tiles. */
export interface MapTilesConfig {
  /** `{z}/{x}/{y}` template of the tile server. */
  url: string;
  /** Asked once for a tile the primary server failed to deliver; null for none. */
  fallbackUrl: string | null;
  /** Credit line the tile licence requires (HTML). */
  attribution: string;
  maxZoom: number;
}

/**
 * Our caching proxy in front of OpenStreetMap (nginx + Cloudflare at
 * takeaway.md/tiles, see docs/map-tiles.md), with OpenStreetMap itself as
 * the fallback. Absolute on purpose: web, TMA, admin and the mobile app ask
 * for each tile at one URL, so Cloudflare and the browser keep one copy.
 */
export const DEFAULT_MAP_TILES: MapTilesConfig = {
  url: 'https://takeaway.md/tiles/{z}/{x}/{y}.png',
  fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap',
  maxZoom: 19,
};

/** Override to point every `lib-leaflet-map` at another tile server. */
export const MAP_TILES = new InjectionToken<MapTilesConfig>('MAP_TILES', {
  providedIn: 'root',
  factory: () => DEFAULT_MAP_TILES,
});

/**
 * A tile layer that asks [fallbackUrl] once for any tile the primary server
 * failed to deliver. Leaflet itself never asks for a failed tile again, so
 * without this one bad answer left a grey square until the map was moved.
 */
export function tileLayerWithFallback(config: MapTilesConfig): L.TileLayer {
  const layer = L.tileLayer(config.url, { maxZoom: config.maxZoom, attribution: config.attribution });
  const fallback = config.fallbackUrl;
  if (fallback) {
    layer.on('tileerror', (event: L.TileErrorEvent) => {
      const tile = event.tile;
      if (tile.dataset['fallback']) return;
      tile.dataset['fallback'] = '1';
      tile.src = L.Util.template(fallback, { x: event.coords.x, y: event.coords.y, z: event.coords.z });
    });
  }
  return layer;
}
