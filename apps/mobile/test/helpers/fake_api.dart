import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:mocktail/mocktail.dart';
import 'package:takeaway_api/takeaway_api.dart';

/// In-memory stand-in for the REST API: a store, a small menu, a server-side
/// cart and orders — enough for the app's flows to run end to end in widget
/// tests. Records what the app sent so tests can assert on it.
class FakeApi extends Fake implements TakeAwayApi {
  FakeApi({this.flags = const FeatureFlags()});

  FeatureFlags flags;
  final added = <AddCartItemRequest>[];
  final created = <CreateOrderRequest>[];
  final paid = <Map<String, dynamic>>[];

  /// Every web payment the app started, with its body.
  final webPayments = <StartWebPaymentRequest>[];

  /// True = the order is already held, so starting a web payment returns no page.
  bool webPaymentSettled = false;
  final cancelled = <String>[];
  Order? currentOrder;
  List<BoundCard> boundCards = const [];
  SignInMethods methods = const SignInMethods(telegram: true, google: false, apple: false);
  final unlinked = <String>[];

  /// Every account deletion the app asked for, with its body.
  final deleteRequests = <DeleteAccountRequest?>[];

  /// Status the next account deletion fails with, e.g. 403 for staff; null
  /// means it goes through.
  int? deleteAccountStatus;

  /// Bank verdict for the next card payment; null means it goes through.
  String? declineWith;

  /// False = switched on but outside working hours, as the API reports it.
  bool storeOpenNow = true;

  /// Stores listed after the default one, as API JSON.
  List<Map<String, dynamic>> moreStores = [];

  /// Latency of reading the cart; the reply is the cart as it was when asked.
  Duration cartDelay = Duration.zero;

  /// Latency of each quantity change, in the order they are sent; the change
  /// lands on the server when its delay runs out, like a slow request would.
  final updateDelays = <Duration>[];

  /// Latency of removing a cart line.
  Duration removeDelay = Duration.zero;

  /// Replaces the two-category menu — see [categoryJson].
  List<Map<String, dynamic>>? menuCategories;

  /// Product details by id, in place of the latte and the croissant.
  final Map<String, ProductDetail> products = {};

  /// What the default store sells (`kinds`); null leaves it out, as an
  /// older API does.
  List<String>? storeKinds;

  /// Body of the next promo check; null = the code takes 2 MDL off.
  Map<String, dynamic>? promoAnswer;

  /// English message the gift-card check refuses with; null = it pays 5 MDL.
  String? giftCardRefusal;

  static const storeJson = <String, dynamic>{
    'id': 'st_1',
    'brandId': 'br_1',
    'brandName': 'NoName Coffee',
    'logoUrl': null,
    'slug': 'noname-center',
    'name': 'NoName — центр',
    'addressLine': 'ул. 25 Октября, 94',
    'city': 'Тирасполь',
    'country': 'MD',
    'latitude': 0,
    'longitude': 0,
    'status': 'OPEN',
    'fulfillmentTypes': ['TAKEAWAY'],
    'pickupPointType': 'COUNTER',
    'busyMeter': 20,
    'currentEtaSeconds': 420,
    'taxRateBps': 0,
    'taxIncludedInPrice': true,
    'currency': 'MDL',
    'heroImageUrl': null,
    'distanceMeters': null,
  };

  static Map<String, dynamic> productJson(String id, String name, int price, {String category = 'cat_coffee'}) => {
    'id': id,
    'categoryId': category,
    'slug': id,
    'name': name,
    'description': 'Двойной эспрессо и молоко.',
    'basePriceCents': price,
    'prepTimeSeconds': 180,
    'caffeineLevel': 3,
    'calories': 180,
    'proteinsGrams': null,
    'fatsGrams': null,
    'carbsGrams': null,
    'allergens': <String>[],
    'dietTags': <String>[],
    'imageUrls': <String>[],
    'sortOrder': 0,
    'onStopList': false,
  };

