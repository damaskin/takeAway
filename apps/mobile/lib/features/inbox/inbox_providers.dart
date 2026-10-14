import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/network/api_error.dart';
import '../../core/providers.dart';

/// How many messages «Уведомления» asks for at a time.
const inboxPageSize = 20;

/// The number on the bell and on the profile row: the signed-in customer's
/// unread messages, zero for a guest. Read again on coming back to the app,
/// when a push arrives and after reading; a failed read keeps the last one.
class InboxUnreadController extends Notifier<int> {
  @override
  int build() {
    if (ref.watch(currentUserIdProvider) == null) return 0;
    unawaited(refresh());
    return 0;
  }

  Future<void> refresh() async {
    final userId = ref.read(currentUserIdProvider);
    if (userId == null) return;
    try {
      final unread = await ref.read(apiProvider).inboxUnreadCount();
      if (ref.read(currentUserIdProvider) == userId) state = math.max(0, unread.count);
    } on Object catch (error) {
      debugPrint('Inbox unread count failed: $error');
    }
  }

  void set(int count) => state = math.max(0, count);

  void adjust(int delta) => state = math.max(0, state + delta);
}

final inboxUnreadProvider = NotifierProvider<InboxUnreadController, int>(InboxUnreadController.new);

/// The messages loaded so far, newest first.
@immutable
class InboxState {
  const InboxState({this.items = const [], this.nextCursor, this.loadingMore = false, this.loadMoreFailed = false});

  final List<InboxItem> items;

  /// Where the next page starts; null once everything is loaded.
  final String? nextCursor;
  final bool loadingMore;

  /// The last attempt at the next page failed; the list offers to retry.
  final bool loadMoreFailed;

  bool get hasMore => nextCursor != null;

  bool get hasUnread => items.any((item) => !item.isRead);

  InboxState copyWith({List<InboxItem>? items, bool? loadingMore, bool? loadMoreFailed}) => InboxState(
    items: items ?? this.items,
    nextCursor: nextCursor,
    loadingMore: loadingMore ?? this.loadingMore,
    loadMoreFailed: loadMoreFailed ?? this.loadMoreFailed,
  );
}

/// «Уведомления»: the first page, then more as the customer scrolls. Kept
/// for the signed-in customer between visits (the screen asks again when it
/// opens), so marking a message read from its own screen updates the list
/// beneath.
class InboxController extends AsyncNotifier<InboxState> {
  /// Messages marked read here, so a copy fetched before the server heard
  /// of it is not shown — or counted — as unread again.
  final _read = <String>{};
  String? _userId;

  /// Bumped by every reload, so a page asked for before it is dropped.
  var _generation = 0;

  TakeAwayApi get _api => ref.read(apiProvider);

  InboxUnreadController get _unread => ref.read(inboxUnreadProvider.notifier);

  @override
  Future<InboxState> build() async {
    final userId = ref.watch(currentUserIdProvider);
    final generation = ++_generation;
    if (userId != _userId) {
      _userId = userId;
      _read.clear();
    }
    if (userId == null) return const InboxState();
    final page = await _guard(() => ref.read(apiProvider).inbox(limit: inboxPageSize));
    if (generation == _generation) _unread.set(page.unreadCount);
    return InboxState(items: page.items.map(_withLocalReads).toList(), nextCursor: page.nextCursor);
  }

  Future<void> loadMore() async {
    final current = state.valueOrNull;
    final cursor = current?.nextCursor;
    if (current == null || cursor == null || current.loadingMore || state.isLoading) return;
    final generation = _generation;
    state = AsyncData(current.copyWith(loadingMore: true, loadMoreFailed: false));
    try {
      final page = await _api.inbox(cursor: cursor, limit: inboxPageSize);
      if (generation != _generation) return;
      final latest = state.valueOrNull ?? current;
      final known = {for (final item in latest.items) item.id};
      state = AsyncData(
        InboxState(
          items: [
            ...latest.items,
            for (final item in page.items)
              if (!known.contains(item.id)) _withLocalReads(item),
          ],
          nextCursor: page.nextCursor,
        ),
      );
      _unread.set(page.unreadCount);
    } on Object catch (error) {
      if (generation != _generation) return;
      debugPrint('Inbox page failed: $error');
      state = AsyncData((state.valueOrNull ?? current).copyWith(loadingMore: false, loadMoreFailed: true));
    }
  }

  /// Shows [item] read at once — in the list and on the badges — and tells
  /// the server; a failure puts it back. Reading one already read does
  /// nothing.
  Future<void> markRead(InboxItem item) async {
    if (item.isRead || !_read.add(item.id)) return;
    final at = DateTime.now().toUtc();
    _patch(item.id, at);
    _unread.adjust(-1);
    try {
      await _api.markInboxItemRead(item.id);
      // A page that landed meanwhile may still have it unread.
      _patch(item.id, at);
    } on Object catch (error) {
      debugPrint('Marking an inbox item read failed: $error');
      _read.remove(item.id);
      _patch(item.id, null);
      unawaited(_unread.refresh());
    }
  }

  /// «Прочитать все». Shown at once; a failure puts everything back and is
  /// rethrown for the screen to say so.
  Future<void> markAllRead() async {
    final before = state.valueOrNull;
    final unreadBefore = ref.read(inboxUnreadProvider);
    final newlyRead = [
      for (final item in before?.items ?? const <InboxItem>[])
        if (!item.isRead && !_read.contains(item.id)) item.id,
    ];
    final at = DateTime.now().toUtc();
    _read.addAll(newlyRead);
    if (before != null) {
      state = AsyncData(
        before.copyWith(items: [for (final item in before.items) item.isRead ? item : item.withReadAt(at)]),
      );
    }
    _unread.set(0);
    try {
      await _api.markInboxRead();
    } on Object catch (error) {
      _read.removeAll(newlyRead);
      if (before != null) state = AsyncData(before);
      _unread.set(unreadBefore);
      throw ApiError.from(error);
    }
  }

  InboxItem _withLocalReads(InboxItem item) =>
      !item.isRead && _read.contains(item.id) ? item.withReadAt(DateTime.now().toUtc()) : item;

  void _patch(String id, DateTime? readAt) {
    final current = state.valueOrNull;
    final index = current?.items.indexWhere((item) => item.id == id) ?? -1;
    if (current == null || index < 0 || current.items[index].isRead == (readAt != null)) return;
    state = AsyncData(current.copyWith(items: [...current.items]..[index] = current.items[index].withReadAt(readAt)));
  }
}

final inboxProvider = AsyncNotifierProvider<InboxController, InboxState>(InboxController.new);

/// One message, for its own screen — opened from the list or from a push.
final inboxItemProvider = FutureProvider.autoDispose.family<InboxItem, String>((ref, id) {
  ref.watch(currentUserIdProvider);
  return _guard(() => ref.watch(apiProvider).inboxItem(id));
});

Future<T> _guard<T>(Future<T> Function() call) async {
  try {
    return await call();
  } on Object catch (error) {
    throw ApiError.from(error);
  }
}
