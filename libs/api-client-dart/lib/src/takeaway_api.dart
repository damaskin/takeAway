import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import 'models/auth.dart';
import 'models/cart.dart';
import 'models/catalog.dart';
import 'models/loyalty.dart';
import 'models/misc.dart';
import 'models/order.dart';
import 'models/payments.dart';

part 'takeaway_api.g.dart';

/// Typed surface of the takeAway REST API (`apps/api`). Paths are relative
/// to the `/api` base URL.
@RestApi()
abstract class TakeAwayApi {
  factory TakeAwayApi(Dio dio, {String? baseUrl}) = _TakeAwayApi;

  // ── Config ─────────────────────────────────────────────────────────────

  @GET('/config/features')
  Future<FeatureFlags> features();

  @GET('/auth/telegram/config')
  Future<TelegramAuthConfig> telegramConfig();

  // ── Auth ───────────────────────────────────────────────────────────────

  @POST('/auth/telegram/widget')
  Future<AuthSessionResponse> signInWithTelegram(@Body() Map<String, dynamic> payload);

  @POST('/auth/google')
  Future<AuthSessionResponse> signInWithGoogle(@Body() OAuthLoginRequest body);

  @POST('/auth/apple')
  Future<AuthSessionResponse> signInWithApple(@Body() OAuthLoginRequest body);

  @POST('/auth/logout')
  Future<void> logout(@Body() RefreshRequest body);

  @GET('/auth/me')
  Future<AuthUser> me();

  @PATCH('/auth/me')
  Future<AuthUser> updateMe(@Body() Map<String, dynamic> patch);

  @GET('/auth/me/notifications')
  Future<NotificationPrefs> notificationPrefs();

  @PATCH('/auth/me/notifications')
  Future<NotificationPrefs> updateNotificationPrefs(@Body() Map<String, dynamic> patch);

  // ── Catalog ────────────────────────────────────────────────────────────

  @GET('/stores')
  Future<List<Store>> stores({@Query('lat') double? lat, @Query('lng') double? lng, @Query('radius') int? radius});

  @GET('/stores/{idOrSlug}')
  Future<StoreDetail> store(@Path('idOrSlug') String idOrSlug);

  @GET('/stores/{idOrSlug}/menu')
  Future<Menu> menu(@Path('idOrSlug') String idOrSlug);

  @GET('/stores/{idOrSlug}/pickup-slots')
  Future<List<PickupSlot>> pickupSlots(@Path('idOrSlug') String idOrSlug);

  @GET('/products/{idOrSlug}')
  Future<ProductDetail> product(@Path('idOrSlug') String idOrSlug);

  // ── Cart ───────────────────────────────────────────────────────────────

  @GET('/cart')
  Future<Cart> cart(@Query('storeId') String storeId);

  @POST('/cart/items')
  Future<Cart> addCartItem(@Body() AddCartItemRequest body);

  @PATCH('/cart/items/{itemId}')
  Future<Cart> updateCartItem(@Path('itemId') String itemId, @Body() Map<String, dynamic> patch);

  @DELETE('/cart/items/{itemId}')
  Future<Cart> removeCartItem(@Path('itemId') String itemId);

  @DELETE('/cart')
  Future<Cart> clearCart(@Query('storeId') String storeId);

  // ── Orders ─────────────────────────────────────────────────────────────

  @POST('/orders')
  Future<Order> createOrder(@Body() CreateOrderRequest body);

  @GET('/orders/{id}')
  Future<Order> order(@Path('id') String id);

  @POST('/orders/{id}/cancel')
  Future<Order> cancelOrder(@Path('id') String id);

  @POST('/orders/{id}/location')
  Future<CustomerLocationResult> reportLocation(@Path('id') String id, @Body() Map<String, dynamic> body);

  @GET('/me/orders')
  Future<List<OrderSummary>> myOrders({@Query('group') String group = 'ALL', @Query('take') int take = 30});

  @POST('/me/orders/{id}/resend-receipt')
  Future<void> resendReceipt(@Path('id') String id);

  // ── Loyalty, promo, gift cards, referrals ──────────────────────────────

  @GET('/loyalty/me')
  Future<LoyaltyAccount> loyalty();

  @POST('/loyalty/redeem/quote')
  Future<RedeemQuote> redeemQuote(@Body() Map<String, dynamic> body);

  @POST('/promo/validate')
  Future<PromoValidation> validatePromo(@Body() Map<String, dynamic> body);

  @POST('/gift-cards/validate')
  Future<GiftCardValidation> validateGiftCard(@Body() Map<String, dynamic> body);

  @GET('/me/gift-cards')
  Future<List<GiftCardRedemption>> myGiftCards();

  @GET('/me/referrals')
  Future<ReferralSummary> referrals();

  @POST('/me/referrals/apply')
  Future<ReferralSummary> applyReferral(@Body() Map<String, dynamic> body);

  // ── Delivery ───────────────────────────────────────────────────────────

  @POST('/delivery/quote')
  Future<DeliveryQuote> deliveryQuote(@Body() Map<String, dynamic> body);

  // ── Payments: Agroprombank ─────────────────────────────────────────────

  @GET('/payments/agroprombank/institutes')
  Future<List<CardInstitute>> cardInstitutes();

  @GET('/payments/agroprombank/cards')
  Future<List<BoundCard>> cards();

  @POST('/payments/agroprombank/cards/bind')
  Future<StartBindingResult> startCardBinding(@Body() BindCardRequest body);

  @POST('/payments/agroprombank/cards/bind/{bindingId}/confirm')
  Future<BoundCard> confirmCardBinding(@Path('bindingId') String bindingId, @Body() Map<String, dynamic> body);

  @POST('/payments/agroprombank/cards/{cardId}/default')
  Future<BoundCard> setDefaultCard(@Path('cardId') String cardId);

  @POST('/payments/agroprombank/cards/{cardId}/refresh')
  Future<BoundCard> refreshCard(@Path('cardId') String cardId);

  @DELETE('/payments/agroprombank/cards/{cardId}')
  Future<void> deleteCard(@Path('cardId') String cardId);

  @POST('/payments/agroprombank/pay')
  Future<ChargeResult> payWithCard(@Body() Map<String, dynamic> body);

  // ── Devices (push tokens) ──────────────────────────────────────────────

  @POST('/devices')
  Future<void> registerDevice(@Body() DeviceRegistration body);

  @DELETE('/devices')
  Future<void> unregisterDevice(@Body() DeviceRegistration body);
}
