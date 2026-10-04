import 'package:geolocator/geolocator.dart';

/// Opens this app's page in the system settings (notifications, location).
///
/// Goes through geolocator, which the app already ships and which does this
/// on both iOS and Android — no separate settings plugin needed.
Future<void> openAppSettings() async {
  try {
    await Geolocator.openAppSettings();
  } on Object {
    // Nothing more we can do from here.
  }
}
