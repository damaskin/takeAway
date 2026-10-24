import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:takeaway_mobile/core/config/env.dart';
import 'package:takeaway_mobile/core/config/stand.dart';
import 'package:takeaway_mobile/shared/web_pages.dart';

void main() {
  tearDown(() => Env.stand = Stand.prod);

  Future<SharedPreferences> prefsWith(Map<String, Object> values) async {
    SharedPreferences.setMockInitialValues(values);
    return SharedPreferences.getInstance();
  }

  test('a build without API_BASE_URL starts on production and offers the test stand', () {
    expect(Stand.buildDefault, Stand.prod);
    expect(Stand.available, [Stand.prod, Stand.test]);
  });

  test('the stand picked on the phone comes back at the next launch', () async {
    expect(Stand.restore(await prefsWith({})), Stand.prod);
    expect(Stand.restore(await prefsWith({'app.stand': 'test'})), Stand.test);

    final prefs = await prefsWith({});
    await Stand.save(prefs, Stand.test);
    expect(prefs.getString(Stand.prefsKey), 'test');
  });

  test('a stand this build does not have falls back to its own', () async {
    // «local» needs a build with an API_BASE_URL of its own.
    expect(Stand.restore(await prefsWith({'app.stand': 'local'})), Stand.prod);
    expect(Stand.restore(await prefsWith({'app.stand': 'staging'})), Stand.prod);
  });

  test('each stand has its API, socket and website', () {
    expect(Stand.prod.apiBaseUrl, 'https://api.takeaway.md/api');
    expect(Stand.prod.realtimeUrl, 'https://api.takeaway.md');
    expect(Stand.prod.host, 'api.takeaway.md');
    expect(Stand.test.apiBaseUrl, 'https://test-api.takeaway.md/api');
    expect(Stand.test.realtimeUrl, 'https://test-api.takeaway.md');
    expect(Stand.test.host, 'test-api.takeaway.md');
    expect(Stand.test.webOrigin, 'https://test.takeaway.md');
  });

  test('the app follows its stand: API, links, Telegram return', () {
    expect(Env.apiBaseUrl, 'https://api.takeaway.md/api');
    expect(WebPages.privacy.toString(), 'https://takeaway.md/privacy');
    expect(Env.telegramAndroidAppLink, isNotEmpty);

    Env.stand = Stand.test;
    expect(Env.apiBaseUrl, 'https://test-api.takeaway.md/api');
    expect(Env.realtimeUrl, 'https://test-api.takeaway.md');
    expect(Env.webOrigin, 'https://test.takeaway.md');
    expect(WebPages.privacy.toString(), 'https://test.takeaway.md/privacy');
    // @takeaway_test_bot has no App Link for the store app: the custom scheme.
    expect(Env.telegramAndroidAppLink, isEmpty);
    expect(Env.telegramRedirectUri, 'takeaway://tglogin');
  });
}