  static Map<String, dynamic> categoryJson(
    String id,
    String name,
    List<Map<String, dynamic>> products, {
    int sortOrder = 0,
  }) => {
    'id': id,
    'slug': id,
    'name': name,
    'description': null,
    'iconUrl': null,
    'sortOrder': sortOrder,
    'availableFrom': null,
    'availableTo': null,
    'products': products,
  };

  final _cartItems = <CartItem>[];
  var _itemSeq = 0;

  Cart _cart() => Cart(
    id: 'cart_1',
    userId: 'u1',
    storeId: 'st_1',
    subtotalCents: _cartItems.fold(0, (s, i) => s + i.unitPriceCents * i.quantity),
    etaSeconds: _cartItems.isEmpty ? 0 : 480,
    items: List.of(_cartItems),
    updatedAt: DateTime.utc(2026, 9, 22),
  );

  static ProductDetail latte() => ProductDetail.fromJson({
    ...productJson('p_latte', 'Латте', 2000),
    'brandId': 'br_1',
    'variations': [
      {
        'id': 'v_s',
        'type': 'SIZE',
        'name': 'S',
        'priceDeltaCents': 0,
        'prepTimeDeltaSeconds': 0,
        'sortOrder': 0,
        'isDefault': true,
      },
      {
        'id': 'v_m',
        'type': 'SIZE',
        'name': 'M',
        'priceDeltaCents': 500,
        'prepTimeDeltaSeconds': 20,
        'sortOrder': 1,
        'isDefault': false,
      },
      {
        'id': 'v_oat',
        'type': 'MILK',
        'name': 'Овсяное',
        'priceDeltaCents': 800,
        'prepTimeDeltaSeconds': 0,
        'sortOrder': 1,
        'isDefault': false,
      },
      {
        'id': 'v_cow',
        'type': 'MILK',
        'name': 'Коровье',
        'priceDeltaCents': 0,
        'prepTimeDeltaSeconds': 0,
        'sortOrder': 0,
        'isDefault': true,
      },
    ],
    'modifiers': [
      {
        'id': 'm_shot',
        'slug': 'shot',
        'name': 'Доп. шот',
        'priceDeltaCents': 600,
        'prepTimeDeltaSeconds': 25,
        'minCount': 0,
        'maxCount': 3,
        'sortOrder': 0,
      },
    ],
  });

  static ProductDetail croissant() => ProductDetail.fromJson({
    ...productJson('p_croissant', 'Круассан', 1500, category: 'cat_food'),
    'brandId': 'br_1',
    'variations': <Object>[],
    'modifiers': <Object>[],
  });

  void seedCart(ProductDetail product, {int quantity = 1}) {
    _cartItems.add(
      CartItem(
        id: 'ci_${++_itemSeq}',
        productId: product.id,
        productName: product.name,
        quantity: quantity,
        variationIds: const [],
        modifiers: const {},
        unitPriceCents: product.basePriceCents,
        unitPrepSeconds: product.prepTimeSeconds,
      ),
    );
  }

  static Order sampleOrder({
    String status = 'CREATED',
    Map<String, dynamic>? payment,
    double storeLatitude = 0,
    double storeLongitude = 0,
  }) => Order.fromJson({
    'id': 'ord_1',
    'orderCode': '4821',
    'qrToken': 'qr_1',
    'status': status,
    'pickupMode': 'ASAP',
    'fulfillmentType': 'PICKUP',
    'pickupAt': DateTime.now().toUtc().add(const Duration(minutes: 8)).toIso8601String(),
    'subtotalCents': 2000,
    'discountCents': 0,
    'taxCents': 0,
    'totalCents': 2000,
    'currency': 'MDL',
    'storeId': 'st_1',
    'storeName': 'NoName — центр',
    'storeLatitude': storeLatitude,
    'storeLongitude': storeLongitude,
    'storeAddress': 'ул. 25 Октября, 94',
    'items': [
      {
        'id': 'it_1',
        'productSnapshot': {
          'id': 'p_croissant',
          'name': 'Круассан',
          'variationIds': <String>[],
          'modifiers': <String, int>{},
        },
        'quantity': 1,
        'unitPriceCents': 2000,
        'totalCents': 2000,
      },
    ],
    'createdAt': DateTime.now().toUtc().toIso8601String(),
    'payment': ?payment,
  });

