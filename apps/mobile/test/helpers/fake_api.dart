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
  final cancelled = <String>[];
  Order? currentOrder;
  List<BoundCard> boundCards = const [];

  /// Bank verdict for the next card payment; null means it goes through.
  String? declineWith;

  /// False = switched on but outside working hours, as the API reports it.
  bool storeOpenNow = true;

  /// Latency of reading the cart; the reply is the cart as it was when asked.
  Duration cartDelay = Duration.zero;

  /// Replaces the two-category menu — see [categoryJson].
  List<Map<String, dynamic>>? menuCategories;

  static const storeJson = <String, dynamic>{
    'id': 'st_1',
    'brandId': 'br_1',
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

  static Order sampleOrder({String status = 'CREATED', Map<String, dynamic>? payment}) => Order.fromJson({
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
    'storeLatitude': 0,
    'storeLongitude': 0,
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
  Future<List<Store>> stores({double? lat, double? lng, int? radius}) async => [
    Store.fromJson({...storeJson, 'openNow': storeOpenNow}),
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
  Future<ProductDetail> product(String idOrSlug) async => idOrSlug == 'p_latte' ? latte() : croissant();

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
  Future<void> registerDevice(DeviceRegistration body) async {}
}
