import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/app_button.dart';
import 'orders_providers.dart';

/// «Как вам заказ?» under the hero of a handed-over order: five stars, an
/// optional comment and «Отправить»; once sent, or sent before, the thanks
/// with the stars given. One review per order and no edits. Only the
/// takeAway team reads it — the brand never sees it, and the card says so.
/// Nothing else asks for a review: no push, no prompt.
class OrderReviewCard extends ConsumerStatefulWidget {
  const OrderReviewCard({required this.order, super.key});

  final Order order;

  @override
  ConsumerState<OrderReviewCard> createState() => _OrderReviewCardState();
}

class _OrderReviewCardState extends ConsumerState<OrderReviewCard> with AutomaticKeepAliveClientMixin<OrderReviewCard> {
  final _comment = TextEditingController();
  int _rating = 0;
  bool _sending = false;
  bool _failed = false;

  /// Scrolling down to the receipt must not drop a half-written review.
  @override
  bool get wantKeepAlive => true;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  void _pick(int rating) {
    if (_sending) return;
    setState(() {
      _rating = rating;
      _failed = false;
    });
  }

  Future<void> _send() async {
    if (_sending || _rating == 0) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _sending = true;
      _failed = false;
    });
    try {
      await ref.read(orderProvider(widget.order.id).notifier).review(_rating, comment: _comment.text);
      unawaited(HapticFeedback.mediumImpact());
    } on Object {
      // The stars and the comment stay, so a retry is one tap.
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final review = widget.order.review;
    return AnimatedSize(
      duration: Motion.medium,
      curve: Motion.emphasized,
      alignment: Alignment.topCenter,
      child: AnimatedSwitcher(
        duration: Motion.medium,
        child: review != null
            ? _ReviewThanks(key: const ValueKey('order-review-thanks'), review: review)
            : _form(context),
      ),
    );
  }

  Widget _form(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    return _ReviewFrame(
      key: const ValueKey('order-review-form'),
      children: [
        Text(l10n.orderReviewTitle, textAlign: TextAlign.center, style: context.text.titleMedium),
        const SizedBox(height: 2),
        Text(
          l10n.orderReviewHint,
          textAlign: TextAlign.center,
          style: context.text.bodySmall?.copyWith(color: brand.textSecondary),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var n = 1; n <= 5; n++)
              IconButton(
                key: ValueKey('order-review-star-$n'),
                tooltip: l10n.orderReviewStar(n),
                isSelected: n == _rating,
                iconSize: 36,
                padding: const EdgeInsets.all(6),
                color: brand.caramel,
                onPressed: () => _pick(n),
                icon: Icon(n <= _rating ? Icons.star_rounded : Icons.star_outline_rounded),
              ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          key: const ValueKey('order-review-comment'),
          controller: _comment,
          enabled: !_sending,
          minLines: 2,
          maxLines: 5,
          maxLength: orderReviewCommentMaxLength,
          textCapitalization: TextCapitalization.sentences,
          keyboardType: TextInputType.multiline,
          decoration: InputDecoration(hintText: l10n.orderReviewCommentHint),
          buildCounter: _counter,
        ),
        if (_failed) ...[
          const SizedBox(height: 8),
          Text(
            l10n.orderReviewFailed,
            key: const ValueKey('order-review-error'),
            textAlign: TextAlign.center,
            style: context.text.bodyMedium?.copyWith(color: brand.berry),
          ),
        ],
        const SizedBox(height: 12),
        PrimaryButton(
          key: const ValueKey('order-review-send'),
          label: l10n.orderReviewSend,
          loading: _sending,
          onPressed: _rating == 0 ? null : () => unawaited(_send()),
        ),
      ],
    );
  }

  /// The counter shows only near the limit: a review rarely needs a tenth of
  /// it, and «0/1000» would just crowd the card.
  static Widget? _counter(
    BuildContext context, {
    required int currentLength,
    required bool isFocused,
    required int? maxLength,
  }) => maxLength != null && currentLength > maxLength - 100 ? Text('$currentLength/$maxLength') : null;
}

/// The review once it is sent: the thanks, the stars given and the comment.
class _ReviewThanks extends StatelessWidget {
  const _ReviewThanks({required this.review, super.key});

  final OrderReview review;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final comment = review.comment?.trim() ?? '';
    return _ReviewFrame(
      children: [
        Text(l10n.orderReviewThanks, textAlign: TextAlign.center, style: context.text.titleMedium),
        const SizedBox(height: 6),
        Semantics(
          container: true,
          label: l10n.orderReviewGiven(review.rating),
          child: ExcludeSemantics(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var n = 1; n <= 5; n++)
                  Icon(
                    n <= review.rating ? Icons.star_rounded : Icons.star_outline_rounded,
                    size: 26,
                    color: brand.caramel,
                  ),
              ],
            ),
          ),
        ),
        if (comment.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            comment,
            textAlign: TextAlign.center,
            style: context.text.bodyMedium?.copyWith(color: brand.textSecondary, fontStyle: FontStyle.italic),
          ),
        ],
      ],
    );
  }
}

/// The card both states share, in the style of the order screen's cards.
class _ReviewFrame extends StatelessWidget {
  const _ReviewFrame({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: brand.borderLight),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
  }
}
