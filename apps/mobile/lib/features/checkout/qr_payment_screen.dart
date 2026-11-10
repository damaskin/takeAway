import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/network/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/error_message.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/state_views.dart';
import '../catalog/catalog_providers.dart';
import '../orders/orders_providers.dart';
import '../profile/profile_providers.dart';
import 'qr_payment.dart';
import 'web_payment.dart';

/// Paying an order by QR in Agroprombank's app: the code with its amount and
/// countdown, a button that opens the bank's app on this phone when the
/// server has a link for it, and the outcome. Paid → the order screen.
/// Leaving (the cross, back) keeps the invoice; only «Отменить» calls it off.
class QrPaymentScreen extends ConsumerStatefulWidget {
  const QrPaymentScreen({required this.orderId, this.justPlaced = false, this.initial, super.key});

  final String orderId;

  /// Straight from checkout: there is no order screen under this one yet.
  final bool justPlaced;

  /// The invoice checkout has just started, so it is not asked for twice.
  final QrPayment? initial;

  @override
  ConsumerState<QrPaymentScreen> createState() => _QrPaymentScreenState();
}

/// Error codes after which asking again cannot help.
const _finalCodes = {'ORDER_NOT_PAYABLE', 'QR_PAYMENT_DISABLED', 'QR_CURRENCY_UNSUPPORTED'};

class _QrPaymentScreenState extends ConsumerState<QrPaymentScreen> {
  late final AppLifecycleListener _lifecycle;
  bool _left = false;
  bool _payingByCard = false;

  QrPaymentController get _controller => ref.read(qrPaymentProvider(widget.orderId).notifier);

