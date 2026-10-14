import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/error_message.dart';
import 'auth_service.dart';

/// Seconds before another code may go to the same address — the API's own pause.
const emailCodeResendSeconds = 60;

final _emailPattern = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

/// Words for a refusal of the email sign-in routes, by the stable `code`
/// the API sends; null when the error carries none of them.
String? emailSignInErrorText(AppLocalizations l10n, ApiError error) {
  int? number(String key) => switch (error.details[key]) {
    final num n => n.toInt(),
    _ => null,
  };
  return switch (error.code) {
    'EMAIL_CODE_INVALID' => l10n.emailCodeInvalid(number('attemptsLeft') ?? 0),
    'EMAIL_CODE_EXPIRED' => l10n.emailCodeExpired,
    'EMAIL_CODE_TOO_MANY_ATTEMPTS' => l10n.emailCodeTooManyAttempts,
    'EMAIL_CODE_LIMIT' => l10n.emailCodeLimit(((number('retryAfterSeconds') ?? 3600) / 60).ceil().clamp(1, 60)),
    'EMAIL_CODE_NOT_SENT' => l10n.emailCodeNotSent,
    'EMAIL_LOGIN_UNAVAILABLE' => l10n.emailSignInUnavailable,
    'EMAIL_LOGIN_STAFF_ACCOUNT' => l10n.emailSignInStaffAccount,
    _ => error.kind == ApiErrorKind.rateLimited ? l10n.emailSignInTooManyRequests : null,
  };
}

enum _Step { email, code }

/// «Войти по почте» inside the sign-in sheet, for customers without
/// Telegram or a Google / Apple account: address → «Получить код» → the
/// six digits from the letter. The code field offers the code from the
/// letter where the system can ([AutofillHints.oneTimeCode]), and six digits
/// sign in at once.
class EmailSignInForm extends ConsumerStatefulWidget {
  const EmailSignInForm({super.key, required this.onSignedIn, required this.onBack});

  /// The customer is in.
  final VoidCallback onSignedIn;

  /// Back to the provider buttons.
  final VoidCallback onBack;

  @override
  ConsumerState<EmailSignInForm> createState() => _EmailSignInFormState();
}

