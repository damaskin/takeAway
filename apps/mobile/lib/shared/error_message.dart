import 'package:flutter/widgets.dart';

import '../core/network/api_error.dart';
import '../features/auth/telegram_login.dart';
import '../l10n/app_localizations.dart';
import 'checkout_errors.dart';

/// Human text for any error thrown by the data layer. A stable code the
/// server sent (promo, gift card and order-path refusals) is worded in the
/// app's language; otherwise the server's own message wins when it sent one
/// (it is specific: "Store is closed", "The bank declined the payment"), and
/// a localized generic line when it did not.
String errorMessage(BuildContext context, Object error) {
  final l10n = AppLocalizations.of(context);
  // Telegram's own reasons are protocol codes ("invalid_grant"); the
  // customer only needs to know the sign-in did not go through.
  if (error is TelegramLoginException) return l10n.telegramSignInFailed;
  final apiError = ApiError.from(error);
  if (apiError.kind == ApiErrorKind.network) return l10n.networkError;
  return checkoutErrorText(context, apiError.code, apiError.details) ??
      giftCardErrorText(l10n, apiError.message) ??
      apiError.message ??
      l10n.genericError;
}
