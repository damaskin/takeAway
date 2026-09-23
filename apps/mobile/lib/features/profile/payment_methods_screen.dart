import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/error_message.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../catalog/catalog_providers.dart';
import 'profile_providers.dart';

/// Agroprombank («Клевер») cards: list, default, remove, and the two-step
/// binding (bank texts a one-time code). No card number ever passes
/// through the app — only the last four digits and the linked phone.
class PaymentMethodsScreen extends ConsumerWidget {
  const PaymentMethodsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final enabled = ref.watch(featureFlagsProvider).valueOrNull?.agroprombankEnabled ?? false;
    final async = ref.watch(cardsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.paymentMethodsTitle)),
      body: !enabled
          ? EmptyState(icon: Icons.credit_card_off_outlined, title: l10n.paymentMethodsUnavailable, compact: true)
          : RefreshIndicator(
              color: brand.caramel,
              onRefresh: () => ref.read(cardsProvider.notifier).reload(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    l10n.paymentMethodsSubtitle,
                    style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
                  ),
                  const SizedBox(height: 16),
                  ...async.when(
                    loading: () => [const ShimmerScope(child: Skeleton(height: 84, radius: Radii.card))],
                    error: (error, _) => [
                      ErrorState(error: error, onRetry: () => ref.invalidate(cardsProvider), compact: true),
                    ],
                    data: (cards) => cards.isEmpty
                        ? [EmptyState(icon: Icons.credit_card_outlined, title: l10n.paymentMethodsEmpty, compact: true)]
                        : [for (final card in cards) _CardTile(card: card)],
                  ),
                  const SizedBox(height: 16),
                  PrimaryButton(
                    label: l10n.cardAddTitle,
                    icon: Icons.add_card_rounded,
                    onPressed: () => showModalBottomSheet<void>(
                      context: context,
                      isScrollControlled: true,
                      useSafeArea: true,
                      builder: (_) => const _BindCardSheet(),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _CardTile extends ConsumerStatefulWidget {
  const _CardTile({required this.card});

  final BoundCard card;

  @override
  ConsumerState<_CardTile> createState() => _CardTileState();
}

class _CardTileState extends ConsumerState<_CardTile> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove() async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.cardRemoveTitle),
        content: Text(widget.card.maskedPan ?? ''),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: context.brand.berry),
            child: Text(l10n.remove),
          ),
        ],
      ),
    );
    if (ok == true) await _run(() => ref.read(cardsProvider.notifier).remove(widget.card.id));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final card = widget.card;
    final title = card.label ?? card.maskedPan ?? l10n.cardFallbackTitle;
    final subtitle = [
      if (card.label != null) card.maskedPan,
      card.instituteName,
      if (card.isInactive) l10n.cardInactive,
    ].whereType<String>().join(' · ');

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(16, 12, 4, 12),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: card.isDefault ? brand.caramel : brand.borderLight, width: card.isDefault ? 1.5 : 1),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 34,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              gradient: LinearGradient(colors: [brand.caramel, Color.lerp(brand.caramel, brand.espresso, 0.5)!]),
            ),
            alignment: Alignment.bottomRight,
            padding: const EdgeInsets.all(4),
            child: Text(card.last4 ?? '', style: context.text.labelSmall?.copyWith(color: Colors.white)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(title, style: context.text.titleSmall, overflow: TextOverflow.ellipsis),
                    ),
                    if (card.isDefault) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: brand.caramelSoft,
                          borderRadius: BorderRadius.circular(Radii.pill),
                        ),
                        child: Text(l10n.cardDefault, style: context.text.labelSmall?.copyWith(color: brand.caramel)),
                      ),
                    ],
                  ],
                ),
                if (subtitle.isNotEmpty)
                  Text(subtitle, style: context.text.bodySmall?.copyWith(color: card.isInactive ? brand.berry : null)),
              ],
            ),
          ),
          _busy
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                )
              : PopupMenuButton<String>(
                  onSelected: (action) => switch (action) {
                    'default' => _run(() => ref.read(cardsProvider.notifier).makeDefault(card.id)),
                    'refresh' => _run(() => ref.read(cardsProvider.notifier).refreshCard(card.id)),
                    _ => _remove(),
                  },
                  itemBuilder: (context) => [
                    if (!card.isDefault) PopupMenuItem(value: 'default', child: Text(l10n.cardMakeDefault)),
                    PopupMenuItem(value: 'refresh', child: Text(l10n.cardRefresh)),
                    PopupMenuItem(
                      value: 'remove',
                      child: Text(l10n.remove, style: TextStyle(color: context.brand.berry)),
                    ),
                  ],
                ),
        ],
      ),
    );
  }
}

