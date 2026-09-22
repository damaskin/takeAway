import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/format/tax.dart';
import '../../core/location/location_service.dart';
import '../../core/network/api_error.dart';
import '../../core/providers.dart';
import '../../core/storage/app_prefs.dart';
import '../cart/cart_controller.dart';
import '../catalog/catalog_providers.dart';
import '../orders/orders_providers.dart';
import '../profile/profile_providers.dart';

/// A code the customer typed and what the server made of it.
class AppliedCode {
  const AppliedCode({this.code, this.cents = 0, this.message, this.ok = false, this.busy = false});

  final String? code;
  final int cents;

  /// Server's answer, success or refusal.
  final String? message;
  final bool ok;
  final bool busy;

  static const empty = AppliedCode();
}

class PointsState {
  const PointsState({this.spent = 0, this.cents = 0, this.min = 0, this.message, this.busy = false});

  final int spent;
  final int cents;
  final int min;
  final String? message;
  final bool busy;
}

class DeliveryState {
  const DeliveryState({
    this.lat,
    this.lng,
    this.feeCents = 0,
    this.distanceM,
    this.outside = false,
    this.locating = false,
  });

  final double? lat;
  final double? lng;
  final int feeCents;
  final double? distanceM;
  final bool outside;
  final bool locating;
}

class CheckoutState {
  const CheckoutState({
    this.fulfillment = FulfillmentType.pickup,
    this.mode = PickupMode.asap,
    this.slot,
    this.promo = AppliedCode.empty,
    this.promoMultiplier = 1,
    this.giftCard = AppliedCode.empty,
    this.points = const PointsState(),
    this.delivery = const DeliveryState(),
    this.cardId,
    this.cardChosen = false,
    this.submitting = false,
    this.error,
    this.placedOrderId,
  });

  final FulfillmentType fulfillment;
  final PickupMode mode;
  final DateTime? slot;
  final AppliedCode promo;
  final double promoMultiplier;
  final AppliedCode giftCard;
  final PointsState points;
  final DeliveryState delivery;

  /// Card to charge; null means "pay at the counter".
  final String? cardId;

  /// Whether the customer picked the method themselves (so a late-loading
  /// card list does not override their choice).
  final bool cardChosen;
  final bool submitting;
  final Object? error;

  /// Set once the order exists, so a declined card retries the charge
  /// instead of placing a second order.
  final String? placedOrderId;

  CheckoutState copyWith({
    FulfillmentType? fulfillment,
    PickupMode? mode,
    DateTime? Function()? slot,
    AppliedCode? promo,
    double? promoMultiplier,
    AppliedCode? giftCard,
    PointsState? points,
    DeliveryState? delivery,
    String? Function()? cardId,
    bool? cardChosen,
    bool? submitting,
    Object? Function()? error,
    String? placedOrderId,
  }) => CheckoutState(
    fulfillment: fulfillment ?? this.fulfillment,
    mode: mode ?? this.mode,
    slot: slot == null ? this.slot : slot(),
    promo: promo ?? this.promo,
    promoMultiplier: promoMultiplier ?? this.promoMultiplier,
    giftCard: giftCard ?? this.giftCard,
    points: points ?? this.points,
    delivery: delivery ?? this.delivery,
    cardId: cardId == null ? this.cardId : cardId(),
    cardChosen: cardChosen ?? this.cardChosen,
    submitting: submitting ?? this.submitting,
    error: error == null ? this.error : error(),
    placedOrderId: placedOrderId ?? this.placedOrderId,
  );
}

/// Contact and address fields, owned by the form widgets.
class CheckoutForm {
  const CheckoutForm({
    this.name = '',
    this.phone = '',
    this.notes = '',
    this.address = '',
    this.city = '',
    this.deliveryNotes = '',
  });

  final String name;
  final String phone;
  final String notes;
  final String address;
  final String city;
  final String deliveryNotes;
}

class CheckoutValidation implements Exception {
  const CheckoutValidation(this.reason);

  final CheckoutProblem reason;
}

enum CheckoutProblem { deliveryAddress, pickSlot, outsideDeliveryArea }

/// All of checkout's moving parts. Discounts are always the server's
/// numbers (validated against the cart), and the total is computed with the
/// same tax function the API settles orders with.
class CheckoutController extends AutoDisposeNotifier<CheckoutState> {
  TakeAwayApi get _api => ref.read(apiProvider);

  @override
  CheckoutState build() {
    // Start over only when the customer switches store. A refreshed copy of
    // the same store (the app re-reads stores on resume) must not wipe the
    // codes and slot they already chose.
    ref.watch(activeStoreProvider.select((s) => s?.id));
    final store = ref.read(activeStoreProvider);
    // Outside working hours only a scheduled pickup is accepted.
    final mode = store != null && !store.isOpen ? PickupMode.scheduled : PickupMode.asap;

    // Cards and the feature flag load independently; whichever lands last
    // decides the default, unless the customer already chose.
    void repick() {
      if (!state.cardChosen) state = state.copyWith(cardId: _defaultCardId);
    }

    ref
      ..listen(cardsProvider, (_, _) => repick())
      ..listen(featureFlagsProvider, (_, _) => repick())
      // Closing time can pass while the customer sits on this screen.
      ..listen(activeStoreProvider.select((s) => s?.isOpen ?? true), (_, open) {
        if (!open && state.mode == PickupMode.asap) {
          state = state.copyWith(mode: PickupMode.scheduled, error: () => null);
        }
      });
    return CheckoutState(mode: mode, cardId: _defaultCardId());
  }