  // ── Catalog ────────────────────────────────────────────────────────────

  @override
  Future<FeatureFlags> features() async => flags;

  @override
  Future<TelegramAuthConfig> telegramConfig() async => const TelegramAuthConfig();

  @override
  Future<SignInMethods> signInMethods() async => methods;

  @override
  Future<SignInMethods> unlinkSignInMethod(String provider) async {
    unlinked.add(provider);
    return methods = SignInMethods(
      telegram: methods.telegram,
      google: methods.google && provider != 'google',
      apple: methods.apple && provider != 'apple',
    );
  }

  @override
  Future<void> deleteMe([DeleteAccountRequest? body]) async {
    deleteRequests.add(body);
    final status = deleteAccountStatus;
    if (status != null) {
      final request = RequestOptions(path: '/auth/me', method: 'DELETE');
      throw DioException(
        requestOptions: request,
        response: Response<Object?>(requestOptions: request, statusCode: status, data: {'statusCode': status}),
        type: DioExceptionType.badResponse,
      );
    }
  }

  @override
  Future<List<Store>> stores({double? lat, double? lng, int? radius}) async => [
    Store.fromJson({...storeJson, 'openNow': storeOpenNow, 'kinds': ?storeKinds}),
    for (final json in moreStores) Store.fromJson(json),
  ];

  @override
  Future<StoreDetail> store(String idOrSlug) async => StoreDetail.fromJson({
    ...storeJson,
    'openNow': storeOpenNow,
    'timezone': 'Europe/Chisinau',
    'phone': null,
    'email': null,
    'minOrderCents': 0,
    'galleryUrls': <String>[],
    'workingHours': <Object>[],
    'brand': {'id': 'br_1', 'slug': 'noname', 'name': 'NoName Coffee', 'logoUrl': null, 'themeOverrides': null},
  });

  @override
  Future<Menu> menu(String idOrSlug) async => Menu.fromJson({
    'storeId': 'st_1',
    'storeSlug': 'noname-center',
    'categories':
        menuCategories ??
        [
          {
            'id': 'cat_coffee',
            'slug': 'coffee',
            'name': 'Кофе',
            'description': null,
            'iconUrl': null,
            'sortOrder': 0,
            'availableFrom': null,
            'availableTo': null,
            'products': [productJson('p_latte', 'Латте', 2000)],
          },
          {
            'id': 'cat_food',
            'slug': 'food',
            'name': 'Выпечка',
            'description': null,
            'iconUrl': null,
            'sortOrder': 1,
            'availableFrom': null,
            'availableTo': null,
            'products': [productJson('p_croissant', 'Круассан', 1500, category: 'cat_food')],
          },
        ],
  });

  @override
  Future<ProductDetail> product(String idOrSlug, {String? store}) async {
    productStores.add(store);
    final detail = products[idOrSlug] ?? (idOrSlug == 'p_latte' ? latte() : croissant());
    final soldOut = {...this.soldOut, ...?soldOutAt[store]};
    if (soldOut.isEmpty) return detail;
    // What the API does for an add-in marked out of stock: the option is
    // left out, the product stays.
    final json = jsonDecode(jsonEncode(detail)) as Map<String, dynamic>;
    for (final key in ['variations', 'modifiers']) {
      json[key] = [
        for (final option in json[key] as List<dynamic>)
          if (!soldOut.contains((option as Map<String, dynamic>)['id'])) option,
      ];
    }
    return ProductDetail.fromJson(json);
  }

  /// Ids of options whose add-in has run out since the test started.
  final Set<String> soldOut = {};

