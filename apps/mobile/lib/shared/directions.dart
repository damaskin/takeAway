import 'dart:io';

import 'package:url_launcher/url_launcher.dart';

/// Opens turn-by-turn directions in the platform's maps app. Same contract
/// as `buildDirectionsUrl` in `libs/utils`: no API key, the maps app does
/// the routing.
Future<bool> openDirections(double lat, double lng, {String? label}) async {
  final uri = Platform.isIOS
      ? Uri.https('maps.apple.com', '/', {'daddr': '$lat,$lng', 'q': ?label})
      : Uri.https('www.google.com', '/maps/dir/', {'api': '1', 'destination': '$lat,$lng'});
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}

/// Dials [phone] as a business typed it: «+373 69 123 456» goes to the
/// dialer as +37369123456.
Future<bool> openPhone(String phone) => launchUrl(Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'[^0-9+]'), '')));
