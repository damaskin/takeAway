import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';

/// App language: null follows the device, otherwise `en` / `ru`.
class LocaleController extends Notifier<Locale?> {
  static const _key = 'app.locale';

  @override
  Locale? build() {
    final code = ref.watch(sharedPreferencesProvider).getString(_key);
    return code == null ? null : Locale(code);
  }

  Future<void> set(Locale? locale) async {
    state = locale;
    final prefs = ref.read(sharedPreferencesProvider);
    if (locale == null) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, locale.languageCode);
    }
  }
}

final localeControllerProvider = NotifierProvider<LocaleController, Locale?>(LocaleController.new);

/// First-launch intro, shown once.
class OnboardingController extends Notifier<bool> {
  static const _key = 'app.onboarding.done';

  @override
  bool build() => ref.watch(sharedPreferencesProvider).getBool(_key) ?? false;

  Future<void> complete() async {
    state = true;
    await ref.read(sharedPreferencesProvider).setBool(_key, true);
  }
}

final onboardingDoneProvider = NotifierProvider<OnboardingController, bool>(OnboardingController.new);

/// The store the customer is ordering from. Persisted, because re-picking a
/// store on every launch is exactly the friction pre-ordering is meant to
/// remove.
class ActiveStoreController extends Notifier<String?> {
  static const _key = 'app.activeStoreId';

  @override
  String? build() => ref.watch(sharedPreferencesProvider).getString(_key);

  void select(String storeId) {
    if (state == storeId) return;
    state = storeId;
    unawaited(ref.read(sharedPreferencesProvider).setString(_key, storeId));
  }

  void clear() {
    state = null;
    unawaited(ref.read(sharedPreferencesProvider).remove(_key));
  }
}

final activeStoreIdProvider = NotifierProvider<ActiveStoreController, String?>(ActiveStoreController.new);

/// Checkout contact fields remembered between orders on this device.
class ContactPrefs {
  ContactPrefs(this._ref);

  final Ref _ref;
  static const _nameKey = 'checkout.name';
  static const _phoneKey = 'checkout.phone';

  String? get name => _ref.read(sharedPreferencesProvider).getString(_nameKey);
  String? get phone => _ref.read(sharedPreferencesProvider).getString(_phoneKey);

  Future<void> remember({String? name, String? phone}) async {
    final prefs = _ref.read(sharedPreferencesProvider);
    if (name != null && name.trim().isNotEmpty) await prefs.setString(_nameKey, name.trim());
    if (phone != null && phone.trim().isNotEmpty) await prefs.setString(_phoneKey, phone.trim());
  }
}

final contactPrefsProvider = Provider<ContactPrefs>((ref) => ContactPrefs(ref));
