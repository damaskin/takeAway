import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/app/app_shell.dart';
import 'package:takeaway_mobile/core/push/push_service.dart';

void main() {
  group('PushMessage.fromData', () {
    test('reads the kind and the ids next to the alert', () {
      final message = PushMessage.fromData(
        {'kind': 'campaign', 'notificationId': 'inb_1', 'storeId': 'st_1', 'brandId': 'br_1'},
        title: 'NoName Coffee: −20% на капучино',
        body: 'Только до воскресенья',
      );
      expect(message.kind, 'campaign');
      expect(message.notificationId, 'inb_1');
      expect(message.storeId, 'st_1');
      expect(message.brandId, 'br_1');
      expect(message.orderId, isNull);
      expect(message.title, 'NoName Coffee: −20% на капучино');
      expect(message.isInbox, isTrue);
    });

    test('ignores empty and non-string values', () {
      final message = PushMessage.fromData({'kind': '', 'orderId': 42, 'notificationId': null});
      expect(message.kind, isNull);
      expect(message.orderId, isNull);
      expect(message.notificationId, isNull);
      expect(message.isInbox, isFalse);
    });
  });

  group('pushRoutes', () {
    test('opens the order an order push is about, as before', () {
      for (final kind in ['order_status', 'order_ready', 'order_out_for_delivery', 'order_delivered']) {
        expect(pushRoutes(PushMessage.fromData({'kind': kind, 'orderId': 'ord_1'})), ['/order/ord_1']);
      }
      expect(pushRoutes(const PushMessage(orderId: 'ord_1', notificationId: 'inb_1')), [
        '/order/ord_1',
      ], reason: 'an order id wins');
    });

    test('opens a campaign or an announcement over «Уведомления»', () {
      expect(pushRoutes(PushMessage.fromData({'kind': 'campaign', 'notificationId': 'inb_1'})), [
        '/inbox',
        '/inbox/inb_1',
      ]);
      expect(
        pushRoutes(PushMessage.fromData({'kind': 'announcement', 'notificationId': 'inb_2'})).last,
        '/inbox/inb_2',
      );
      expect(
        pushRoutes(PushMessage.fromData({'kind': 'generic', 'notificationId': 'inb_3'})).last,
        '/inbox/inb_3',
        reason: 'any push with an inbox item opens it',
      );
    });

    test('opens the list for a campaign push without an item, such as an admin test', () {
      expect(pushRoutes(PushMessage.fromData({'kind': 'campaign'})), ['/inbox']);
      expect(pushRoutes(PushMessage.fromData({'kind': 'announcement', 'storeId': 'st_1'})), ['/inbox']);
    });

    test('leaves the app where it is for anything else', () {
      expect(pushRoutes(PushMessage.fromData({'kind': 'generic'})), isEmpty);
      expect(pushRoutes(const PushMessage(title: 'Hi')), isEmpty);
    });
  });
}
