import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/push/push_service.dart';

void main() {
  group('pushSyncAction', () {
    PushSyncAction decide({
      bool signedIn = true,
      bool authorized = true,
      bool registered = true,
      bool hasToken = true,
    }) => pushSyncAction(signedIn: signedIn, authorized: authorized, registered: registered, hasToken: hasToken);

    test('leaves a registered device with notifications on alone', () {
      expect(decide(), PushSyncAction.none);
    });

    test('registers once notifications are allowed, or when the token is still missing', () {
      expect(decide(registered: false), PushSyncAction.register);
      expect(decide(hasToken: false), PushSyncAction.register);
    });

    test('detaches a device whose notifications were turned off', () {
      expect(decide(authorized: false), PushSyncAction.detach);
      expect(decide(authorized: false, registered: false), PushSyncAction.none);
    });

    test('does nothing for a guest', () {
      expect(decide(signedIn: false, registered: false), PushSyncAction.none);
    });
  });

  test('release builds register production APNs tokens, debug builds sandbox ones', () {
    expect(apnsEnvironmentFor(release: true), 'PRODUCTION');
    expect(apnsEnvironmentFor(release: false), 'SANDBOX');
  });
}