  /// Ids of options one store has run out of: left out only when the product
  /// is fetched for that store.
  final Map<String, Set<String>> soldOutAt = {};

  /// The `store` each product lookup was made for.
  final List<String?> productStores = [];

  /// Fixed per instance so a test can compare what it tapped with what was sent.
  late final DateTime _slotsStart = () {
    final soon = DateTime.now().toUtc().add(const Duration(minutes: 30));
    return DateTime.utc(soon.year, soon.month, soon.day, soon.hour, soon.minute - soon.minute % 15);
  }();

  @override
  Future<List<PickupSlot>> pickupSlots(String idOrSlug) async {
    final start = _slotsStart;
    return [
      for (var i = 0; i < 6; i++)
        PickupSlot(
          startsAt: start.add(Duration(minutes: 15 * i)),
          endsAt: start.add(Duration(minutes: 15 * (i + 1))),
          taken: i == 1 ? 8 : 0,
          capacity: 8,
          available: i != 1,
        ),
    ];
  }

  // ── Cart ───────────────────────────────────────────────────────────────

  @override
  Future<Cart> cart(String storeId) async {
    final snapshot = _cart();
    if (cartDelay > Duration.zero) await Future<void>.delayed(cartDelay);
    return snapshot;
  }

  @override
  Future<Cart> addCartItem(AddCartItemRequest body) async {
    added.add(body);
    final product = await this.product(body.productId);
    var price = product.basePriceCents;
    for (final v in product.variations) {
      if (body.variationIds?.contains(v.id) ?? false) price += v.priceDeltaCents;
    }
    for (final m in product.modifiers) {
      price += (body.modifiers?[m.id] ?? 0) * m.priceDeltaCents;
    }
    _cartItems.add(
      CartItem(
        id: 'ci_${++_itemSeq}',
        productId: product.id,
        productName: product.name,
        quantity: body.quantity,
        variationIds: body.variationIds ?? const [],
        modifiers: body.modifiers ?? const {},
        unitPriceCents: price,
        unitPrepSeconds: product.prepTimeSeconds,
        notes: body.notes,
      ),
    );
    return _cart();
  }

  @override
  Future<Cart> updateCartItem(String itemId, Map<String, dynamic> patch) async {
    if (updateDelays.isNotEmpty) await Future<void>.delayed(updateDelays.removeAt(0));
    final index = _cartItems.indexWhere((i) => i.id == itemId);
    final item = _cartItems[index];
    _cartItems[index] = CartItem(
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: patch['quantity'] as int? ?? item.quantity,
      variationIds: item.variationIds,
      modifiers: item.modifiers,
      unitPriceCents: item.unitPriceCents,
      unitPrepSeconds: item.unitPrepSeconds,
    );
    return _cart();
  }

  @override
  Future<Cart> removeCartItem(String itemId) async {
    if (removeDelay > Duration.zero) await Future<void>.delayed(removeDelay);
    _cartItems.removeWhere((i) => i.id == itemId);
    return _cart();
  }

  @override
  Future<Cart> clearCart(String storeId) async {
    _cartItems.clear();
    return _cart();
  }

  // ── Orders ─────────────────────────────────────────────────────────────

  @override
  Future<Order> createOrder(CreateOrderRequest body) async {
    created.add(body);
    _cartItems.clear();
    return currentOrder = sampleOrder();
  }

  @override
  Future<Order> order(String id) async => currentOrder ?? sampleOrder();

  @override
  Future<Order> cancelOrder(String id) async {
    cancelled.add(id);
    return currentOrder = sampleOrder(status: 'CANCELLED');
  }

  @override
  Future<CustomerLocationResult> reportLocation(String id, Map<String, dynamic> body) async =>
      const CustomerLocationResult(level: 'HERE', distanceM: 0, recorded: true);

  @override
  Future<List<OrderSummary>> myOrders({String group = 'ALL', int take = 30}) async => const [];