  @override
  void initState() {
    super.initState();
    // After this build: providers do not change while the tree is building.
    scheduleMicrotask(() {
      if (mounted) unawaited(_controller.open(initial: widget.initial));
    });
    // The customer pays in the bank's app, over this one: no polling while
    // away, a check the moment they are back.
    _lifecycle = AppLifecycleListener(onHide: () => _controller.pause(), onResume: () => _controller.resume());
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  /// To the order: back to its screen when it is under this one, else in
  /// place of this one. Never calls the invoice off.
  void _leave({bool paid = false}) {
    if (_left || !mounted) return;
    _left = true;
    if (paid) unawaited(HapticFeedback.heavyImpact());
    ref.invalidate(ordersProvider);
    final router = GoRouter.of(context);
    if (widget.justPlaced) {
      unawaited(router.pushReplacement(Routes.order(widget.orderId, placed: true)));
    } else if (router.canPop()) {
      router.pop(paid);
    } else {
      router.go(Routes.order(widget.orderId));
    }
  }

  Future<void> _openBankApp(Uri link) async {
    final opened = await ref.read(bankAppLauncherProvider).open(link);
    if (!opened && mounted) {
      Snack.show(context, AppLocalizations.of(context).qrPayBankAppNotOpened, icon: Icons.error_outline_rounded);
    }
  }

  Future<void> _cancel() async {
    try {
      // The phase it ends in takes the customer to the order (see build).
      await _controller.cancel();
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    }
  }

  /// Pays by card instead: on the bank's page in the web flow (the order
  /// screen then waits for the verdict), with the default bound card in the
  /// token flow.
  Future<void> _payByCard(_CardWay way) async {
    if (_payingByCard) return;
    setState(() => _payingByCard = true);
    try {
      if (way.card == null) {
        final launch = await ref.read(webPaymentsProvider).launch(widget.orderId);
        if (!mounted) return;
        if (launch == WebPaymentLaunch.notOpened) {
          Snack.show(context, AppLocalizations.of(context).webPaymentNotOpened, icon: Icons.error_outline_rounded);
          return;
        }
        _leave();
      } else {
        await ref.read(apiProvider).payWithCard({'orderId': widget.orderId, 'cardId': way.card!.id});
        ref.invalidate(cardsProvider);
        _leave(paid: true);
      }
    } on Object catch (error) {
      if (mounted) Snack.error(context, ApiError.from(error));
    } finally {
      if (mounted) setState(() => _payingByCard = false);
    }
  }

  /// How «Оплатить картой» pays from here, or null when cards are off (or
  /// no bound card can be charged).
  _CardWay? _cardWay(FeatureFlags flags) {
    if (flags.webPaymentsEnabled) return const _CardWay();
    if (!flags.boundCardsEnabled) return null;
    final usable = (ref.watch(cardsProvider).valueOrNull ?? const <BoundCard>[]).where((c) => !c.isInactive);
    final card = usable.where((c) => c.isDefault).firstOrNull ?? usable.firstOrNull;
    return card == null ? null : _CardWay(card: card);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final provider = qrPaymentProvider(widget.orderId);
    ref.listen(provider.select((s) => s.phase), (_, phase) {
      switch (phase) {
        case QrPhase.paid:
          _leave(paid: true);
        case QrPhase.refunded || QrPhase.cancelled:
          _leave();
        case QrPhase.starting || QrPhase.pending || QrPhase.expired || QrPhase.failed:
          break;
      }
    });
    final state = ref.watch(provider);
    final flags = ref.watch(featureFlagsProvider).valueOrNull ?? FeatureFlags.off;
    final cardWay = _cardWay(flags);

    final (Widget body, Widget? actions) = switch (state.phase) {
      QrPhase.pending when state.code != null => (
        _PendingBody(payment: state.payment!, code: state.code!),
        _PendingActions(
          appLink: state.code!.appLinkUri,
          cancelling: state.cancelling,
          onOpen: _openBankApp,
          onCancel: _cancel,
        ),
      ),
      QrPhase.expired => (
        _Outcome(
          key: const ValueKey('qr-expired'),
          icon: Icons.timer_off_outlined,
          title: l10n.qrPayExpiredTitle,
          message: l10n.qrPayExpiredBody,
        ),
        _OutcomeActions(
          primary: (l10n.qrPayNewCode, Icons.qr_code_2_rounded, _controller.start),
          card: cardWay,
          payingByCard: _payingByCard,
          onCard: _payByCard,
        ),
      ),
      QrPhase.failed => _failure(context, state.error, cardWay),
      _ => (const Center(child: CircularProgressIndicator()), null),
    };

    return PopScope(
      // From checkout there is no order screen to go back to yet: back
      // opens it in place of this one.
      canPop: !widget.justPlaced,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _leave();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(icon: const Icon(Icons.close_rounded), onPressed: _leave),
          title: Text(l10n.qrPayTitle),
          centerTitle: true,
        ),
        body: AnimatedSwitcher(duration: Motion.medium, child: body),
        bottomNavigationBar: actions == null
            ? null
            : SafeArea(minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: actions),
      ),
    );
  }

  (Widget, Widget?) _failure(BuildContext context, ApiError? error, _CardWay? cardWay) {
    final l10n = AppLocalizations.of(context);
    final retryable = !_finalCodes.contains(error?.code);
    return (
      _Outcome(
        key: const ValueKey('qr-failed'),
        icon: Icons.error_outline_rounded,
        title: l10n.qrPayFailedTitle,
        message: error == null ? l10n.qrPayFailedBody : errorMessage(context, error),
      ),
      _OutcomeActions(
        primary: retryable
            ? (l10n.retry, Icons.refresh_rounded, _controller.start)
            : (l10n.qrPayToOrder, Icons.receipt_long_outlined, _leave),
        // An order that can no longer be paid cannot be paid by card either.
        card: error?.code == 'ORDER_NOT_PAYABLE' ? null : cardWay,
        payingByCard: _payingByCard,
        onCard: _payByCard,
        toOrder: retryable ? _leave : null,
      ),
    );
  }
}

/// Paying by card from the QR screen: on the bank's page ([card] null) or
/// with this bound card.
class _CardWay {
  const _CardWay({this.card});

  final BoundCard? card;
}

class _PendingBody extends StatelessWidget {
  const _PendingBody({required this.payment, required this.code});

  final QrPayment payment;
  final QrPaymentCode code;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final side = (MediaQuery.sizeOf(context).width * 0.66).clamp(200.0, 300.0);

