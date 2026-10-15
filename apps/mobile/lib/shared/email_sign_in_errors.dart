import '../core/network/api_error.dart';
import '../l10n/app_localizations.dart';

/// Words for a refusal of the email sign-in routes — and of an email change
/// that would cut the profile off from them — by the stable `code` the API
/// sends; null when the error carries none of them.
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
    'EMAIL_IS_SIGN_IN_METHOD' => l10n.emailIsSignInMethod,
    _ => null,
  };
}
