import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/format/time.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import 'inbox_links.dart';
import 'inbox_providers.dart';
import 'inbox_widgets.dart';

/// «Уведомления»: brand campaigns and takeAway's own announcements, newest
/// first. A tap reads the message and opens what it links to, or the whole
/// message when it links nowhere.
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key});

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  @override
  void initState() {
    super.initState();
    // The list is kept between visits; coming back shows what is new.
    if (ref.exists(inboxProvider)) ref.invalidate(inboxProvider);
  }

  Future<void> _refresh() async {
    ref.invalidate(inboxProvider);
    try {
      await ref.read(inboxProvider.future);
    } on Object {
      // The list shows the error itself.
    }
  }

  Future<void> _readAll() async {
    unawaited(HapticFeedback.selectionClick());
    try {
      await ref.read(inboxProvider.notifier).markAllRead();
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    }
  }

  void _open(InboxItem item) {
    unawaited(ref.read(inboxProvider.notifier).markRead(item));
    final target = inboxLinkTarget(item.link);
    if (target != null) {
      openInboxTarget(context, ref, target);
    } else {
      unawaited(context.push(Routes.inboxItem(item.id), extra: item));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final async = ref.watch(inboxProvider);
    final hasUnread = ref.watch(inboxUnreadProvider) > 0 || (async.valueOrNull?.hasUnread ?? false);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.inboxTitle),
        actions: [
          if (hasUnread) TextButton(onPressed: _readAll, child: Text(l10n.inboxReadAll)),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        color: context.brand.caramel,
        onRefresh: _refresh,
        child: async.when(
          loading: () => ShimmerScope(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (var i = 0; i < 5; i++) ...[
                  const Skeleton(height: 96, radius: Radii.card),
                  const SizedBox(height: 10),
                ],
              ],
            ),
          ),
          error: (error, _) => ListView(
            children: [ErrorState(error: error, onRetry: () => ref.invalidate(inboxProvider))],
          ),
          data: (state) => state.items.isEmpty
              ? ListView(
                  children: [
                    EmptyState(
                      icon: Icons.notifications_none_rounded,
                      title: l10n.inboxEmptyTitle,
                      message: l10n.inboxEmptyBody,
                    ),
                  ],
                )
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  itemCount: state.items.length + (state.hasMore ? 1 : 0),
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, index) => index < state.items.length
                      ? InboxRow(
                          key: ValueKey(state.items[index].id),
                          item: state.items[index],
                          onTap: () => _open(state.items[index]),
                        )
                      : _NextPage(
                          loading: state.loadingMore,
                          failed: state.loadMoreFailed,
                          onLoad: () => unawaited(ref.read(inboxProvider.notifier).loadMore()),
                        ),
                ),
        ),
      ),
    );
  }
}

/// One message in the list: who it is from, when, the title and the start
/// of the text; unread ones are tinted, set in bold and carry a dot.
class InboxRow extends StatelessWidget {
  const InboxRow({required this.item, required this.onTap, super.key});

  final InboxItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final unread = !item.isRead;
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Pressable(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
        decoration: BoxDecoration(
          color: unread ? Color.alphaBlend(brand.caramel.withValues(alpha: 0.06), brand.foam) : brand.foam,
          borderRadius: BorderRadius.circular(Radii.card),
          border: Border.all(color: brand.borderLight),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InboxAvatar(sender: item.sender),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.sender.name,
                          style: context.text.labelMedium?.copyWith(color: brand.textSecondary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        formatAgo(AppLocalizations.of(context), item.createdAt, locale: locale),
                        style: context.text.bodySmall?.copyWith(color: brand.textTertiary),
                      ),
                      if (unread) ...[const SizedBox(width: 6), const InboxUnreadDot()],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.title,
                    style: context.text.titleSmall?.copyWith(fontWeight: unread ? FontWeight.w800 : FontWeight.w600),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (item.body.trim().isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      item.body,
                      style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The end of the loaded list: asks for the next page as soon as it scrolls
/// into view, and offers a retry when that failed.
class _NextPage extends StatefulWidget {
  const _NextPage({required this.loading, required this.failed, required this.onLoad});

  final bool loading;
  final bool failed;
  final VoidCallback onLoad;

  @override
  State<_NextPage> createState() => _NextPageState();
}

class _NextPageState extends State<_NextPage> {
  @override
  void initState() {
    super.initState();
    if (!widget.failed) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onLoad();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: widget.failed && !widget.loading
            ? TextButton.icon(
                onPressed: widget.onLoad,
                icon: const Icon(Icons.refresh_rounded),
                label: Text(AppLocalizations.of(context).retry),
              )
            : SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2.4, color: brand.caramel)),
      ),
    );
  }
}
