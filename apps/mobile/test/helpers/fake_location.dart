import 'package:latlong2/latlong.dart';
import 'package:takeaway_mobile/core/location/location_service.dart';

/// The phone's location without the platform: where the customer is, and
/// whether they have let the app know.
class FakeLocationService extends LocationService {
  FakeLocationService({this.position, this.allowed = true, this.refusal = LocationStatus.denied});

  LatLng? position;

  /// Access given earlier, so the app reads the location without asking.
  bool allowed;

  /// What asking ends in while not [allowed].
  LocationStatus refusal;

  /// How many times the app asked, prompting if needed.
  int requests = 0;
  int settingsOpened = 0;

  @override
  LatLng? get lastKnown => allowed ? position : null;

  @override
  Future<bool> hasPermission() async => allowed;

  @override
  Future<LocationResult> locate({bool prompt = true, Duration timeout = const Duration(seconds: 8)}) async {
    if (prompt) requests++;
    if (!allowed) return LocationResult(refusal);
    final here = position;
    return here == null
        ? const LocationResult(LocationStatus.unavailable)
        : LocationResult(LocationStatus.granted, here);
  }

  @override
  Future<void> openSettings() async => settingsOpened++;
}
