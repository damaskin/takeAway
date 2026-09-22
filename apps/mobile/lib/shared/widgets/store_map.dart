import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme/tokens.dart';

/// OpenStreetMap tiles — the same free map the web apps use (Leaflet + OSM),
/// no API key. The tile policy asks for a real user agent.
TileLayer osmTiles(BuildContext context) => TileLayer(
  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  userAgentPackageName: 'md.takeaway.app',
  tileBuilder: Theme.of(context).brightness == Brightness.dark ? darkModeTileBuilder : null,
);

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
            osmTiles(context),
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
