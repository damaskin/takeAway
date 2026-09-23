import 'package:flutter/widgets.dart';

import '../core/network/api_error.dart';
import '../features/auth/telegram_login.dart';
import '../l10n/app_localizations.dart';

/// Human text for any error thrown by the data layer. The server's own
/// message wins when it sent one (it is specific: "Store is closed",
/// "The bank declined the payment"); otherwise a localized generic line.
String errorMessage(BuildContext context, Object error) {
  final l10n = AppLocalizations.of(context);
  // Telegram's own reasons are protocol codes ("invalid_grant"); the
  // customer only needs to know the sign-in did not go through.
  if (error is TelegramLoginException) return l10n.telegramSignInFailed;
  final apiError = ApiError.from(error);
  return switch (apiError.kind) {
    ApiErrorKind.network => l10n.networkError,
    ApiErrorKind.server => apiError.message ?? l10n.genericError,
    _ => apiError.message ?? l10n.genericError,
  };
}