  @override
  Future<LoyaltyAccount> loyalty() async => const LoyaltyAccount(
    userId: 'u1',
    pointsBalance: 0,
    lifetimePoints: 0,
    tier: LoyaltyTier.silver,
    pointsToNextTier: 500,
    tierProgressPercent: 0,
    recent: [],
    nextTier: LoyaltyTier.gold,
  );

  @override
  Future<List<BoundCard>> cards() async => boundCards;

  @override
  Future<ChargeResult> payWithCard(Map<String, dynamic> body) async {
    paid.add(body);
    final reason = declineWith;
    if (reason != null) {
      declineWith = null;
      throw DioException(
        requestOptions: RequestOptions(path: '/payments/agroprombank/pay'),
        response: Response<Object?>(
          requestOptions: RequestOptions(path: '/payments/agroprombank/pay'),
          statusCode: 400,
          data: {'statusCode': 400, 'message': reason},
        ),
        type: DioExceptionType.badResponse,
      );
    }
    return const ChargeResult(paymentId: 'pay_1', status: 'REQUIRES_ACTION', amountCents: 2000);
  }

  static const webPaymentUrl = 'https://bank.example/pay?nivid=inv_1&sign=abc';

  @override
  Future<StartWebPaymentResult> startWebPayment(StartWebPaymentRequest body) async {
    webPayments.add(body);
    return StartWebPaymentResult(
      paymentId: 'pay_web_1',
      invoiceId: 'inv_1',
      status: webPaymentSettled ? 'SUCCEEDED' : 'REQUIRES_ACTION',
      page: webPaymentSettled
          ? null
          : const WebPaymentPage(
              method: 'POST',
              action: 'https://bank.example/pay',
              fields: {'nivid': 'inv_1', 'sign': 'abc'},
              url: webPaymentUrl,
            ),
    );
  }

  static BoundCard card({String id = 'card_1', bool isDefault = true}) => BoundCard.fromJson({
    'id': id,
    'maskedPan': '9104 **** **** 1234',
    'embossing': null,
    'institute': '0001',
    'instituteName': 'ЗАО «Агропромбанк»',
    'label': null,
    'isDefault': isDefault,
    'cardState': 1,
    'createdAt': '2026-09-01T10:00:00.000Z',
    'lastUsedAt': null,
  });

  @override
  Future<PromoValidation> validatePromo(Map<String, dynamic> body) async => PromoValidation.fromJson(
    promoAnswer ?? {'valid': true, 'reason': null, 'reasonCode': null, 'discountCents': 200, 'pointsMultiplier': 1},
  );

  @override
  Future<GiftCardValidation> validateGiftCard(Map<String, dynamic> body) async {
    final refusal = giftCardRefusal;
    if (refusal != null) {
      final request = RequestOptions(path: '/gift-cards/validate', method: 'POST');
      throw DioException(
        requestOptions: request,
        response: Response<Object?>(
          requestOptions: request,
          statusCode: 400,
          data: {'statusCode': 400, 'error': 'Bad Request', 'message': refusal},
        ),
        type: DioExceptionType.badResponse,
      );
    }
    return const GiftCardValidation(applicableCents: 500, remainingCents: 0, currency: 'MDL');
  }

  @override
  Future<void> registerDevice(DeviceRegistration body) async {}

  /// Every feedback the app sent.
  final feedback = <CreateFeedbackRequest>[];

  /// Status the next feedback fails with, e.g. 429; null means it goes through.
  int? feedbackStatus;

  @override
  Future<FeedbackReceipt> sendFeedback(CreateFeedbackRequest body) async {
    feedback.add(body);
    final status = feedbackStatus;
    if (status != null) {
      final request = RequestOptions(path: '/feedback', method: 'POST');
      throw DioException(
        requestOptions: request,
        response: Response<Object?>(
          requestOptions: request,
          statusCode: status,
          data: {'statusCode': status, 'code': 'FEEDBACK_TOO_MANY', 'message': 'Too many messages in an hour'},
        ),
        type: DioExceptionType.badResponse,
      );
    }
    return FeedbackReceipt(id: 'fb_${feedback.length}', createdAt: DateTime.utc(2026, 10, 7, 10));
  }

