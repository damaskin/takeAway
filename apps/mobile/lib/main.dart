import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'core/auth/session_manager.dart';
import 'core/providers.dart';
import 'core/push/push_service.dart';
import 'core/storage/json_cache.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = await bootstrap();
  runApp(UncontrolledProviderScope(container: container, child: const TakeAwayApp()));
}

/// Everything the app needs before its first frame: preferences, the
/// session restored from secure storage, the catalog cache and date
/// symbols. Shared by `main()` and the on-device integration test.
Future<ProviderContainer> bootstrap() async {
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  final storage = SecureSessionStorage();
  final (prefs, session, cache, _, _) = await (
    SharedPreferences.getInstance(),
    SessionManager.restore(storage),
    FileJsonCache.open(),
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
