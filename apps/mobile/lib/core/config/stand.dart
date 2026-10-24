import 'package:shared_preferences/shared_preferences.dart';

/// The backends one build of the app can talk to.
///
/// The store build starts on [prod]. Testers move it to [test] — staging,
/// test.takeaway.md, with its fake bank — from a hidden sheet (a long press
/// on the logo of the sign-in sheet or of «О приложении»), so the same app
/// serves both and no separate test app has to be published. The choice is
/// kept on the phone. [local] exists only in builds made with an
/// `API_BASE_URL` of their own (config/local.json): a developer's API.
enum Stand {
  prod(apiBaseUrl: 'https://api.takeaway.md/api', webOrigin: 'https://takeaway.md'),
  test(apiBaseUrl: 'https://test-api.takeaway.md/api', webOrigin: 'https://test.takeaway.md'),
  local(apiBaseUrl: _definedApiBaseUrl, webOrigin: _definedWebOrigin);

  const Stand({required this.apiBaseUrl, required this.webOrigin});

  /// REST base, including the global `/api` prefix.
  final String apiBaseUrl;

  /// The public website of this backend, for links the app shares.
  final String webOrigin;

  /// The build's own backend, from `--dart-define(-from-file)`. A build
  /// that names [prod] or [test] here just starts on that stand.
  static const _definedApiBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const _definedWebOrigin = String.fromEnvironment('WEB_ORIGIN', defaultValue: 'https://takeaway.md');

  /// Socket.IO origin of [local]; the others serve it from the API host.
  static const _definedRealtimeUrl = String.fromEnvironment('REALTIME_URL');

  /// Where the choice is kept between launches.
  static const prefsKey = 'app.stand';

  /// The API host, for the sheet that lists the stands.
  String get host {
    final uri = Uri.parse(apiBaseUrl);
    return uri.hasPort ? '${uri.host}:${uri.port}' : uri.host;
  }

  /// Socket.IO origin: the origin of [apiBaseUrl]; the gateway lives at
  /// `/socket.io` on the API host, namespace `/ws`.
  String get realtimeUrl {
    if (this == local && _definedRealtimeUrl.isNotEmpty) return _definedRealtimeUrl;
    return Uri.parse(apiBaseUrl).replace(path: '').toString().replaceAll(RegExp(r'[/?#]+$'), '');
  }

  /// Where a fresh install starts: the stand the build's `API_BASE_URL`
  /// names, [prod] without one.
  static Stand get buildDefault => _byUrl(_definedApiBaseUrl);

  /// The stands this build can switch between.
  static List<Stand> get available => [prod, test, if (buildDefault == local) local];

  /// The stand chosen on this phone, or [buildDefault].
  static Stand restore(SharedPreferences prefs) {
    final name = prefs.getString(prefsKey);
    return available.firstWhere((s) => s.name == name, orElse: () => buildDefault);
  }

  static Future<void> save(SharedPreferences prefs, Stand stand) => prefs.setString(prefsKey, stand.name);

  static Stand _byUrl(String url) {
    if (url.isEmpty) return prod;
    String bare(String u) => u.trim().replaceAll(RegExp(r'/+$'), '');
    for (final stand in [prod, test]) {
      if (bare(stand.apiBaseUrl) == bare(url)) return stand;
    }
    return local;
  }
}