  // ── Inbox ──────────────────────────────────────────────────────────────

  /// «Уведомления» on the server, newest first, as API JSON — see
  /// [inboxItemJson].
  List<Map<String, dynamic>> inboxItems = [];

  /// Page size the fake answers with, whatever the app asks for.
  int? inboxPageSize;

  /// The cursor of every page the app asked for.
  final inboxCursors = <String?>[];

  /// True = every page after the first fails.
  bool inboxNextPagesFail = false;

  /// Every message the app marked read, and how many times it read them all.
  final inboxReads = <String>[];
  var inboxReadAlls = 0;

  /// Status the read calls fail with; null means they go through.
  int? inboxReadStatus;

  static Map<String, dynamic> inboxItemJson(
    String id, {
    String kind = 'BRAND_CAMPAIGN',
    String title = '−20% на капучино',
    String body = 'Только до воскресенья, в любом нашем заведении.',
    bool read = false,
    Map<String, dynamic>? link,
    DateTime? createdAt,
  }) => {
    'id': id,
    'kind': kind,
    'title': title,
    'body': body,
    'sender': kind == 'PLATFORM_ANNOUNCEMENT'
        ? {'kind': 'PLATFORM', 'name': 'takeAway', 'logoUrl': null, 'brandId': null}
        : {'kind': 'BRAND', 'name': 'NoName Coffee', 'logoUrl': null, 'brandId': 'br_1'},
    'link': link,
    'createdAt': (createdAt ?? DateTime.now().toUtc().subtract(const Duration(minutes: 5))).toIso8601String(),
    'readAt': read ? '2026-10-14T10:00:00.000Z' : null,
  };

  int get inboxUnread => inboxItems.where((item) => item['readAt'] == null).length;

  @override
  Future<InboxPage> inbox({String? cursor, int? limit}) async {
    inboxCursors.add(cursor);
    if (cursor != null && inboxNextPagesFail) throw _inboxError('/inbox', 503);
    final start = cursor == null ? 0 : inboxItems.indexWhere((item) => item['id'] == cursor) + 1;
    final page = inboxItems.skip(start).take(inboxPageSize ?? limit ?? 20).toList();
    return InboxPage(
      items: page.map(InboxItem.fromJson).toList(),
      nextCursor: start + page.length < inboxItems.length ? page.last['id'] as String : null,
      unreadCount: inboxUnread,
    );
  }

  @override
  Future<InboxUnreadCount> inboxUnreadCount() async => InboxUnreadCount(count: inboxUnread);

  @override
  Future<InboxItem> inboxItem(String id) async {
    final json = inboxItems.where((item) => item['id'] == id).firstOrNull;
    if (json == null) throw _inboxError('/inbox/$id', 404);
    return InboxItem.fromJson(json);
  }

  @override
  Future<void> markInboxItemRead(String id) async {
    inboxReads.add(id);
    final status = inboxReadStatus;
    if (status != null) throw _inboxError('/inbox/$id/read', status);
    inboxItems = [
      for (final item in inboxItems) item['id'] == id ? {...item, 'readAt': item['readAt'] ?? _readAt()} : item,
    ];
  }

  @override
  Future<void> markInboxRead() async {
    inboxReadAlls++;
    final status = inboxReadStatus;
    if (status != null) throw _inboxError('/inbox/read-all', status);
    inboxItems = [
      for (final item in inboxItems) {...item, 'readAt': item['readAt'] ?? _readAt()},
    ];
  }

  static String _readAt() => DateTime.now().toUtc().toIso8601String();

  static DioException _inboxError(String path, int status) {
    final request = RequestOptions(path: path);
    return DioException(
      requestOptions: request,
      response: Response<Object?>(requestOptions: request, statusCode: status, data: {'statusCode': status}),
      type: DioExceptionType.badResponse,
    );
  }
}
