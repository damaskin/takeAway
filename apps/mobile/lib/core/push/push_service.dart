import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
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

/// What a sync should do with this device's registration on the API.
enum PushSyncAction { none, register, detach }

/// The decision behind [PushService.refresh], kept pure so it can be tested.
///
/// The API only keeps a device while notifications are allowed: a token
/// registered without permission makes FCM and Apple accept pushes the
/// phone never shows, and the admin would count them as delivered.
@visibleForTesting
PushSyncAction pushSyncAction({
  required bool signedIn,
  required bool authorized,
  required bool registered,
  required bool hasToken,
}) {
  if (!signedIn) return PushSyncAction.none;
  if (authorized) return registered && hasToken ? PushSyncAction.none : PushSyncAction.register;
  return registered ? PushSyncAction.detach : PushSyncAction.none;
}

/// The APNs gateway this build's device token belongs to: store and
/// TestFlight builds are release builds signed for production, debug and
/// profile builds are signed for development and get sandbox tokens. The
/// API retries the other gateway when the guess is wrong.
@visibleForTesting
String apnsEnvironmentFor({required bool release}) => release ? 'PRODUCTION' : 'SANDBOX';

/// Firebase Cloud Messaging on Android; on iOS the app registers both its
/// FCM token and the raw APNs token, and the API pushes iPhones straight
/// through Apple (FCM only as the fallback).
///
/// Dormant unless the Firebase options are passed at build time — the app
/// then simply has no push, while order screens still update live over the
/// socket. Permission is asked in context (right after sign-in, after the
/// first order, or from the notifications screen), never at launch.
///
/// The device is registered with the API for the signed-in user only while
/// notifications are allowed; turning them off in the phone's settings
/// detaches it on the next return to the app.
class PushService {
  PushService(this._ref);

  /// `<userId>|<fcm token>` once the API has this device for that user,
  /// `<userId>|` once it was detached for them (so it is not detached again
  /// on every launch). Survives restarts.
  static const _registrationKey = 'push.registration';

  final Ref _ref;
  bool _initialized = false;
  String? _token;
  String? _apnsToken;
  bool _syncing = false;
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
      messaging.onTokenRefresh.listen((token) => unawaited(_onTokenRefresh(token)));
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        // Let the router settle before navigating.
        Future<void>.delayed(const Duration(milliseconds: 600), () => _opened.add(_toMessage(initial)));
      }
      _initialized = true;
      await syncToken();
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

  /// Whether the user said no for good — asking again shows nothing; only
  /// the system settings can turn notifications back on. (Android 13+ also
  /// reports a soft "denied" after one refusal, when it would still ask.)
  Future<bool> isDenied() async {
    if (!_initialized) return false;
    final settings = await FirebaseMessaging.instance.getNotificationSettings();
    return settings.authorizationStatus == AuthorizationStatus.denied ||
        settings.authorizationStatus == AuthorizationStatus.deniedPermanently;
  }

  /// Asks for permission (no-op if already decided) and registers the token.
  Future<bool> requestPermission() async {
    if (!_initialized) return false;
    final settings = await FirebaseMessaging.instance.requestPermission();
    final granted =
        settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
    await syncToken();
    return granted;
  }

  /// Brings the API in line with this phone: registers the device for the
  /// signed-in user while notifications are allowed, detaches it while they
  /// are not. Called at launch, after sign-in and after the permission
  /// prompt.
  Future<void> syncToken() async {
    if (!_initialized || _ref.read(currentUserIdProvider) == null) return;
    try {
      if (await isAuthorized()) {
        final token = await _fetchToken();
        if (token != null) await _register(token);
      } else {
        await _detach();
      }
    } on Object catch (error) {
      debugPrint('Push token sync failed: $error');
    }
  }

  /// [syncToken] when something changed since the last one — called on
  /// every return to the foreground: an iOS token that could not be had at
  /// the first try, notifications turned on or off in the phone's settings.
  Future<void> refresh() async {
    if (!_initialized || _syncing) return;
    final userId = _ref.read(currentUserIdProvider);
    if (userId == null) return;
    final action = pushSyncAction(
      signedIn: true,
      authorized: await isAuthorized(),
      registered: _registeredFor(userId),
      hasToken: _token != null,
    );
    if (action == PushSyncAction.none) return;
    _syncing = true;
    try {
      await syncToken();
    } finally {
      _syncing = false;
    }
  }

  /// The FCM token, waiting for APNs on iOS first (and keeping the APNs
  /// token, which the API pushes iPhones through).
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
      _apnsToken = apns;
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

  Future<void> _onTokenRefresh(String token) async {
    _token = token;
    if (await isAuthorized()) {
      if (Platform.isIOS) _apnsToken = await FirebaseMessaging.instance.getAPNSToken() ?? _apnsToken;
      await _register(token);
    }
  }

  Future<void> _register(String token) async {
    _token = token;
    final userId = _ref.read(currentUserIdProvider);
    if (userId == null) return;
    try {
      await _ref.read(apiProvider).registerDevice(_registration(token));
      await _prefs.setString(_registrationKey, '$userId|$token');
    } on Object catch (error) {
      debugPrint('Device registration failed: $error');
    }
  }

  /// Takes the device off the signed-in user while notifications are off,
  /// once — also cleaning up after app versions that registered without
  /// asking.
  Future<void> _detach() async {
    final userId = _ref.read(currentUserIdProvider);
    if (userId == null || _prefs.getString(_registrationKey) == '$userId|') return;
    final token = _token ?? await _fetchToken();
    if (token == null) return;
    _token = token;
    try {
      await _ref.read(apiProvider).unregisterDevice(_registration(token));
      await _prefs.setString(_registrationKey, '$userId|');
    } on Object catch (error) {
      debugPrint('Device detach failed: $error');
    }
  }

  /// Detaches the device from the account before sign-out.
  Future<void> unregister() async {
    final token = _token;
    if (!_initialized || token == null) return;
    try {
      await _ref.read(apiProvider).unregisterDevice(_registration(token));
    } on Object {
      // The server prunes dead tokens on its own, and the next account to
      // sign in on this phone takes the token over.
    }
    await _prefs.remove(_registrationKey);
  }

  bool _registeredFor(String userId) {
    final stored = _prefs.getString(_registrationKey);
    return stored != null && stored.startsWith('$userId|') && stored.length > userId.length + 1;
  }

  SharedPreferences get _prefs => _ref.read(sharedPreferencesProvider);

  DeviceRegistration _registration(String token) {
    final locale = _ref.read(currentUserProvider)?.locale;
    final apns = Platform.isIOS ? _apnsToken : null;
    return DeviceRegistration(
      type: Platform.isIOS ? 'IOS' : 'ANDROID',
      pushToken: token,
      apnsToken: apns,
      apnsEnvironment: apns == null ? null : apnsEnvironmentFor(release: kReleaseMode),
      locale: locale,
    );
  }

  static PushMessage _toMessage(RemoteMessage message) => PushMessage(
    title: message.notification?.title,
    body: message.notification?.body,
    orderId: message.data['orderId'] as String?,
  );
}

final pushServiceProvider = Provider<PushService>((ref) => PushService(ref));
