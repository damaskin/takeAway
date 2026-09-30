import 'package:url_launcher/url_launcher.dart';

import '../core/config/env.dart';

/// Pages of the public website the app links to: the legal texts App Review
/// looks for, and support.
abstract final class WebPages {
  static const _fallbackOrigin = 'https://takeaway.md';

  static Uri get terms => _page('terms');
  static Uri get privacy => _page('privacy');
  static Uri get support => _page('support');

  static Uri _page(String path) {
    final configured = Env.webOrigin.trim();
    final usable = Uri.tryParse(configured)?.host.isNotEmpty ?? false;
    final origin = usable ? configured : _fallbackOrigin;
    return Uri.parse('${origin.replaceAll(RegExp(r'/+$'), '')}/$path');
  }
}

/// Opens a web page over the app (Safari View Controller, Custom Tabs), so
/// the customer is one swipe away from where they were.
Future<bool> openWebPage(Uri uri) async {
  try {
    return await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
  } on Object {
    return false;
  }
}
