import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../config/env.dart';
import '../providers.dart';

/// A push the user tapped, or one that arrived while the app was open.
class PushMessage {
  const PushMessage({this.title, this.body, this.orderId});

  final String? title;
  final String? body;
  final String? orderId;
}

/// Firebase Cloud Messaging (FCM on Android, APNs through FCM on iOS).
///
/// Dormant unless the Firebase options are passed at build time — the app
/// then simply has no push, while order screens still update live over the
/// socket. Permission is asked in context (after the first order, or from
/// the notifications screen), never at launch.
class PushService {
  PushService(this._ref);

  final Ref _ref;
  bool _initialized = false;
  String? _token;
  final _opened = StreamController<PushMessage>.broadcast();
  final _foreground = StreamController<PushMessage>.broadcast();

  static bool get configured {
    if (Env.firebaseApiKey.isEmpty || Env.firebaseProjectId.isEmpty || Env.firebaseSenderId.isEmpty) return false;
    if (kIsWeb) return false;
    return Platform.isIOS ? Env.firebaseIosAppId.isNotEmpty : Env.firebaseAndroidAppId.isNotEmpty;
  }

  /// Taps on notifications — the shell routes them to the order screen.
  Stream<PushMessage> get opened => _opened.stream;

  /// Pushes received while the app is in the foreground.
  Stream<PushMessage> get foreground => _foreground.stream;

  Future<void> init() async {
    if (_initialized || !configured) return;
    try {
      await Firebase.initializeApp(
        options: FirebaseOptions(
          apiKey: Env.firebaseApiKey,
          appId: Platform.isIOS ? Env.firebaseIosAppId : Env.firebaseAndroidAppId,
          messagingSenderId: Env.firebaseSenderId,
          projectId: Env.firebaseProjectId,
        ),
      );
      final messaging = FirebaseMessaging.instance;
      // In the foreground the app shows its own in-app notice (see
      // [foreground]), which knows to stay quiet about the order already on
      // screen. Letting iOS show its banner as well put the same news up
      // twice; Android shows none for a foreground push anyway.
      await messaging.setForegroundNotificationPresentationOptions(badge: true, sound: true);
      FirebaseMessaging.onMessage.listen((m) => _foreground.add(_toMessage(m)));
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _opened.add(_toMessage(m)));
      messaging.onTokenRefresh.listen((token) => unawaited(_register(token)));
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        // Let the router settle before navigating.
        Future<void>.delayed(const Duration(milliseconds: 600), () => _opened.add(_toMessage(initial)));
      }
      _initialized = true;
      if (await isAuthorized()) await syncToken();
    } on Object catch (error) {
      debugPrint('Push init failed: $error');
    }
  }

  Future<bool> isAuthorized() async {
    if (!_initialized) return false;
    final settings = await FirebaseMessaging.instance.getNotificationSettings();
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  /// Whether the user has not been asked yet — only then is a prompt useful.
  Future<bool> canPrompt() async {
    if (!_initialized) return false;
    final settings = await FirebaseMessaging.instance.getNotificationSettings();
    return settings.authorizationStatus == AuthorizationStatus.notDetermined;
  }

  /// Whether the user said no — asking again shows nothing; only the
  /// system settings can turn notifications back on.
  Future<bool> isDenied() async {
    if (!_initialized) return false;
    final settings = await FirebaseMessaging.instance.getNotificationSettings();
    return settings.authorizationStatus == AuthorizationStatus.denied;
  }

  /// Asks for permission (no-op if already decided) and registers the token.
  Future<bool> requestPermission() async {
    if (!_initialized) return false;
    final settings = await FirebaseMessaging.instance.requestPermission();
    final granted =
        settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
    if (granted) await syncToken();
    return granted;
  }

  /// Registers this device with the API for the signed-in user.
  Future<void> syncToken() async {
    if (!_initialized) return;
    try {
      final token = await _fetchToken();
      if (token != null) await _register(token);
    } on Object catch (error) {
      debugPrint('Push token sync failed: $error');
    }
  }

  /// [syncToken] for when the last attempt came back empty — called on
  /// every return to the foreground, so a failed first try is not final.
  Future<void> syncTokenIfMissing() async {
    if (!_initialized || _token != null || _syncing) return;
    if (!await isAuthorized()) return;
    _syncing = true;
    try {
      await syncToken();
    } finally {
      _syncing = false;
    }
  }

  bool _syncing = false;

  /// The FCM token, waiting for APNs on iOS first.
  ///
  /// Right after the permission prompt iOS has not handed the app its APNs
  /// token yet, and `getToken()` then fails with "APNs token has not been
  /// set yet" — the device used to stay unregistered for good. Waits for
  /// the APNs token (up to about half a minute), then retries the FCM one.
  Future<String?> _fetchToken() async {
    final messaging = FirebaseMessaging.instance;
    if (Platform.isIOS) {
      String? apns;
      for (var attempt = 0; attempt < 8; attempt++) {
        apns = await messaging.getAPNSToken();
        if (apns != null) break;
        await Future<void>.delayed(Duration(milliseconds: 500 * (attempt + 1)));
      }
      if (apns == null) {
        debugPrint('Push: no APNs token yet; will retry on next resume');
        return null;
      }
    }
    for (var attempt = 0; ; attempt++) {
      try {
        return await messaging.getToken();
      } on Object {
        if (attempt >= 2) rethrow;
        await Future<void>.delayed(Duration(seconds: 2 * (attempt + 1)));
      }
    }
  }

  Future<void> _register(String token) async {
    _token = token;
    if (!_ref.read(isSignedInProvider)) return;
    try {
      await _ref.read(apiProvider).registerDevice(_registration(token));
    } on Object catch (error) {
      debugPrint('Device registration failed: $error');
    }
  }

  /// Detaches the device from the account before sign-out.
  Future<void> unregister() async {
    final token = _token;
    if (!_initialized || token == null) return;
    try {
      await _ref.read(apiProvider).unregisterDevice(_registration(token));
    } on Object {
      // The server prunes dead tokens on its own.
    }
  }

  DeviceRegistration _registration(String token) {
    final locale = _ref.read(currentUserProvider)?.locale;
    return DeviceRegistration(type: Platform.isIOS ? 'IOS' : 'ANDROID', pushToken: token, locale: locale);
  }

  static PushMessage _toMessage(RemoteMessage message) => PushMessage(
    title: message.notification?.title,
    body: message.notification?.body,
    orderId: message.data['orderId'] as String?,
  );
}

final pushServiceProvider = Provider<PushService>((ref) => PushService(ref));