class _EmailSignInFormState extends ConsumerState<EmailSignInForm> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _codeFocus = FocusNode();
  final _emailFocus = FocusNode();

  _Step _step = _Step.email;

  /// The address the current code went to.
  String _sentTo = '';

  /// The code step was reached because a code had gone out a moment ago.
  bool _alreadySent = false;
  bool _busy = false;
  String? _error;
  int _resendIn = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _email.dispose();
    _code.dispose();
    _codeFocus.dispose();
    _emailFocus.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    final email = _email.text.trim().toLowerCase();
    if (_busy || email.isEmpty) return;
    if (!_emailPattern.hasMatch(email)) {
      setState(() => _error = AppLocalizations.of(context).emailSignInInvalidEmail);
      return;
    }
    await _send(email);
  }

  Future<void> _resend() async {
    if (_busy || _resendIn > 0) return;
    await _send(_sentTo);
  }

  Future<void> _send(String email) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final locale = Localizations.localeOf(context).languageCode;
    try {
      await ref.read(authServiceProvider).startEmailSignIn(email, locale);
      if (mounted) _toCodeStep(email, emailCodeResendSeconds, alreadySent: false);
    } on Object catch (error) {
      if (!mounted) return;
      final apiError = ApiError.from(error);
      // A code went to this address a moment ago and still works: go and
      // type it, with the API's own wait on the resend link.
      if (apiError.code == 'EMAIL_CODE_COOLDOWN') {
        final wait = apiError.details['retryAfterSeconds'];
        _toCodeStep(email, wait is num ? wait.ceil() : emailCodeResendSeconds, alreadySent: true);
        return;
      }
      setState(() {
        _busy = false;
        _error = _describe(error);
      });
    }
  }

  void _toCodeStep(String email, int wait, {required bool alreadySent}) {
    _code.clear();
    setState(() {
      _busy = false;
      _error = null;
      _sentTo = email;
      _alreadySent = alreadySent;
      _step = _Step.code;
    });
    _startTimer(wait);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _codeFocus.requestFocus();
    });
  }

  Future<void> _verify() async {
    final code = _code.text;
    if (_busy || code.length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authServiceProvider).verifyEmailCode(_sentTo, code);
      _timer?.cancel();
      if (mounted) widget.onSignedIn();
    } on Object catch (error) {
      if (!mounted) return;
      _code.clear();
      setState(() {
        _busy = false;
        _error = _describe(error);
      });
      _codeFocus.requestFocus();
    }
  }

  void _changeEmail() {
    _timer?.cancel();
    _code.clear();
    setState(() {
      _resendIn = 0;
      _error = null;
      _step = _Step.email;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _emailFocus.requestFocus();
    });
  }

  void _startTimer(int seconds) {
    _timer?.cancel();
    setState(() => _resendIn = seconds < 0 ? 0 : seconds);
    if (_resendIn == 0) return;
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _resendIn = _resendIn > 0 ? _resendIn - 1 : 0);
      if (_resendIn == 0) timer.cancel();
    });
  }

  String _describe(Object error) {
    final l10n = AppLocalizations.of(context);
    final apiError = ApiError.from(error);
    if (apiError.isNetwork) return l10n.networkError;
    return emailSignInErrorText(l10n, apiError) ?? errorMessage(context, error);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final secondary = context.text.bodyMedium?.copyWith(color: brand.textSecondary);

    final fields = switch (_step) {
      _Step.email => <Widget>[
        TextField(
          key: const ValueKey('email-sign-in-address'),
          controller: _email,
          focusNode: _emailFocus,
          autofocus: true,
          enabled: !_busy,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          autocorrect: false,
          enableSuggestions: false,
          textInputAction: TextInputAction.send,
          inputFormatters: [LengthLimitingTextInputFormatter(254)],
          decoration: InputDecoration(labelText: l10n.emailSignInEmailLabel, hintText: l10n.emailSignInEmailHint),
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _requestCode(),
        ),
        const SizedBox(height: 12),
        _PrimaryButton(
          label: l10n.emailSignInGetCode,
          busy: _busy,
          enabled: _email.text.trim().isNotEmpty,
          onPressed: _requestCode,
        ),
      ],
      _Step.code => <Widget>[
        Text(
          _alreadySent ? l10n.emailSignInAlreadySent(_sentTo) : l10n.emailSignInSentTo(_sentTo),
          textAlign: TextAlign.center,
          style: secondary,
        ),
        const SizedBox(height: 12),
        TextField(
          key: const ValueKey('email-sign-in-code'),
          controller: _code,
          focusNode: _codeFocus,
          enabled: !_busy,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          textAlign: TextAlign.center,
          style: context.text.headlineSmall?.copyWith(letterSpacing: 8),
          decoration: InputDecoration(labelText: l10n.emailSignInCodeLabel),
          onChanged: (value) {
            setState(() {});
            // Six digits — typed, pasted or offered by the system — sign in at once.
            if (value.length == 6) unawaited(_verify());
          },
        ),
        const SizedBox(height: 12),
        _PrimaryButton(label: l10n.signIn, busy: _busy, enabled: _code.text.length == 6, onPressed: _verify),
        const SizedBox(height: 4),
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (_resendIn > 0)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                child: Text(
                  l10n.emailSignInResendIn(_resendIn),
                  style: context.text.bodySmall?.copyWith(color: brand.textTertiary),
                ),
              )
            else
              TextButton(onPressed: _busy ? null : _resend, child: Text(l10n.emailSignInResend)),
            TextButton(onPressed: _busy ? null : _changeEmail, child: Text(l10n.emailSignInChangeEmail)),
          ],
        ),
      ],
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ...fields,
        AnimatedSize(
          duration: Motion.medium,
          child: _error == null
              ? const SizedBox(width: double.infinity)
              : Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: context.text.bodyMedium?.copyWith(color: brand.berry),
                  ),
                ),
        ),
        const SizedBox(height: 4),
        TextButton.icon(
          onPressed: _busy ? null : widget.onBack,
          icon: const Icon(Icons.arrow_back_rounded, size: 18),
          label: Text(l10n.emailSignInOtherMethods),
        ),
      ],
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({required this.label, required this.busy, required this.enabled, required this.onPressed});

  final String label;
  final bool busy;
  final bool enabled;
  final Future<void> Function() onPressed;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return FilledButton(
      onPressed: busy || !enabled ? null : () => unawaited(onPressed()),
      style: FilledButton.styleFrom(
        backgroundColor: brand.caramel,
        foregroundColor: Colors.white,
        disabledBackgroundColor: brand.caramel.withValues(alpha: busy ? 0.7 : 0.4),
        disabledForegroundColor: Colors.white,
      ),
      child: busy
          ? const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
            )
          : Text(label),
    );
  }
}
