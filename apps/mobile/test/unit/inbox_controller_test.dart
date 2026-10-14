import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/core/auth/session_manager.dart';
import 'package:takeaway_mobile/core/network/api_error.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/features/inbox/inbox_providers.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  late FakeApi api;
  late SessionManager sessions;
  late ProviderContainer container;

  setUp(() {
    api = FakeApi()
      ..inboxItems = [
        for (var i = 1; i <= 25; i++)
          FakeApi.inboxItemJson(
            'inb_$i',
            read: i > 3,
            createdAt: DateTime.utc(2026, 10, 14, 12).subtract(Duration(hours: i)),
          ),
      ];
    sessions = SessionManager(storage: MemorySessionStorage(), initial: testSession());
    container = ProviderContainer(
      overrides: [sessionManagerProvider.overrideWithValue(sessions), apiProvider.overrideWithValue(api)],
    );
    addTearDown(container.dispose);
  });

  InboxController controller() => container.read(inboxProvider.notifier);

  InboxState current() => container.read(inboxProvider).requireValue;

  /// The first page, once the badge's own first read has landed too.
  Future<List<InboxItem>> load() async {
    final state = await container.read(inboxProvider.future);
    await Future<void>.delayed(Duration.zero);
    return state.items;
  }

  test('loads a page at a time by cursor, without repeats, and knows when it is done', () async {
    expect(await load(), hasLength(inboxPageSize));
    expect(current().hasMore, isTrue);
    expect(container.read(inboxUnreadProvider), 3, reason: 'the page carries the unread count');

    await controller().loadMore();
    expect(current().items.map((i) => i.id), [for (var i = 1; i <= 25; i++) 'inb_$i']);
    expect(current().hasMore, isFalse);
    expect(api.inboxCursors, [null, 'inb_20']);

    await controller().loadMore();
    expect(api.inboxCursors, hasLength(2), reason: 'nothing is left to ask for');
  });

  test('keeps what it has and offers a retry when the next page fails', () async {
    await load();
    api.inboxNextPagesFail = true;
    await controller().loadMore();
    expect(current().loadMoreFailed, isTrue);
    expect(current().loadingMore, isFalse);
    expect(current().items, hasLength(inboxPageSize));

    api.inboxNextPagesFail = false;
    await controller().loadMore();
    expect(current().items, hasLength(25));
    expect(current().loadMoreFailed, isFalse);
  });

  test('marking one read shows it at once, lowers the badge and tells the server once', () async {
    final items = await load();
    final first = items.first;
    expect(first.isRead, isFalse);

    final reading = controller().markRead(first);
    expect(current().items.first.isRead, isTrue);
    expect(container.read(inboxUnreadProvider), 2);
    await reading;
    expect(api.inboxUnread, 2);

    // The detail screen reading the copy it was handed counts nothing twice.
    await controller().markRead(first);
    expect(api.inboxReads, ['inb_1']);
    expect(container.read(inboxUnreadProvider), 2);

    await controller().markRead(items[5]);
    expect(api.inboxReads, ['inb_1'], reason: 'a message already read is left alone');
  });

  test('puts a message back to unread when the server refuses', () async {
    final items = await load();
    api.inboxReadStatus = 500;
    await controller().markRead(items.first);
    await container.read(inboxUnreadProvider.notifier).refresh();
    expect(current().items.first.isRead, isFalse);
    expect(container.read(inboxUnreadProvider), 3);
  });

  test('reads everything at once, and puts it all back when that fails', () async {
    await load();
    api.inboxReadStatus = 503;
    await expectLater(controller().markAllRead(), throwsA(isA<ApiError>()));
    expect(current().hasUnread, isTrue);
    expect(container.read(inboxUnreadProvider), 3);

    api.inboxReadStatus = null;
    await controller().markAllRead();
    expect(current().hasUnread, isFalse);
    expect(container.read(inboxUnreadProvider), 0);
    expect(api.inboxReadAlls, 2);
    expect(api.inboxUnread, 0);
  });

  test('the badge reads the server count, and is zero with nothing loaded for a guest', () async {
    expect(container.read(inboxUnreadProvider), 0);
    await container.read(inboxUnreadProvider.notifier).refresh();
    expect(container.read(inboxUnreadProvider), 3);

    await sessions.end(SessionEndReason.signedOut);
    expect(container.read(inboxUnreadProvider), 0);
    expect((await container.read(inboxProvider.future)).items, isEmpty);
  });
}
