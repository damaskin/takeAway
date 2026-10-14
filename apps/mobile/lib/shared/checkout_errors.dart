import 'package:flutter/widgets.dart';

import '../l10n/app_localizations.dart';
import 'money_text.dart';

/// Words for an order-path error the API sent with a stable code —
/// «Срок действия промокода истёк» instead of "Promo has expired". Takes the
/// rest of the error body (or of a promo check) for what the words need: the
/// items that ran out, the minimum order, the booking window. The same codes
/// and wording as the web (`libs/i18n` checkout-errors.ts).
///
/// Null when there is no code, or none this build has words for, so the
/// caller can fall back to the server's own message.
String? checkoutErrorText(BuildContext context, String? code, [Map<String, Object?> details = const {}]) {
  if (code == null) return null;
  final l10n = AppLocalizations.of(context);
  String amount() {
    final cents = details['minOrderCents'];
    final currency = details['currency'];
    return cents is num && currency is String && currency.isNotEmpty ? context.money(cents.toInt(), currency) : '';
  }

  int number(String key, int fallback) => switch (details[key]) {
    final num n => n.toInt(),
    _ => fallback,
  };

  return switch (code) {
    'CART_EMPTY' => l10n.errCartEmpty,
    'STORE_NOT_TAKING_ORDERS' => l10n.errStoreNotTakingOrders,
    'STORE_CLOSED_AT_TIME' => l10n.errStoreClosedAtTime,
    'PICKUP_SLOT_FULL' => l10n.errPickupSlotFull,
    'ASAP_UNAVAILABLE' => l10n.errAsapUnavailable,
    'PICKUP_TIME_OUT_OF_RANGE' => l10n.errPickupTimeOutOfRange(number('minMinutes', 15), number('maxHours', 24)),
    'ITEMS_UNAVAILABLE' => switch (details['items']) {
      final List<Object?> items when items.whereType<String>().isNotEmpty => l10n.errItemsUnavailable(
        items.whereType<String>().join(', '),
      ),
      _ => l10n.errItemsUnavailableGeneric,
    },
    'BELOW_MIN_ORDER' => amount().isEmpty ? l10n.errBelowMinOrderGeneric : l10n.errBelowMinOrder(amount()),
    'DELIVERY_UNAVAILABLE' => l10n.errDeliveryUnavailable,
    'DELIVERY_ADDRESS_REQUIRED' => l10n.errDeliveryAddressRequired,
    'DELIVERY_OUT_OF_RANGE' => l10n.errDeliveryOutOfRange,
    'PROMO_UNKNOWN' => l10n.errPromoUnknown,
    'PROMO_INACTIVE' => l10n.errPromoInactive,
    'PROMO_NOT_STARTED' => l10n.errPromoNotStarted,
    'PROMO_EXPIRED' => l10n.errPromoExpired,
    'PROMO_MIN_ORDER' => amount().isEmpty ? l10n.errPromoMinOrderGeneric : l10n.errPromoMinOrder(amount()),
    'PROMO_LIMIT_REACHED' => l10n.errPromoLimitReached,
    'PROMO_ALREADY_USED' => l10n.errPromoAlreadyUsed,
    'PROMO_NOT_ELIGIBLE' => l10n.errPromoNotEligible,
    'GIFT_CARD_UNKNOWN' => l10n.errGiftCardUnknown,
    'GIFT_CARD_OTHER_BRAND' => l10n.errGiftCardOtherBrand,
    'GIFT_CARD_CURRENCY' => l10n.errGiftCardCurrency,
    'GIFT_CARD_EXPIRED' => l10n.errGiftCardExpired,
    'GIFT_CARD_USED_UP' => l10n.errGiftCardUsedUp,
    'GIFT_CARD_CANCELLED' => l10n.errGiftCardCancelled,
    'GIFT_CARD_BALANCE_CHANGED' => l10n.errGiftCardBalanceChanged,
    'TOO_MANY_UNPAID_ORDERS' => l10n.errTooManyUnpaidOrders,
    _ => null,
  };
}

/// Words for a refused gift card from an API that predates the
/// `GIFT_CARD_*` codes: those sent only an English sentence
/// (`GiftCardsService.validateForOrder`), so they are told apart by it; null
/// for any other message.
String? giftCardErrorText(AppLocalizations l10n, String? message) {
  final text = message?.trim().toLowerCase();
  if (text == null || !text.startsWith('gift card')) return null;
  if (text == 'gift card not found') return l10n.errGiftCardUnknown;
  if (text.contains('not valid at this brand')) return l10n.errGiftCardOtherBrand;
  if (text.contains('currency')) return l10n.errGiftCardCurrency;
  if (text.contains('expired')) return l10n.errGiftCardExpired;
  if (text.contains('redeemed') || text.contains('no remaining balance')) return l10n.errGiftCardUsedUp;
  if (text.contains('cancelled')) return l10n.errGiftCardCancelled;
  return null;
}
