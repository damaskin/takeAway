import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import '../../core/config/env.dart';
import '../../core/network/tile_client.dart';
import '../../core/theme/tokens.dart';
import '../store_kinds.dart';

/// Map tiles — our caching proxy for OpenStreetMap unless the build names
/// another server (see [Env.mapTileUrl]).
///
/// One tile layer per theme and kind of map for the whole app, over one tile
/// provider: building them inside `build` made a new provider, with its own
/// HTTP client, on every rebuild of the map — every pin tap, every keystroke
/// in the store search, every tick of the order status clock.
///
/// Most customers are on mobile data, so:
///  * tiles come through [TileClient] — time limits, retries, OpenStreetMap
///    as the fallback, and no silent blank squares after a dropped
///    connection;
///  * a tile on the phone is used for [_MapTiles.freshFor] without asking
///    the network: OSM's headers often call a tile stale the moment it
///    arrives, so every visit waited on the network for tiles already on
///    disk — and, offline, lost them;
///  * failed tiles are asked for again by themselves once the network is
///    back ([_MapTiles.recover]); a map used to stay grey until dragged, and
///    the order status map cannot be dragged.
///
/// [interactive] false is for small maps that cannot be moved: no tiles are
/// fetched beyond their edges.
TileLayer mapTiles(BuildContext context, {bool interactive = true}) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  return switch ((dark, interactive)) {
    (false, true) => _MapTiles.light,
    (true, true) => _MapTiles.dark,
    (false, false) => _MapTiles.staticLight,
    (true, false) => _MapTiles.staticDark,
  };
}

abstract final class _MapTiles {
  /// How long a downloaded tile is shown without asking the network again.
  static const freshFor = Duration(days: 30);

  static final _client = TileClient(
    fallback: switch (Env.mapTileFallbackUrl) {
      final to? when to != Env.mapTileUrl => TileUrlFallback(from: Env.mapTileUrl, to: to),
      _ => null,
    },
  );

  static final _provider = _SharedTileProvider(
    httpClient: _client,
    cachingProvider: BuiltInMapCachingProvider.getOrCreateInstance(
      maxCacheSize: 200 * 1024 * 1024,
      overrideFreshAge: freshFor,
    ),
  );

  /// Tells every map to drop its tiles and ask again — failed ones included.
  static final _reset = StreamController<void>.broadcast();

  static final light = _layer(dark: false, panBuffer: 1);
  static final dark = _layer(dark: true, panBuffer: 1);
  static final staticLight = _layer(dark: false, panBuffer: 0);
  static final staticDark = _layer(dark: true, panBuffer: 0);

  static TileLayer _layer({required bool dark, required int panBuffer}) => TileLayer(
    urlTemplate: Env.mapTileUrl,
    // Identifies the app to OpenStreetMap, as its tile policy asks, when the
    // fallback goes there.
    userAgentPackageName: 'md.takeaway.app',
    tileProvider: _provider,
    tileBuilder: dark ? darkModeTileBuilder : null,
    panBuffer: panBuffer,
    reset: _reset.stream,
    // A failed tile is also dropped once off screen, so coming back to it
    // asks again instead of keeping the gap.
    evictErrorTileStrategy: EvictErrorTileStrategy.notVisibleRespectMargin,
    errorTileCallback: _onTileError,
  );

  static int _logged = 0;
  static bool _recovering = false;

  static void _onTileError(TileImage tile, Object error, StackTrace? stack) {
    // Only the first few: offline, every tile on screen fails at once.
    if (++_logged <= 5) debugPrint('Map tile ${tile.coordinates} failed to load: $error');
    unawaited(recover(_provider.getTileUrl(tile.coordinates, light)));
  }

