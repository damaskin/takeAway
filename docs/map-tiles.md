# Map tiles

Every map in takeAway — the stores map and the order status map in the
Flutter app, the shared `lib-leaflet-map` in web, TMA and admin — draws
OpenStreetMap tiles. Since October 2026 they come through our own cache:

```
phone / browser ──► Cloudflare edge ──► takeaway-nginx (proxy_cache, 30 days) ──► tile.openstreetmap.org
                    (caches .png)        https://takeaway.md/tiles/{z}/{x}/{y}.png
```

## Why

Owner's report after app 1.2.0: "the map loads badly, worse than before".
What was measured (Android emulator against production, flutter_map 8.3.2):

- **Tiles on the phone were asked for again on every visit.** OSM's CDN sends
  `Cache-Control: max-age=…` together with an `Age` that is often already
  larger, so flutter_map's disk cache stores the tile as stale on arrival. On
  a second visit 19 of 24 street-level tiles of central Tiraspol went back to
  the network (`304`); offline, those squares stayed empty although the tiles
  were on disk.
- **A dropped connection left a permanent hole.** flutter_map treats a
  `ClientException` mentioning "closed" ("Connection closed before full header
  was received" — a kept-alive socket that died with the radio) as a disposed
  map and "loads" a transparent tile: no error, no retry, nothing in the log.
  1.2.0 shared one HTTP client for the whole app session, so kept-alive
  connections are reused much more than before.
- **No time limit, no retry, no recovery.** A tile that failed (a few seconds
  without signal) stayed grey until the map was dragged; the order status map
  cannot be dragged. Reproduced: three seconds offline while opening a store
  left the whole map grey for good.
- **Every phone asked OSM itself**, on mobile data, opening dozens of fresh
  TLS connections per screen. OSM's public servers are a shared resource with
  a usage policy, not a CDN for apps.
- 1.2.0 also fits the camera to all stores once they load. Production lists
  the demo stores in London and Dubai, so the stores map now opens at world
  zoom, and zooming in to Tiraspol loads tiles at every level on the way.

## Server: `/tiles/` on takeaway.md

`deploy/nginx/snippets/tiles.conf` (included in `conf.d/10-web.conf`) and the
cache zone in `conf.d/05-tile-cache.conf`:

- only `GET /tiles/{z}/{x}/{y}.png` with z 0–19 and numeric x, y; anything
  else is a 404;
- tiles are fetched from `tile.openstreetmap.org` with our own User-Agent
  (`takeaway.md-tile-cache/1.0 (+https://takeaway.md)`) and none of the
  visitor's headers, then kept for 30 days (`max_size` 2 GB, evicted after 60
  days unused). After 30 days a tile is revalidated in the background while
  the old one is served; while OSM errors, times out or throttles us (429),
  the cached tile is served;
- concurrent misses for one tile become one request to OSM
  (`proxy_cache_lock`);
- clients get a week (`Cache-Control: public, max-age=604800`, plus a day of
  `stale-while-revalidate` and a month of `stale-if-error`) — in browsers and
  at Cloudflare's edge, which caches `.png` by default. OSM's own `Age`,
  `Expires` and CDN headers are dropped;
- `X-Cache-Status: HIT|MISS|EXPIRED|STALE|UPDATING` tells where a tile came
  from; `Access-Control-Allow-Origin: *` so any of our origins may use it.

The cache lives in the named volume `tile_cache` (`docker-compose.prod.yml`),
so recreating the nginx container keeps it.

### Getting it to production

Nothing manual. A push to `main` runs `deploy.sh`, which checks out the repo
(the nginx config is bind-mounted from it), runs `compose up -d … nginx` —
the new volume recreates the container — and reloads the shared edge, as for
any nginx change. `smoke-test.sh` then asks for `/tiles/0/0/0.png` through
the local stack: a 404 or a non-PNG fails the deploy (our config is broken), a
5xx only warns (OSM unreachable, not this deploy's fault).

Order matters only one way: the server must answer before clients rely on
it. The web apps ship in the same deploy; the mobile app reaches stores days
later. And every client falls back to OSM (below) if the proxy fails.

### Operations

```bash
# Is it caching? (from anywhere)
curl -sI https://takeaway.md/tiles/15/18982/11541.png | grep -i -E 'x-cache-status|cf-cache-status|cache-control'

# Cache size on the server
docker exec takeaway-nginx-1 du -sh /var/cache/nginx/tiles

# Drop the cache (e.g. after changing the tile source): remove the files, keep the volume
docker exec takeaway-nginx-1 sh -c 'rm -rf /var/cache/nginx/tiles/*' && docker exec takeaway-nginx-1 nginx -s reload
```

Cloudflare keeps its own copy for up to a week; purge `takeaway.md/tiles/*`
in the Cloudflare dashboard if a change must show at once.

### OSM tile policy

<https://operations.osmfoundation.org/policies/tiles/> — a caching proxy is
the recommended way to use the public servers: one identifiable client, long
local caching, no bulk downloads. Keep the attribution ("© OpenStreetMap")
visible on every map. If traffic ever grows to where OSM asks us to stop, point
the proxy at a commercial source (MapTiler, Stadia, Thunderforest — keyed URL
in `proxy_pass`, the key never leaves the server) and the apps need no change.

## Clients

### Flutter app

`lib/shared/widgets/store_map.dart` + `lib/core/network/tile_client.dart`.

| Define                  | Default                                          | Meaning                                       |
| ----------------------- | ------------------------------------------------ | --------------------------------------------- |
| `MAP_TILE_URL`          | `https://takeaway.md/tiles/{z}/{x}/{y}.png`      | Primary tile server                           |
| `MAP_TILE_FALLBACK_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Asked when the primary fails; `none` disables |
| `MAP_TILE_ATTRIBUTION`  | `OpenStreetMap`                                  | Credit line on every map                      |

- **TileClient** (wraps flutter_map's HTTP client): 15 s without an answer
  (or between body chunks) aborts the request; dropped connections,
  timeouts, 408/425/429/5xx are retried after 1 s, 2 s, 4 s; the third attempt
  goes to the fallback (a 404/403 from the primary goes there at once). A tile
  that fails everywhere is reported as an error — never as a blank success.
  Requests flutter_map aborts (tile went off screen) are not retried.
- **Disk cache:** flutter_map's built-in cache, 200 MB, every tile kept 30
  days regardless of the server's headers. A second visit — or one without
  signal — draws from disk.
- **Recovery:** after a failed tile the app asks for it again at 3 s, 6 s,
  12 s, … (about three minutes in all); once it comes back every map reloads
  its missing tiles. Dragging the map still retries what comes into view.
- The order status map (cannot be moved) fetches no tiles beyond its edges.

### Web, TMA, admin

`libs/ui-kit/src/lib/leaflet-map/map-tiles.ts`: the `MAP_TILES` injection
token (default: the proxy, OSM as fallback, `maxZoom` 19) and
`tileLayerWithFallback`, which asks the fallback once for a tile the proxy
failed to deliver — Leaflet itself never retries a failed tile. Provide
`MAP_TILES` in an app's config to use another server.