  Store? get _store => ref.read(activeStoreProvider);
  Cart? get _cart => ref.read(activeCartProvider).valueOrNull;

  String? _defaultCardId() {
    final enabled = ref.read(featureFlagsProvider).valueOrNull?.agroprombankEnabled ?? false;
    if (!enabled) return null;
    final usable = (ref.read(cardsProvider).valueOrNull ?? const <BoundCard>[]).where((c) => !c.isInactive).toList();
    return (usable.where((c) => c.isDefault).firstOrNull ?? usable.firstOrNull)?.id;
  }

  void setFulfillment(FulfillmentType value) {
    state = state.copyWith(fulfillment: value, error: () => null);
    if (value == FulfillmentType.delivery) unawaited(_quoteDelivery());
  }

  void setMode(PickupMode value) => state = state.copyWith(mode: value, error: () => null);

  void selectSlot(PickupSlot slot) {
    if (!slot.available) return;
    state = state.copyWith(slot: () => slot.startsAt, mode: PickupMode.scheduled, error: () => null);
  }

  void selectCard(String? cardId) => state = state.copyWith(cardId: () => cardId, cardChosen: true);

  // ── Discounts ──────────────────────────────────────────────────────────

  Future<void> applyPromo(String raw) async {
    final code = raw.trim().toUpperCase();
    final store = _store;
    final cart = _cart;
    if (code.isEmpty || store == null || cart == null) return;
    state = state.copyWith(promo: AppliedCode(code: code, busy: true));
    try {
      final result = await _api.validatePromo({
        'code': code,
        'brandId': store.brandId,
        'subtotalCents': cart.subtotalCents,
      });
      state = state.copyWith(
        promo: AppliedCode(
          code: code,
          ok: result.valid,
          cents: result.valid ? result.discountCents : 0,
          message: result.reason,
        ),
        promoMultiplier: result.valid ? result.pointsMultiplier : 1,
      );
      // Points are capped by what is left to pay, which the promo changed.
      if (state.points.spent > 0) unawaited(applyPoints(state.points.spent));
    } on Object catch (error) {
      state = state.copyWith(
        promo: AppliedCode(code: code, message: ApiError.from(error).message),
      );
    }
  }

  void clearPromo() {
    state = state.copyWith(promo: AppliedCode.empty, promoMultiplier: 1);
    if (state.points.spent > 0) unawaited(applyPoints(state.points.spent));
  }

  Future<void> applyGiftCard(String raw) async {
    final code = raw.trim().toUpperCase();
    final cart = _cart;
    if (code.isEmpty || cart == null) return;
    state = state.copyWith(giftCard: AppliedCode(code: code, busy: true));
    try {
      final result = await _api.validateGiftCard({'code': code, 'cartId': cart.id});
      state = state.copyWith(
        giftCard: AppliedCode(code: code, ok: true, cents: result.applicableCents),
      );
    } on Object catch (error) {
      state = state.copyWith(
        giftCard: AppliedCode(code: code, message: ApiError.from(error).message),
      );
    }
  }

  void clearGiftCard() => state = state.copyWith(giftCard: AppliedCode.empty);

  /// Asks the server how many of [points] may be spent on what is left to
  /// pay; the server clamps to the balance and the order value.
  Future<void> applyPoints(int points) async {
    final cart = _cart;
    if (cart == null) return;
    final payable = (cart.subtotalCents - (state.promo.ok ? state.promo.cents : 0)).clamp(0, 1 << 31);
    state = state.copyWith(
      points: PointsState(spent: state.points.spent, cents: state.points.cents, busy: true),
    );
    try {
      final quote = await _api.redeemQuote({'points': points, 'payableCents': payable});
      state = state.copyWith(
        points: PointsState(
          spent: quote.points,
          cents: quote.discountCents,
          min: quote.minPoints,
          message: quote.points == 0 ? 'min:${quote.minPoints}' : null,
        ),
      );
    } on Object catch (error) {
      state = state.copyWith(points: PointsState(message: ApiError.from(error).message ?? 'error'));
    }
  }

  void clearPoints() => state = state.copyWith(points: const PointsState());

  // ── Delivery ───────────────────────────────────────────────────────────

  Future<LocationStatus?> locateForDelivery() async {
    state = state.copyWith(delivery: _delivery(locating: true));
    final result = await ref.read(locationServiceProvider).locate();
    if (!result.ok) {
      state = state.copyWith(delivery: _delivery(locating: false));
      return result.status;
    }
    state = state.copyWith(
      delivery: _delivery(lat: result.position!.latitude, lng: result.position!.longitude),
    );
    await _quoteDelivery();
    return null;
  }