class _BindCardSheet extends ConsumerStatefulWidget {
  const _BindCardSheet();

  @override
  ConsumerState<_BindCardSheet> createState() => _BindCardSheetState();
}

class _BindCardSheetState extends ConsumerState<_BindCardSheet> {
  final _form = GlobalKey<FormState>();
  final _last4 = TextEditingController();
  final _phone = TextEditingController();
  final _label = TextEditingController();
  final _code = TextEditingController();
  String? _institute;
  String? _bindingId;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_last4, _phone, _label, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _sendCode() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(cardsProvider.notifier)
          .startBinding(
            institute: _institute!,
            lastDigits: _last4.text.trim(),
            phone: _phone.text.replaceAll(RegExp(r'\D'), ''),
            label: _label.text,
          );
      if (!mounted) return;
      if (result.completed) {
        _done();
        return;
      }
      setState(() => _bindingId = result.bindingId);
    } on Object catch (error) {
      if (mounted) setState(() => _error = errorMessage(context, error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{4,8}$').hasMatch(code) || _bindingId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(cardsProvider.notifier).confirmBinding(_bindingId!, code);
      if (mounted) _done();
    } on Object catch (error) {
      if (mounted) setState(() => _error = errorMessage(context, error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _done() {
    HapticFeedback.mediumImpact();
    Navigator.of(context).pop();
    Snack.show(context, AppLocalizations.of(context).cardAdded, icon: Icons.check_circle_rounded);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final institutes = ref.watch(cardInstitutesProvider);
    _institute ??= institutes.valueOrNull?.firstOrNull?.code;
    final codeStep = _bindingId != null;

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Form(
        key: _form,
        child: SingleChildScrollView(
          child: AnimatedSwitcher(
            duration: Motion.medium,
            child: codeStep
                ? Column(
                    key: const ValueKey('code'),
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(l10n.cardCodeTitle, style: context.text.headlineSmall),
                      const SizedBox(height: 6),
                      Text(
                        l10n.cardCodeSent(_phone.text),
                        style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
                      ),
                      const SizedBox(height: 16),
                      TextField(
                        controller: _code,
                        autofocus: true,
                        keyboardType: TextInputType.number,
                        textAlign: TextAlign.center,
                        autofillHints: const [AutofillHints.oneTimeCode],
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(8)],
                        style: context.text.headlineMedium?.copyWith(letterSpacing: 8),
                        onChanged: (v) {
                          if (v.length == 6) _confirm();
                        },
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 10),
                        Text(_error!, style: context.text.bodySmall?.copyWith(color: brand.berry)),
                      ],
                      const SizedBox(height: 16),
                      PrimaryButton(label: l10n.confirm, loading: _busy, onPressed: _confirm),
                      TextButton(
                        onPressed: _busy ? null : () => setState(() => _bindingId = null),
                        child: Text(l10n.cardStartOver),
                      ),
                    ],
                  )
                : Column(
                    key: const ValueKey('form'),
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(l10n.cardAddTitle, style: context.text.headlineSmall),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                        initialValue: _institute,
                        decoration: InputDecoration(labelText: l10n.cardIssuer),
                        items: [
                          for (final i in institutes.valueOrNull ?? const <CardInstitute>[])
                            DropdownMenuItem(value: i.code, child: Text(i.name)),
                        ],
                        onChanged: (v) => setState(() => _institute = v),
                        validator: (v) => v == null ? l10n.cardIssuer : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _last4,
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
                        decoration: InputDecoration(labelText: l10n.cardLast4, prefixText: '•••• '),
                        validator: (v) => RegExp(r'^\d{4}$').hasMatch(v ?? '') ? null : l10n.cardLast4,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _phone,
                        keyboardType: TextInputType.phone,
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(RegExp(r'[0-9\s()-]')),
                          LengthLimitingTextInputFormatter(16),
                        ],
                        decoration: InputDecoration(labelText: l10n.cardPhone, hintText: l10n.cardPhoneHint),
                        validator: (v) {
                          final digits = (v ?? '').replaceAll(RegExp(r'\D'), '');
                          return digits.length >= 6 && digits.length <= 12 ? null : l10n.cardPhoneHint;
                        },
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _label,
                        decoration: InputDecoration(labelText: l10n.cardLabel),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.lock_outline_rounded, size: 18, color: brand.textTertiary),
                          const SizedBox(width: 8),
                          Expanded(child: Text(l10n.cardPrivacy, style: context.text.bodySmall)),
                        ],
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 10),
                        Text(_error!, style: context.text.bodySmall?.copyWith(color: brand.berry)),
                      ],
                      const SizedBox(height: 16),
                      PrimaryButton(label: l10n.cardSendCode, loading: _busy, onPressed: _sendCode),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
