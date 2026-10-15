import 'dart:async';

import 'package:takeaway_mobile/core/push/push_service.dart';

/// Push without Firebase: tests tap a notification or deliver one in the
/// foreground by hand.
class FakePushService extends PushService {
  FakePushService(super.ref);

  final _opened = StreamController<PushMessage>.broadcast();
  final _foreground = StreamController<PushMessage>.broadcast();

  @override
  Stream<PushMessage> get opened => _opened.stream;

  @override
  Stream<PushMessage> get foreground => _foreground.stream;

  void tap(PushMessage message) => _opened.add(message);

  void receive(PushMessage message) => _foreground.add(message);
}