  /// Asks for one failed tile every so often; once it comes back, every map
  /// asks again for what it is missing. Gives up after a few minutes —
  /// dragging the map still asks again for what comes into view.
  static Future<void> recover(String url) async {
    if (_recovering) return;
    _recovering = true;
    try {
      for (final wait in const [3, 6, 12, 24, 30, 30, 30, 30]) {
        await Future<void>.delayed(Duration(seconds: wait));
        try {
          final probe = await _client.get(Uri.parse(url), headers: _provider.headers);
          if (probe.statusCode >= 400) continue;
        } on Object {
          continue;
        }
        // Let tiles still on the wire land first: a reset aborts them, and a
        // tile aborted under a new request for the same URL comes back blank.
        for (var i = 0; i < 20 && _client.inFlight > 0; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 500));
        }
        _logged = 0;
        _reset.add(null);
        return;
      }
    } finally {
      _recovering = false;
    }
  }
}

/// A [NetworkTileProvider] that outlives the maps using it. A tile layer
/// disposes its provider when its map goes away, which closes the HTTP
/// client; this one is shared app-wide, so it keeps its client open.
class _SharedTileProvider extends NetworkTileProvider {
  _SharedTileProvider({required http.Client super.httpClient, required super.cachingProvider});

  @override
  Future<void> dispose() async {}
}

/// Who serves the tiles, as their terms require.
Widget mapAttribution() => SimpleAttributionWidget(source: Text(Env.mapTileAttribution));

/// Pin in brand colours, showing what the store sells (see
/// [storePinIcons]); [highlighted] grows it for the selected store.
class StorePin extends StatelessWidget {
  const StorePin({this.color, this.highlighted = false, this.kinds = const {StoreKind.coffee}, super.key});

  final Color? color;
  final bool highlighted;
  final Set<StoreKind> kinds;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final fill = color ?? brand.caramel;
    final icons = storePinIcons(kinds);
    final badge = icons.badge;
    return AnimatedScale(
      scale: highlighted ? 1.25 : 1,
      duration: Motion.medium,
      curve: Curves.easeOutBack,
      alignment: Alignment.bottomCenter,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox.square(
            dimension: 38,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: fill,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 3),
                    boxShadow: brand.softShadow,
                  ),
                  child: Icon(icons.icon, color: Colors.white, size: 19),
                ),
                // A store selling food as well: the fork and knife on a white
                // disc over the pin's edge, in the pin's own colour, so a
                // closed store's badge greys out with it.
                if (badge != null)
                  Positioned(
                    right: -4,
                    bottom: -2,
                    child: Container(
                      width: 18,
                      height: 18,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        border: Border.all(color: fill, width: 1.5),
                      ),
                      child: Icon(badge, color: fill, size: 11),
                    ),
                  ),
              ],
            ),
          ),
          CustomPaint(size: const Size(12, 7), painter: _TailPainter(fill)),
        ],
      ),
    );
  }
}

class _TailPainter extends CustomPainter {
  _TailPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final path = ui.Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_TailPainter old) => old.color != color;
}

class UserDot extends StatelessWidget {
  const UserDot({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 20,
      height: 20,
      decoration: BoxDecoration(
        color: const Color(0xFF2F80ED),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: [BoxShadow(color: const Color(0xFF2F80ED).withValues(alpha: 0.35), blurRadius: 10, spreadRadius: 4)],
      ),
    );
  }
}

/// Small non-interactive map centred on one store.
class StaticStoreMap extends StatelessWidget {
  const StaticStoreMap({required this.lat, required this.lng, this.user, this.height = 160, super.key});

  final double lat;
  final double lng;
  final LatLng? user;
  final double height;

  @override
  Widget build(BuildContext context) {
    final store = LatLng(lat, lng);
    final fitBoth = user != null && const Distance().as(LengthUnit.Kilometer, store, user!) < 20;
    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(Radii.input),
        child: FlutterMap(
          options: MapOptions(
            initialCenter: store,
            initialZoom: 16,
            initialCameraFit: fitBoth
                ? CameraFit.coordinates(coordinates: [store, user!], padding: const EdgeInsets.all(48), maxZoom: 17)
                : null,
            interactionOptions: const InteractionOptions(flags: InteractiveFlag.none),
          ),
          children: [
            mapTiles(context, interactive: false),
            MarkerLayer(
              markers: [
                if (fitBoth) Marker(point: user!, width: 24, height: 24, child: const UserDot()),
                Marker(point: store, width: 44, height: 52, alignment: Alignment.topCenter, child: const StorePin()),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
