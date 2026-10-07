import 'package:latlong2/latlong.dart';

/// How far from the anchor store a pin still counts as "around here".
const mapFocusRadiusKm = 50.0;

/// The points the stores map opens on: the stores around the customer, not
/// every store on the platform.
///
/// Fitting the camera to all of them put a single far-away store (a demo
/// store in another country) in the frame, so the map opened at world zoom
/// and loaded every tile level on the way down to the customer's city.
///
/// The anchor is the store nearest to the customer when their location is
/// known, otherwise the store with the most others around it. The customer
/// is kept in the frame only when they are reasonably close to that anchor.
List<LatLng> mapFocus(List<LatLng> stores, LatLng? me, {double radiusKm = mapFocusRadiusKm}) {
  if (stores.isEmpty) return [?me];
  const distance = Distance();
  double km(LatLng a, LatLng b) => distance.as(LengthUnit.Kilometer, a, b);

  final LatLng anchor;
  if (me != null) {
    anchor = stores.reduce((a, b) => km(me, a) <= km(me, b) ? a : b);
  } else {
    int around(LatLng p) => stores.where((q) => km(p, q) <= radiusKm).length;
    anchor = stores.reduce((a, b) => around(a) >= around(b) ? a : b);
  }

  return [
    for (final p in stores)
      if (km(anchor, p) <= radiusKm) p,
    if (me != null && km(anchor, me) <= radiusKm * 2) me,
  ];
}