  DeliveryState _delivery({double? lat, double? lng, bool? locating}) {
    final d = state.delivery;
    return DeliveryState(
      lat: lat ?? d.lat,
      lng: lng ?? d.lng,
      feeCents: d.feeCents,
      distanceM: d.distanceM,
      outside: d.outside,
      locating: locating ?? d.locating,
    );
  }

  Future<void> _quoteDelivery() async {
    final store = _store;
    if (store == null) return;
    final d = state.delivery;
    state = state.copyWith(delivery: _delivery(locating: true));
    try {
      final quote = await _api.deliveryQuote({'storeId': store.id, 'latitude': ?d.lat, 'longitude': ?d.lng});
      state = state.copyWith(
        delivery: DeliveryState(
          lat: d.lat,
          lng: d.lng,
          feeCents: quote.feeCents,
          distanceM: quote.distanceM,
          outside: !quote.deliverable && quote.reason == 'OUTSIDE_RADIUS',
        ),
      );
    } on Object {
      state = state.copyWith(delivery: _delivery(locating: false));
    }
  }

  // ── Totals ─────────────────────────────────────────────────────────────

  TaxBreakdown breakdown(Cart cart, Store store) {
    final s = state;
    return computeTax(
      subtotalCents: cart.subtotalCents,
      // Points lower the price like a promo does; a gift card is a payment.
      discountCents: (s.promo.ok ? s.promo.cents : 0) + s.points.cents,
      deliveryFeeCents: s.fulfillment == FulfillmentType.delivery ? s.delivery.feeCents : 0,
      giftCardCents: s.giftCard.ok ? s.giftCard.cents : 0,
      taxRateBps: store.taxRateBps,
      taxIncludedInPrice: store.taxIncludedInPrice,
    );
  }

  bool get payingByCard {
    final cardsOn = ref.read(featureFlagsProvider).valueOrNull?.agroprombankEnabled ?? false;
    return cardsOn && state.cardId != null;
  }

  // ── Place order ────────────────────────────────────────────────────────

  /// Creates the order (once) and charges the chosen card. Returns the
  /// order id when the customer can move on to the order screen.
  Future<String?> placeOrder(CheckoutForm form) async {
    final cart = _cart;
    final store = _store;
    if (cart == null || store == null || state.submitting) return null;

    final s = state;
    final delivery = s.fulfillment == FulfillmentType.delivery;
    if (s.mode == PickupMode.scheduled && s.slot == null) throw const CheckoutValidation(CheckoutProblem.pickSlot);
    if (delivery && (form.address.trim().isEmpty || form.city.trim().isEmpty)) {
      throw const CheckoutValidation(CheckoutProblem.deliveryAddress);
    }
    if (delivery && s.delivery.outside) throw const CheckoutValidation(CheckoutProblem.outsideDeliveryArea);

    state = s.copyWith(submitting: true, error: () => null);
    try {
      var orderId = s.placedOrderId;
      if (orderId == null) {
        final order = await _api.createOrder(
          CreateOrderRequest(
            cartId: cart.id,
            pickupMode: s.mode,
            pickupAt: s.mode == PickupMode.scheduled ? s.slot : null,
            fulfillmentType: s.fulfillment,
            customerName: _blankToNull(form.name),
            customerPhone: _blankToNull(form.phone),
            notes: _blankToNull(form.notes),
            couponCode: s.promo.ok ? s.promo.code : null,
            giftCardCode: s.giftCard.ok ? s.giftCard.code : null,
            pointsToSpend: s.points.spent > 0 ? s.points.spent : null,
            deliveryAddressLine: delivery ? form.address.trim() : null,
            deliveryCity: delivery ? form.city.trim() : null,
            deliveryLatitude: delivery ? s.delivery.lat : null,
            deliveryLongitude: delivery ? s.delivery.lng : null,
            deliveryNotes: delivery ? _blankToNull(form.deliveryNotes) : null,
          ),
        );
        orderId = order.id;
        state = state.copyWith(placedOrderId: orderId);
        unawaited(ref.read(contactPrefsProvider).remember(name: form.name, phone: form.phone));
      }

      if (payingByCard) {
        await _api.payWithCard({'orderId': orderId, 'cardId': state.cardId});
        ref.invalidate(cardsProvider);
      }
      state = state.copyWith(submitting: false);
      // The server emptied the cart and took the points when the order was
      // created; sync once the customer is moving on.
      unawaited(ref.read(cartProvider(store.id).notifier).reload());
      ref
        ..invalidate(ordersProvider)
        ..invalidate(loyaltyProvider);
      return orderId;
    } on Object catch (error) {
      state = state.copyWith(submitting: false, error: () => ApiError.from(error));
      return null;
    }
  }

  static String? _blankToNull(String value) => value.trim().isEmpty ? null : value.trim();
}

final checkoutProvider = NotifierProvider.autoDispose<CheckoutController, CheckoutState>(CheckoutController.new);