    return ListView(
      key: const ValueKey('qr-pending'),
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Text(
          l10n.qrPayToPay,
          textAlign: TextAlign.center,
          style: context.text.bodyLarge?.copyWith(color: brand.textSecondary),
        ),
        Text(
          context.money(payment.amountCents, payment.currency),
          textAlign: TextAlign.center,
          style: context.text.headlineLarge,
        ),
        const SizedBox(height: 16),
        Center(
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              // Dark modules on white in either theme: scanners expect it.
              color: Colors.white,
              borderRadius: BorderRadius.circular(Radii.card),
              border: Border.all(color: brand.borderLight),
            ),
            child: QrImageView(
              key: const ValueKey('qr-code'),
              data: code.code,
              size: side,
              padding: EdgeInsets.zero,
              backgroundColor: Colors.white,
              errorCorrectionLevel: QrErrorCorrectLevel.M,
              semanticsLabel: l10n.qrPayTitle,
            ),
          ),
        ),
        const SizedBox(height: 12),
        _Countdown(expiresAt: code.expiresAt),
        const SizedBox(height: 16),
        Text(l10n.qrPayScanHint, textAlign: TextAlign.center, style: context.text.bodyMedium),
        if (code.appLinkUri == null) ...[
          const SizedBox(height: 6),
          Text(
            l10n.qrPayOtherDevice,
            textAlign: TextAlign.center,
            style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
          ),
        ],
        const SizedBox(height: 20),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2, color: brand.caramel)),
            const SizedBox(width: 8),
            Text(l10n.qrPayWaiting, style: context.text.bodySmall),
          ],
        ),
      ],
    );
  }
}

/// «Код действует ещё 9:41», ticking on its own so the code is not redrawn
/// every second.
class _Countdown extends ConsumerStatefulWidget {
  const _Countdown({required this.expiresAt});

  final DateTime expiresAt;

  @override
  ConsumerState<_Countdown> createState() => _CountdownState();
}

class _CountdownState extends ConsumerState<_Countdown> {
  late final Timer _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final left = widget.expiresAt.difference(ref.read(qrClockProvider)());
    final seconds = math.max(0, left.inMilliseconds / 1000).ceil();
    final clock = '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
    return Text(
      AppLocalizations.of(context).qrPayValidFor(clock),
      key: const ValueKey('qr-countdown'),
      textAlign: TextAlign.center,
      style: context.text.titleSmall?.copyWith(
        color: seconds <= 60 ? brand.berry : brand.textSecondary,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
  }
}

class _PendingActions extends StatelessWidget {
  const _PendingActions({
    required this.appLink,
    required this.cancelling,
    required this.onOpen,
    required this.onCancel,
  });

  /// Opens the bank's app with the invoice; null when there is no such link.
  final Uri? appLink;
  final bool cancelling;
  final ValueChanged<Uri> onOpen;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final link = appLink;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (link != null) ...[
          PrimaryButton(
            key: const ValueKey('qr-open-bank'),
            label: l10n.qrPayOpenBankApp,
            icon: Icons.open_in_new_rounded,
            onPressed: () => onOpen(link),
          ),
          const SizedBox(height: 8),
        ],
        TextButton(
          key: const ValueKey('qr-cancel'),
          onPressed: cancelling ? null : onCancel,
          style: TextButton.styleFrom(foregroundColor: context.brand.berry),
          child: cancelling
              ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : Text(l10n.qrPayCancel),
        ),
      ],
    );
  }
}

/// An invoice that is not (or no longer) there to pay: what happened, and
/// what can be done about it under the thumb.
class _Outcome extends StatelessWidget {
  const _Outcome({required this.icon, required this.title, required this.message, super.key});

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: brand.caramel),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center, style: context.text.headlineMedium),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}

class _OutcomeActions extends StatelessWidget {
  const _OutcomeActions({
    required this.primary,
    required this.card,
    required this.payingByCard,
    required this.onCard,
    this.toOrder,
  });

  final (String, IconData, VoidCallback) primary;

  /// «Оплатить картой», when a card can pay.
  final _CardWay? card;
  final bool payingByCard;
  final ValueChanged<_CardWay> onCard;

  /// «К заказу» under the rest; null when the primary action is that already.
  final VoidCallback? toOrder;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (label, icon, onPressed) = primary;
    final way = card;
    final last4 = way?.card?.last4;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PrimaryButton(key: const ValueKey('qr-primary'), label: label, icon: icon, onPressed: onPressed),
        if (way != null) ...[
          const SizedBox(height: 8),
          SecondaryButton(
            key: const ValueKey('qr-pay-by-card'),
            label: last4 == null ? l10n.qrPayByCard : '${l10n.qrPayByCard} · •••• $last4',
            icon: Icons.credit_card_rounded,
            onPressed: payingByCard ? null : () => onCard(way),
          ),
        ],
        if (toOrder != null) TextButton(onPressed: toOrder, child: Text(l10n.qrPayToOrder)),
      ],
    );
  }
}
