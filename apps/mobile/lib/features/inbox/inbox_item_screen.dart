import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/format/time.dart';
import '../../core/network/api_error.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../catalog/catalog_providers.dart';
import 'inbox_links.dart';
import 'inbox_providers.dart';
import 'inbox_widgets.dart';

/// One message in full — opened from the list, or from a tapped push. It
/// counts as read once it is on screen; what it links to is one button away.
class InboxItemScreen extends ConsumerStatefulWidget {
  const InboxItemScreen({required this.itemId, this.preview, super.key});

  final String itemId;

  /// The copy the list already has, shown while the message is read again.
  final InboxItem? preview;

  @override
  ConsumerState<InboxItemScreen> createState() => _InboxItemScreenState();
}

class _InboxItemScreenState extends ConsumerState<InboxItemScreen> {
  bool _marked = false;

  @override
  void initState() {
    super.initState();
    final preview = widget.preview;
    if (preview != null) _markRead(preview);
    ref.listenManual(inboxItemProvider(widget.itemId), (_, next) {
      final item = next.valueOrNull;
      if (item != null) _markRead(item);
    }, fireImmediately: true);
  }

  /// Once per visit, after the frame: reading updates the list beneath and
  /// the badges, which must not change while this screen is being built.
  void _markRead(InboxItem item) {
    if (_marked) return;
    _marked = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(ref.read(inboxProvider.notifier).markRead(item));
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final async = ref.watch(inboxItemProvider(widget.itemId));
    final item = async.valueOrNull ?? widget.preview;
    final error = async.error;

    if (item == null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.inboxTitle)),
        body: error == null
            ? const ShimmerScope(
                child: Padding(
                  padding: EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Skeleton(width: 180, height: 44, radius: Radii.card),
                      SizedBox(height: 20),
                      Skeleton(height: 28),
                      SizedBox(height: 12),
                      Skeleton(height: 120, radius: Radii.card),
                    ],
                  ),
                ),
              )
            : error is ApiError && error.kind == ApiErrorKind.notFound
            ? EmptyState(icon: Icons.notifications_off_outlined, title: l10n.inboxGone)
            : ErrorState(error: error, onRetry: () => ref.invalidate(inboxItemProvider(widget.itemId))),
      );
    }

    final brand = context.brand;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final created = item.createdAt.toLocal();
    final stores = ref.watch(storesProvider).valueOrNull?.value ?? const <Store>[];
    final target = inboxLinkTarget(item.link) ?? inboxSenderTarget(item, stores);
    final targetName = item.link?.name ?? item.sender.name;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.inboxTitle)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Row(
            children: [
              InboxAvatar(sender: item.sender, size: 48),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.sender.name,
                      style: context.text.titleSmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${DateFormat.MMMMd(locale).format(created)}, ${formatClock(context, created)}',
                      style: context.text.bodySmall?.copyWith(color: brand.textTertiary),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Text(item.title, style: context.text.headlineSmall),
          if (item.body.trim().isNotEmpty) ...[
            const SizedBox(height: 12),
            SelectableText(item.body, style: context.text.bodyLarge?.copyWith(height: 1.45)),
          ],
        ],
      ),
      bottomNavigationBar: target == null
          ? null
          : SafeArea(
              minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: PrimaryButton(
                icon: target.opensMenu ? Icons.local_cafe_rounded : Icons.storefront_rounded,
                label: target.opensMenu ? l10n.inboxOpenMenu(targetName) : l10n.inboxShowPlaces(targetName),
                onPressed: () => openInboxTarget(context, ref, target),
              ),
            ),
    );
  }
}
