import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/stand.dart';
import '../core/providers.dart';
import '../core/push/push_service.dart';
import '../core/storage/app_prefs.dart';
import '../features/auth/auth_service.dart';
import '../features/catalog/catalog_providers.dart';
import 'app.dart';

/// Makes the app's provider container for the stand saved on the phone —
/// `bootstrap()` in main.dart.
typedef Boot = Future<ProviderContainer> Function();

/// The root of the app: one provider container, and so one stand, at a time.
///
/// Switching stands starts the app over instead of patching it: the session,
/// the catalog cache, the socket and every open screen belong to one server,
/// and a fresh container keeps nothing of the old one.
class AppRoot extends StatefulWidget {
  const AppRoot({required this.container, required this.boot, super.key});

  final ProviderContainer container;
  final Boot boot;

  @override
  State<AppRoot> createState() => _AppRootState();
}

class _AppRootState extends State<AppRoot> {
  late ProviderContainer _container = widget.container;

  Future<void> _switchTo(Stand stand) async {
    final old = _container;
    await leaveStand(old, stand);
    final fresh = await widget.boot();
    if (!mounted) {
      fresh.dispose();
      return;
    }
    setState(() => _container = fresh);
    // The old screens go with this frame, their container right after. The
    // session manager is handed in from outside, so it is closed by hand.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sessions = old.read(sessionManagerProvider);
      old.dispose();
      sessions.dispose();
    });
  }

  @override
  void dispose() {
    _container.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => StandSwitch(
    onSwitch: _switchTo,
    child: UncontrolledProviderScope(key: ObjectKey(_container), container: _container, child: const TakeAwayApp()),
  );
}

/// Signs out of the stand the app is on, forgets what the phone kept of that
/// server — the store picked last, its feature flags, the device
/// registration — and makes [next] the stand of the next start.
Future<void> leaveStand(ProviderContainer container, Stand next) async {
  await container.read(authServiceProvider).signOut();
  final prefs = container.read(sharedPreferencesProvider);
  for (final key in [ActiveStoreController.prefsKey, PushService.registrationKey, ...FeatureFlagsCache.keys]) {
    await prefs.remove(key);
  }
  await Stand.save(prefs, next);
}

/// Hands the stand a tester picked to [AppRoot]. Sits above the provider
/// container, which the switch replaces.
class StandSwitch extends InheritedWidget {
  const StandSwitch({required this.onSwitch, required super.child, super.key});

  final Future<void> Function(Stand stand) onSwitch;

  /// Null where the app runs without [AppRoot] (widget tests).
  static StandSwitch? maybeOf(BuildContext context) => context.getInheritedWidgetOfExactType<StandSwitch>();

  @override
  bool updateShouldNotify(StandSwitch oldWidget) => onSwitch != oldWidget.onSwitch;
}
