import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app_root.dart';
import 'core/auth/session_manager.dart';
import 'core/config/env.dart';
import 'core/config/stand.dart';
import 'core/providers.dart';
import 'core/push/push_service.dart';
import 'core/storage/json_cache.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(AppRoot(container: await bootstrap(), boot: bootstrap));
}

/// Everything the app needs before its first frame: preferences and the
/// stand saved in them, the session restored from secure storage, the
/// catalog cache and date symbols. Shared by `main()`, the stand switch
/// (see [AppRoot]) and the on-device integration test.
Future<ProviderContainer> bootstrap() async {
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  final prefs = await SharedPreferences.getInstance();
  // The backend first: the API client, links and the cache all follow it.
  final stand = Env.stand = Stand.restore(prefs);
  final storage = SecureSessionStorage();
  final (session, cache, _, _) = await (
    SessionManager.restore(storage),
    FileJsonCache.open(stand),
    initializeDateFormatting('en'),
    initializeDateFormatting('ru'),
  ).wait;

  final container = ProviderContainer(
    overrides: [
      sharedPreferencesProvider.overrideWithValue(prefs),
      sessionManagerProvider.overrideWithValue(SessionManager(storage: storage, initial: session)),
      jsonCacheProvider.overrideWithValue(cache),
    ],
  );

  // Push needs the container (API client, session) but must not delay the
  // first frame.
  unawaited(container.read(pushServiceProvider).init());
  return container;
}
