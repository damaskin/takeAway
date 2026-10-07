import * as L from 'leaflet';

import { DEFAULT_MAP_TILES, tileLayerWithFallback } from './map-tiles';

describe('map tiles', () => {
  const coords = Object.assign(L.point(4, 5), { z: 3 }) as L.Coords;

  function fail(layer: L.TileLayer, tile: HTMLImageElement): void {
    layer.fire('tileerror', { tile, coords, error: new Error('502') });
  }

  it('come from our cache, with OpenStreetMap as the fallback', () => {
    expect(DEFAULT_MAP_TILES.url).toBe('https://takeaway.md/tiles/{z}/{x}/{y}.png');
    expect(DEFAULT_MAP_TILES.fallbackUrl).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });

  it('asks the fallback once for a tile that failed', () => {
    const layer = tileLayerWithFallback(DEFAULT_MAP_TILES);
    const tile = document.createElement('img');
    tile.src = 'https://takeaway.md/tiles/3/4/5.png';

    fail(layer, tile);
    expect(tile.src).toBe('https://tile.openstreetmap.org/3/4/5.png');

    // The fallback failing too is final: no loop between the two.
    tile.src = 'about:blank';
    fail(layer, tile);
    expect(tile.src).toBe('about:blank');
  });

  it('leaves a failed tile alone without a fallback', () => {
    const layer = tileLayerWithFallback({ ...DEFAULT_MAP_TILES, fallbackUrl: null });
    const tile = document.createElement('img');
    tile.src = 'https://takeaway.md/tiles/3/4/5.png';

    fail(layer, tile);
    expect(tile.src).toBe('https://takeaway.md/tiles/3/4/5.png');
  });
});
