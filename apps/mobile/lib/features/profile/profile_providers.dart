import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/network/api_error.dart';
import '../../core/providers.dart';

Future<T> _guard<T>(Future<T> Function() call) async {
  try {
    return await call();
  } on Object catch (error) {
    throw ApiError.from(error);
  }
}

final loyaltyProvider = FutureProvider<LoyaltyAccount?>((ref) async {
  if (ref.watch(currentUserIdProvider) == null) return null;
  return _guard(ref.watch(apiProvider).loyalty);
});

final referralsProvider = FutureProvider.autoDispose<ReferralSummary>((ref) {
  ref.watch(currentUserIdProvider);
  return _guard(ref.watch(apiProvider).referrals);
});

final giftCardsProvider = FutureProvider.autoDispose<List<GiftCardRedemption>>((ref) {
  ref.watch(currentUserIdProvider);
  return _guard(ref.watch(apiProvider).myGiftCards);
});

class NotificationPrefsController extends AutoDisposeAsyncNotifier<NotificationPrefs> {
  @override
  Future<NotificationPrefs> build() {
    ref.watch(currentUserIdProvider);
    return _guard(ref.watch(apiProvider).notificationPrefs);
  }

  Future<void> set({bool? orderUpdates, bool? promotions}) async {
    final before = state.valueOrNull;
    if (before != null) {
      state = AsyncData(
        NotificationPrefs(
          notifyOrderUpdates: orderUpdates ?? before.notifyOrderUpdates,
          notifyPromotions: promotions ?? before.notifyPromotions,
        ),
      );
    }
    try {
      state = AsyncData(
        await ref.read(apiProvider).updateNotificationPrefs({
          'notifyOrderUpdates': ?orderUpdates,
          'notifyPromotions': ?promotions,
        }),
      );
    } on Object catch (error) {
      if (before != null) state = AsyncData(before);
      throw ApiError.from(error);
    }
  }
}

final notificationPrefsProvider = AsyncNotifierProvider.autoDispose<NotificationPrefsController, NotificationPrefs>(
  NotificationPrefsController.new,
);

/// Cards bound through Agroprombank, shared by checkout and the payment
/// methods screen.
class CardsController extends AsyncNotifier<List<BoundCard>> {
  TakeAwayApi get _api => ref.read(apiProvider);

  @override
  Future<List<BoundCard>> build() async {
    if (ref.watch(currentUserIdProvider) == null) return const [];
    return _guard(ref.watch(apiProvider).cards);
  }

  Future<StartBindingResult> startBinding({
    required String institute,
    required String lastDigits,
    required String phone,
    String? label,
  }) async {
    final result = await _guard(
      () => _api.startCardBinding(
        BindCardRequest(
          institute: institute,
          lastDigits: lastDigits,
          phone: phone,
          label: label == null || label.trim().isEmpty ? null : label.trim(),
        ),
      ),
    );
    if (result.completed) await reload();
    return result;
  }

  Future<BoundCard> confirmBinding(String bindingId, String code) async {
    final card = await _guard(() => _api.confirmCardBinding(bindingId, {'code': code}));
    await reload();
    return card;
  }

  Future<void> makeDefault(String cardId) async {
    await _guard(() => _api.setDefaultCard(cardId));
    await reload();
  }

  Future<void> refreshCard(String cardId) async {
    await _guard(() => _api.refreshCard(cardId));
    await reload();
  }

  Future<void> remove(String cardId) async {
    final before = state.valueOrNull;
    if (before != null) state = AsyncData(before.where((c) => c.id != cardId).toList());
    try {
      await _api.deleteCard(cardId);
      await reload();
    } on Object catch (error) {
      if (before != null) state = AsyncData(before);
      throw ApiError.from(error);
    }
  }

  Future<void> reload() async {
    try {
      state = AsyncData(await _api.cards());
    } on Object catch (error) {
      state = AsyncError(ApiError.from(error), StackTrace.current);
    }
  }
}

final cardsProvider = AsyncNotifierProvider<CardsController, List<BoundCard>>(CardsController.new);

final cardInstitutesProvider = FutureProvider<List<CardInstitute>>(
  (ref) => _guard(ref.watch(apiProvider).cardInstitutes),
);
