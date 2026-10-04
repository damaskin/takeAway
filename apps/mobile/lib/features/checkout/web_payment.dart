import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/network/api_error.dart';
import '../../core/providers.dart';

/// How the bank's verdict comes back: `takeaway://pay?orderId=…&status=…`.
/// The API sends the customer there after its own return page; the scheme
/// and host are registered in AndroidManifest.xml and Info.plist.
enum PaymentReturnStatus { success, pending, fail, unknown }

class PaymentReturn {
  const PaymentReturn({required this.orderId, required this.status});

  static const scheme = 'takeaway';
  static const host = 'pay';

  final String orderId;
  final PaymentReturnStatus status;

  /// Null for any other link (Telegram Login shares the scheme).
  static PaymentReturn? parse(Uri uri) {
    if (uri.scheme.toLowerCase() != scheme || uri.host.toLowerCase() != host) return null;
    final orderId = uri.queryParameters['orderId']?.trim() ?? '';
    if (orderId.isEmpty) return null;
    final status = switch (uri.queryParameters['status']?.toLowerCase()) {
      'success' => PaymentReturnStatus.success,
      'pending' => PaymentReturnStatus.pending,
      'fail' || 'failed' => PaymentReturnStatus.fail,
      _ => PaymentReturnStatus.unknown,
    };
    return PaymentReturn(orderId: orderId, status: status);
  }
}

/// The device side of the bank's page: an in-app browser over the app, and
/// the return link arriving through `app_links`. Swapped out in tests.
abstract class WebPaymentPlatform {
  /// Opens [url] over the app. False when nothing could open it.
  Future<bool> open(Uri url);

  /// Dismisses the in-app browser if it is still up.
  Future<void> close();

  /// Every incoming link, the one that cold-started the app included.
  Stream<Uri> get links;
}

class DeviceWebPaymentPlatform implements WebPaymentPlatform {
  DeviceWebPaymentPlatform({AppLinks? appLinks}) : _appLinks = appLinks ?? AppLinks();

  final AppLinks _appLinks;

  @override
  Future<bool> open(Uri url) async {
    try {
      // Safari View Controller / Custom Tabs: the bank's page with the
      // browser's own address bar and padlock, one swipe from the app.
      return await launchUrl(url, mode: LaunchMode.inAppBrowserView);
    } on Object {
      return false;
    }
  }

  @override
  Future<void> close() async {
    try {
      // iOS closes the Safari View Controller; on Android the return link
      // reopens the singleTask activity, which already dropped the tab.
      await closeInAppWebView();
    } on Object {
      // Nothing to close.
    }
  }

  @override
  Stream<Uri> get links => _appLinks.uriLinkStream;
}

final webPaymentPlatformProvider = Provider<WebPaymentPlatform>((ref) => DeviceWebPaymentPlatform());

enum WebPaymentLaunch {
  /// The bank's page is open; the verdict comes back as a [PaymentReturn].
  opened,

  /// The order is already held or paid — nothing to open.
  settled,

  /// The page exists but no browser took it.
  notOpened,
}

/// Paying for an order on the bank's page, shared by checkout and the
/// order screen's retry.
class WebPayments {
  const WebPayments(this._api, this._platform);

  final TakeAwayApi _api;
  final WebPaymentPlatform _platform;

  /// Starts (or resumes) the payment for [orderId] and opens the bank's
  /// page. Throws [ApiError] when the API refuses.
  Future<WebPaymentLaunch> launch(String orderId) async {
    final StartWebPaymentResult result;
    try {
      result = await _api.startWebPayment(StartWebPaymentRequest(orderId: orderId));
    } on Object catch (error) {
      throw ApiError.from(error);
    }
    final page = result.page;
    if (page == null) return WebPaymentLaunch.settled;
    final url = Uri.tryParse(page.url);
    if (url == null || !url.hasScheme) return WebPaymentLaunch.notOpened;
    return await _platform.open(url) ? WebPaymentLaunch.opened : WebPaymentLaunch.notOpened;
  }
}

final webPaymentsProvider = Provider<WebPayments>(
  (ref) => WebPayments(ref.watch(apiProvider), ref.watch(webPaymentPlatformProvider)),
);
