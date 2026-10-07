import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/network/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/error_message.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/state_views.dart';

/// This build's version, e.g. `1.2.0 (3)`, sent along so the team knows
/// which release a problem is about. Null when the platform cannot say.
final appVersionProvider = FutureProvider<String?>((ref) async {
  try {
    final info = await PackageInfo.fromPlatform();
    return '${info.version} (${info.buildNumber})';
  } on Object {
    return null;
  }
});

/// «Обратная связь»: a review, a suggestion or a problem report, read by the
/// takeAway team. Signed-in customers only — the router keeps guests out.
class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({super.key});

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  final _form = GlobalKey<FormState>();
  final _message = TextEditingController();
  final _contact = TextEditingController();
  FeedbackKind _kind = FeedbackKind.suggestion;
  bool _sending = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _message.dispose();
    _contact.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_sending || !_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _sending = true;
      _error = null;
    });
    final l10n = AppLocalizations.of(context);
    try {
      final contact = _contact.text.trim();
      await ref
          .read(apiProvider)
          .sendFeedback(
            CreateFeedbackRequest(
              kind: _kind,
              message: _message.text.trim(),
              source: defaultTargetPlatform == TargetPlatform.iOS ? FeedbackSource.ios : FeedbackSource.android,
              contact: contact.isEmpty ? null : contact,
              appVersion: await ref.read(appVersionProvider.future),
            ),
          );
      unawaited(HapticFeedback.lightImpact());
      if (mounted) setState(() => _sent = true);
    } on Object catch (error) {
      if (!mounted) return;
      // What the customer typed stays in the form, so a retry is one tap.
      setState(
        () => _error = ApiError.from(error).kind == ApiErrorKind.rateLimited
            ? l10n.feedbackTooMany
            : errorMessage(context, error),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _hint(AppLocalizations l10n) => switch (_kind) {
    FeedbackKind.review => l10n.feedbackHintReview,
    FeedbackKind.suggestion => l10n.feedbackHintSuggestion,
    FeedbackKind.problem => l10n.feedbackHintProblem,
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileFeedback)),
      body: _sent
          ? EmptyState(
              icon: Icons.mark_email_read_outlined,
              title: l10n.feedbackSentTitle,
              message: l10n.feedbackSentBody,
              actionLabel: l10n.feedbackDone,
              onAction: () => unawaited(Navigator.of(context).maybePop()),
            )
          : Form(
              key: _form,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(l10n.feedbackIntro, style: context.text.bodyMedium?.copyWith(color: brand.textSecondary)),
                  const SizedBox(height: 16),
                  SegmentedButton<FeedbackKind>(
                    showSelectedIcon: false,
                    segments: [
                      ButtonSegment(value: FeedbackKind.review, label: Text(l10n.feedbackKindReview)),
                      ButtonSegment(value: FeedbackKind.suggestion, label: Text(l10n.feedbackKindSuggestion)),
                      ButtonSegment(value: FeedbackKind.problem, label: Text(l10n.feedbackKindProblem)),
                    ],
                    selected: {_kind},
                    onSelectionChanged: _sending ? null : (picked) => setState(() => _kind = picked.first),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _message,
                    enabled: !_sending,
                    minLines: 5,
                    maxLines: 10,
                    maxLength: feedbackMessageMaxLength,
                    textCapitalization: TextCapitalization.sentences,
                    keyboardType: TextInputType.multiline,
                    decoration: InputDecoration(
                      labelText: l10n.feedbackMessageLabel,
                      hintText: _hint(l10n),
                      alignLabelWithHint: true,
                    ),
                    validator: (v) => (v ?? '').trim().isEmpty ? l10n.feedbackMessageRequired : null,
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _contact,
                    enabled: !_sending,
                    maxLength: feedbackContactMaxLength,
                    textInputAction: TextInputAction.done,
                    decoration: InputDecoration(
                      labelText: l10n.feedbackContactLabel,
                      hintText: l10n.feedbackContactHint,
                      counterText: '',
                    ),
                    onFieldSubmitted: (_) => unawaited(_send()),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: context.text.bodyMedium?.copyWith(color: brand.berry),
                    ),
                  ],
                  const SizedBox(height: 20),
                  PrimaryButton(label: l10n.feedbackSend, loading: _sending, onPressed: () => unawaited(_send())),
                ],
              ),
            ),
    );
  }
}
