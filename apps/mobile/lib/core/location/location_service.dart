import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

enum LocationStatus { granted, denied, deniedForever, serviceOff, unavailable }

class LocationResult {
  const LocationResult(this.status, [this.position]);

  final LocationStatus status;
  final LatLng? position;

  bool get ok => position != null;
}

/// Thin wrapper over geolocator that never throws: every failure mode comes
/// back as a [LocationStatus] the UI can explain.
class LocationService {
  LatLng? _last;

  LatLng? get lastKnown => _last;

  /// Whether we may read the location without prompting.
  Future<bool> hasPermission() async {
    try {
      final permission = await Geolocator.checkPermission();
      return permission == LocationPermission.always || permission == LocationPermission.whileInUse;
    } on Object {
      return false;
    }
  }

  Future<LocationResult> locate({bool prompt = true, Duration timeout = const Duration(seconds: 8)}) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return const LocationResult(LocationStatus.serviceOff);

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied && prompt) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.deniedForever) return const LocationResult(LocationStatus.deniedForever);
      if (permission == LocationPermission.denied || permission == LocationPermission.unableToDetermine) {
        return const LocationResult(LocationStatus.denied);
      }

      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: LocationSettings(accuracy: LocationAccuracy.high, timeLimit: timeout),
        );
      } on TimeoutException {
        position = await Geolocator.getLastKnownPosition();
      }
      position ??= await Geolocator.getLastKnownPosition();
      if (position == null) return const LocationResult(LocationStatus.unavailable);

      final point = LatLng(position.latitude, position.longitude);
      _last = point;
      return LocationResult(LocationStatus.granted, point);
    } on Object {
      return const LocationResult(LocationStatus.unavailable);
    }
  }

  Future<void> openSettings() async {
    try {
      await Geolocator.openAppSettings();
    } on Object {
      // Nothing more we can do from here.
    }
  }

  static double distanceMeters(LatLng a, LatLng b) =>
      Geolocator.distanceBetween(a.latitude, a.longitude, b.latitude, b.longitude);
}

final locationServiceProvider = Provider<LocationService>((ref) => LocationService());
