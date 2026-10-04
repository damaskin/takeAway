import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/config/env.dart';
import '../../core/theme/tokens.dart';

/// Map tiles — OpenStreetMap unless the build names another server (see
/// [Env.mapTileUrl]). The OSM tile policy asks for a real user agent.
///
/// One tile layer per theme for the whole app, sharing one tile provider:
/// building them inside `build` made a new provider, with its own HTTP
/// client, on every rebuild of the map — every pin tap and every keystroke
/// in the store search.
TileLayer mapTiles(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark ? _MapTiles.dark : _MapTiles.light;

abstract final class _MapTiles {
  static final _provider = _SharedTileProvider();
  static final light = _layer(dark: false);
  static final dark = _layer(dark: true);

  static TileLayer _layer({required bool dark}) => TileLayer(
    urlTemplate: Env.mapTileUrl,
    userAgentPackageName: 'md.takeaway.app',
    tileProvider: _provider,
    tileBuilder: dark ? darkModeTileBuilder : null,
    // A tile that failed (flaky mobile data) is dropped once off screen, so
    // coming back to it asks the server again instead of keeping the gap.
    evictErrorTileStrategy: EvictErrorTileStrategy.notVisibleRespectMargin,
    errorTileCallback: _logTileError,
  );

  static int _tileErrors = 0;

  /// Failed tiles go to the log — a blank map was otherwise silent. Only the
  /// first few: offline, every tile on screen fails at once.
  static void _logTileError(TileImage tile, Object error, StackTrace? stack) {
    if (++_tileErrors > 5) return;
    debugPrint('Map tile ${tile.coordinates} failed to load: $error');
  }
}

/// A [NetworkTileProvider] that outlives the maps using it. A tile layer
/// disposes its provider when its map goes away, which closes the HTTP
/// client; this one is shared app-wide, so it keeps its client open.
class _SharedTileProvider extends NetworkTileProvider {
  @override
  Future<void> dispose() async {}
}

/// Who serves the tiles, as their terms require.
Widget mapAttribution() => SimpleAttributionWidget(source: Text(Env.mapTileAttribution));

/// Pin in brand colours; [highlighted] grows it for the selected store.
class StorePin extends StatelessWidget {
  const StorePin({this.color, this.highlighted = false, this.icon = Icons.local_cafe_rounded, super.key});

  final Color? color;
  final bool highlighted;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final fill = color ?? brand.caramel;
    return AnimatedScale(
      scale: highlighted ? 1.25 : 1,
      duration: Motion.medium,
      curve: Curves.easeOutBack,
      alignment: Alignment.bottomCenter,
      child: Column(
        mainAxisSize: MainAxisSize.min,
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
            child: Icon(icon, color: Colors.white, size: 19),
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
            mapTiles(context),
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
