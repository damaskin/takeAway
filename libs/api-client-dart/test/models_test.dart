import 'dart:convert';
import 'dart:io';

import 'package:takeaway_api/takeaway_api.dart';
import 'package:test/test.dart';

/// Fixtures under `test/fixtures` are real responses captured from the
/// public production API (stores, menu, slots, product, institutes); order,
/// cart and inbox payloads are built from the API DTOs, since those need a
/// login.
Object? fixture(String name) => jsonDecode(File('test/fixtures/$name').readAsStringSync());

void main() {
  group('catalog', () {
    test('parses the live store list, including a POS store without an address', () {
      final stores = (fixture('stores.json')! as List).map((e) => Store.fromJson(e as Map<String, dynamic>)).toList();

      expect(stores, isNotEmpty);
      final pos = stores.firstWhere((s) => s.slug == 'pos-poster-store-1');
      expect(pos.currency, 'MDL');
      expect(pos.status, StoreStatus.open);
      expect(pos.hasLocation, isFalse, reason: 'Poster imports land at 0,0');
      expect(pos.distanceMeters, isNull);
      expect(pos.fulfillmentTypes, contains('TAKEAWAY'));
    });

    test('reads a store without a running shift as not working, and one from an older API as working', () {
      final raw = (fixture('stores.json')! as List).first as Map<String, dynamic>;
      final idle = Store.fromJson({...raw, 'status': 'OPEN', 'acceptingOrders': false, 'openNow': false});
      expect(idle.isInactive, isTrue);
      expect(idle.isOpen, isFalse);

      final working = Store.fromJson({...raw, 'status': 'OPEN', 'acceptingOrders': true});
      expect(working.isInactive, isFalse);

      final older = Store.fromJson({...raw, 'status': 'OPEN'}..remove('acceptingOrders'));
      expect(older.acceptingOrders, isNull);
      expect(older.isInactive, isFalse);
    });

    test('takes pre-orders while closed for ASAP, and reads when it opens and closes', () {
      final raw = (fixture('stores.json')! as List).first as Map<String, dynamic>;
      final night = Store.fromJson({
        ...raw,
        'status': 'OPEN',
        'openNow': false,
        'acceptingOrders': true,
        'asapBlockedReason': 'OUTSIDE_HOURS',
        'opensAt': '2026-10-15T06:00:00.000Z',
        'closesAt': null,
      });
      expect(night.isOpen, isFalse);
      expect(night.isInactive, isFalse);
      expect(night.takesOrders, isTrue);
      expect(night.preorderOnly, isTrue);
      expect(night.asapBlockedReason, AsapBlockedReason.outsideHours);
      expect(night.opensAt, DateTime.utc(2026, 10, 15, 6));
      expect(night.closesAt, isNull);

      final open = Store.fromJson({
        ...raw,
        'status': 'OPEN',
        'openNow': true,
        'acceptingOrders': true,
        'asapBlockedReason': null,
        'closesAt': '2026-10-14T18:00:00.000Z',
      });
      expect(open.takesOrders, isTrue);
      expect(open.preorderOnly, isFalse);
      expect(open.closesAt, DateTime.utc(2026, 10, 14, 18));

      final idle = Store.fromJson({...raw, 'status': 'OPEN', 'openNow': false, 'acceptingOrders': false});
      expect(idle.takesOrders, isFalse);
      expect(idle.preorderOnly, isFalse);

      // A reason this build does not know still parses; the cache keeps it all.
      final future = Store.fromJson({...raw, 'openNow': false, 'acceptingOrders': true, 'asapBlockedReason': 'NEW'});
      expect(future.asapBlockedReason, AsapBlockedReason.unknown);
      final cached = Store.fromJson(jsonDecode(jsonEncode(night.toJson())) as Map<String, dynamic>);
      expect(cached.asapBlockedReason, AsapBlockedReason.outsideHours);
      expect(cached.opensAt, night.opensAt);
    });

    test('reads a kitchen pause and an imminent closing, and no pause from an older API', () {
      final raw = (fixture('stores.json')! as List).first as Map<String, dynamic>;
      final paused = Store.fromJson({
        ...raw,
        'status': 'OPEN',
        'openNow': false,
        'acceptingOrders': true,
        'asapBlockedReason': 'PAUSED',
        'pausedUntil': '2026-10-20T09:30:00.000Z',
        'pauseReason': 'EQUIPMENT',
        'closesAt': '2026-10-20T18:00:00.000Z',
      });
      expect(paused.asapBlockedReason, AsapBlockedReason.paused);
      expect(paused.pausedUntil, DateTime.utc(2026, 10, 20, 9, 30));
      expect(paused.pauseReason, StorePauseReason.equipment);
      expect(paused.preorderOnly, isTrue, reason: 'a pause stops orders for now, not pre-orders');

      final cached = Store.fromJson(jsonDecode(jsonEncode(paused.toJson())) as Map<String, dynamic>);
      expect(cached.asapBlockedReason, AsapBlockedReason.paused);
      expect(cached.pausedUntil, paused.pausedUntil);
      expect(cached.pauseReason, StorePauseReason.equipment);

      final closing = Store.fromJson({
        ...raw,
        'status': 'OPEN',
        'openNow': false,
        'acceptingOrders': true,
        'asapBlockedReason': 'CLOSING_SOON',
        'closesAt': '2026-10-20T18:00:00.000Z',
        'pausedUntil': null,
        'pauseReason': null,
      });
      expect(closing.asapBlockedReason, AsapBlockedReason.closingSoon);
      expect(closing.pausedUntil, isNull);
      expect(closing.pauseReason, isNull);
      expect(closing.preorderOnly, isTrue);

      final older = Store.fromJson({...raw}..removeWhere((key, _) => key == 'pausedUntil' || key == 'pauseReason'));
      expect(older.pausedUntil, isNull);
      expect(older.pauseReason, isNull);

      expect(AsapBlockedReason.parse('PAUSED'), AsapBlockedReason.paused);
      expect(AsapBlockedReason.parse('CLOSING_SOON'), AsapBlockedReason.closingSoon);
      expect(AsapBlockedReason.parse('LATER'), AsapBlockedReason.unknown);
      expect(AsapBlockedReason.parse(null), isNull);

      // A pause reason this build does not know still parses.
      final future = Store.fromJson({...raw, 'pauseReason': 'POWER_CUT', 'pausedUntil': '2026-10-20T09:30:00.000Z'});
      expect(future.pauseReason, StorePauseReason.unknown);
      expect(future.pausedUntil, isNotNull);

      final detail = StoreDetail.fromJson({
        ...(fixture('store_detail.json')! as Map<String, dynamic>),
        'asapBlockedReason': 'PAUSED',
        'pausedUntil': '2026-10-20T09:30:00.000Z',
        'pauseReason': 'NO_STAFF',
      });
      expect(detail.asapBlockedReason, AsapBlockedReason.paused);
      expect(detail.pausedUntil, DateTime.utc(2026, 10, 20, 9, 30));
      expect(detail.pauseReason, StorePauseReason.noStaff);
    });

    test('an API without acceptingOrders knows ASAP only: closed for ASAP takes no order', () {
      final raw = (fixture('stores.json')! as List).first as Map<String, dynamic>;
      final older = Store.fromJson({...raw, 'status': 'OPEN', 'openNow': false}..remove('acceptingOrders'));
      expect(older.takesOrders, isFalse);
      expect(older.preorderOnly, isFalse);
      expect(older.asapBlockedReason, isNull);
      expect(older.opensAt, isNull);

      final shiftEra = Store.fromJson({...raw, 'status': 'OPEN', 'openNow': true, 'acceptingOrders': true});
      expect(shiftEra.takesOrders, isTrue);
      expect(shiftEra.isOpen, isTrue);
    });

    test('reads what a store sells, keeping only the string entries, and null from an older API', () {
      final raw = (fixture('stores.json')! as List).first as Map<String, dynamic>;
      expect(
        Store.fromJson({
          ...raw,
          'kinds': ['COFFEE', 'FOOD'],
        }).kinds,
        ['COFFEE', 'FOOD'],
      );
      expect(
        Store.fromJson({
          ...raw,
          'kinds': ['FOOD', 7, null],
        }).kinds,
        ['FOOD'],
      );
      expect(Store.fromJson({...raw, 'kinds': 'FOOD'}).kinds, isNull);
      expect(Store.fromJson({...raw}..remove('kinds')).kinds, isNull);

      final cached = Store.fromJson({
        ...raw,
        'kinds': ['FOOD'],
      });
      expect(Store.fromJson(jsonDecode(jsonEncode(cached.toJson())) as Map<String, dynamic>).kinds, ['FOOD']);
    });

    test('parses store detail with brand and empty working hours', () {
      final store = StoreDetail.fromJson(fixture('store_detail.json')! as Map<String, dynamic>);
      expect(store.brand.name, 'NoName Coffee');
      expect(store.workingHours, isEmpty);
      expect(store.minOrderCents, 0);
    });

    test('parses the live menu', () {
      final menu = Menu.fromJson(fixture('menu.json')! as Map<String, dynamic>);
      expect(menu.categories, isNotEmpty);
      expect(menu.allProducts.every((p) => p.basePriceCents >= 0), isTrue);
      expect(menu.visibleCategories.every((c) => c.products.isNotEmpty), isTrue);
    });

    test('round-trips the menu through toJson for the offline cache', () {
      final menu = Menu.fromJson(fixture('menu.json')! as Map<String, dynamic>);
      final copy = Menu.fromJson(jsonDecode(jsonEncode(menu.toJson())) as Map<String, dynamic>);
      expect(copy.allProducts.map((p) => p.id), menu.allProducts.map((p) => p.id));
      expect(copy.allProducts.first.basePriceCents, menu.allProducts.first.basePriceCents);
    });

    test('parses a product with no options', () {
      final product = ProductDetail.fromJson(fixture('product_detail.json')! as Map<String, dynamic>);
      expect(product.variations, isEmpty);
      expect(product.modifiers, isEmpty);
      expect(product.brandId, isNotEmpty);
    });

    test('reads a product from an API that still sends caffeine, allergens and diet tags, and drops them', () {
      final product = ProductDetail.fromJson({
        ...fixture('product_detail.json')! as Map<String, dynamic>,
        'caffeineLevel': 2,
        'calories': 150,
        'allergens': ['MILK'],
        'dietTags': ['VEGAN'],
      });
      expect(product.calories, 150);
      final json = product.toJson();
      expect(json.keys, isNot(contains('caffeineLevel')));
      expect(json.keys, isNot(contains('allergens')));
      expect(json.keys, isNot(contains('dietTags')));
    });

    test('reads category kinds and add-on groups, and null from an API that predates them', () {
      final raw = fixture('menu.json')! as Map<String, dynamic>;
      final categories = (raw['categories'] as List).cast<Map<String, dynamic>>();
      final category = categories.first;
      final product = (category['products'] as List).first as Map<String, dynamic>;

      final older = Menu.fromJson(raw);
      expect(older.categories.first.kind, isNull);
      expect(older.allProducts.first.categoryKind, isNull);

      final menu = Menu.fromJson({
        ...raw,
        'categories': [
          {
            ...category,
            'kind': 'BAKERY',
            'products': [
              {...product, 'categoryKind': 'BAKERY'},
            ],
          },
          {...category, 'id': 'blank', 'kind': '  ', 'products': <Object>[]},
          {...category, 'id': 'odd', 'kind': 7, 'products': <Object>[]},
        ],
      });
      expect(menu.categories.map((c) => c.kind), ['BAKERY', null, null]);
      expect(menu.allProducts.single.categoryKind, 'BAKERY');
      final cached = Menu.fromJson(jsonDecode(jsonEncode(menu.toJson())) as Map<String, dynamic>);
      expect(cached.categories.first.kind, 'BAKERY');
      expect(cached.allProducts.single.categoryKind, 'BAKERY');

      final detail = ProductDetail.fromJson({
        ...fixture('product_detail.json')! as Map<String, dynamic>,
        'categoryKind': 'HOT_DRINKS',
        'modifiers': [
          for (final (id, group) in [('m1', 'Сиропы'), ('m2', null), ('m3', ''), ('m4', 3)])
            {'id': id, 'slug': id, 'name': id, 'priceDeltaCents': 500, 'minCount': 0, 'maxCount': 1, 'group': group},
          {'id': 'm5', 'slug': 'm5', 'name': 'm5', 'priceDeltaCents': 0},
        ],
      });
      expect(detail.categoryKind, 'HOT_DRINKS');
      expect(detail.modifiers.map((m) => m.group), ['Сиропы', null, null, null, null]);
    });

    test('parses pickup slots as UTC instants', () {
      final slots = (fixture('pickup_slots.json')! as List)
          .map((e) => PickupSlot.fromJson(e as Map<String, dynamic>))
          .toList();
      expect(slots, hasLength(greaterThan(10)));
      expect(slots.first.startsAt.isUtc, isTrue);
      expect(slots.first.endsAt.difference(slots.first.startsAt), const Duration(minutes: 15));
    });

    test('reads store suggestions and whether they are bought together', () {
      final together = StoreSuggestions.fromJson({
        'productIds': ['p_croissant', 'p_cheesecake'],
        'source': 'copurchase',
      });
      expect(together.productIds, ['p_croissant', 'p_cheesecake']);
      expect(together.boughtTogether, isTrue);
      expect(StoreSuggestions.fromJson({'productIds': <String>[], 'source': 'rule'}).boughtTogether, isFalse);
      // An odd, empty answer reads as the rule with nothing to offer.
      final empty = StoreSuggestions.fromJson({});
      expect(empty.productIds, isEmpty);
      expect(empty.boughtTogether, isFalse);
    });

    test('maps unknown enum values instead of failing', () {
      final store = Store.fromJson({
        ...((fixture('stores.json')! as List).first as Map<String, dynamic>),
        'status': 'SOMETHING_NEW',
      });
      expect(store.status, StoreStatus.unknown);
    });
  });

  group('orders', () {
    Map<String, dynamic> orderJson({Object? payment}) => {
      'id': 'ord_1',
      'orderCode': '4821',
      'qrToken': 'qr_abc',
      'status': 'IN_PROGRESS',
      'pickupMode': 'ASAP',
      'fulfillmentType': 'PICKUP',
      'pickupAt': '2026-09-22T19:40:00.000Z',
      'subtotalCents': 4500,
      'discountCents': 450,
      'taxCents': 0,
      'totalCents': 4050,
      'currency': 'MDL',
      'storeId': 'st_1',
      'storeName': 'NoName',
      'storeLatitude': 46.84,
      'storeLongitude': 29.64,
      'storeAddress': null,
      'customerName': 'Ivan',
      'customerPhone': null,
      'notes': null,
      'couponCode': 'WELCOME10',
      'giftCardCode': null,
      'giftCardCents': 0,
      'items': [
        {
          'id': 'it_1',
          'productSnapshot': {
            'id': 'p_1',
            'slug': 'latte',
            'name': 'Латте',
            'variationIds': ['v_m', 'v_oat'],
            'modifiers': {'m_shot': 2, 'm_zero': 0},
            'notes': 'погорячее',
            'unitPrepSeconds': 200,
          },
          'quantity': 2,
          'unitPriceCents': 2250,
          'totalCents': 4500,
        },
      ],
      'createdAt': '2026-09-22T19:30:00.000Z',
      'acceptedAt': '2026-09-22T19:31:00.000Z',
      'startedAt': null,
      'readyAt': null,
      'pickedUpAt': null,
      'cancelledAt': null,
      'expiredAt': null,
      'deliveryAddressLine': null,
      'deliveryCity': null,
      'deliveryLatitude': null,
      'deliveryLongitude': null,
      'deliveryNotes': null,
      'deliveryFeeCents': 0,
      'deliveryDistanceM': null,
      'riderId': null,
      'outForDeliveryAt': null,
      'deliveredAt': null,
      'payment': ?payment,
    };

    test('parses an order and reads the item snapshot', () {
      final order = Order.fromJson(
        orderJson(payment: {'state': 'HELD', 'amountCents': 4050, 'cardMask': '9104 **** 1234', 'paidAt': null}),
      );
      expect(order.status, OrderStatus.inProgress);
      expect(order.payment.state, PaymentState.held);
      expect(order.payment.cardMask, '9104 **** 1234');
      final item = order.items.single;
      expect(item.name, 'Латте');
      expect(item.productId, 'p_1');
      expect(item.variationIds, ['v_m', 'v_oat']);
      expect(item.modifiers, {'m_shot': 2}, reason: 'zero counts are not selections');
      expect(item.notes, 'погорячее');
      expect(order.itemCount, 2);
    });

    test('treats a missing payment block as paying at the counter', () {
      final order = Order.fromJson(orderJson());
      expect(order.payment.state, PaymentState.none);
    });

    test('knows which statuses end the order and which can be cancelled', () {
      expect(OrderStatus.pickedUp.isTerminal, isTrue);
      expect(OrderStatus.expired.isTerminal, isTrue);
      expect(OrderStatus.ready.isTerminal, isFalse);
      expect(OrderStatus.created.isCancellable, isTrue);
      expect(OrderStatus.paid.isCancellable, isTrue);
      expect(OrderStatus.accepted.isCancellable, isFalse, reason: 'cancel only before the kitchen accepts');
      expect(OrderStatus.inProgress.isCancellable, isFalse);
    });

    test('reads the new estimate of the kitchen and counts down to it, else to the promise', () {
      final late = Order.fromJson({...orderJson(), 'readyEstimateAt': '2026-09-22T19:48:00.000Z'});
      expect(late.readyEstimateAt, DateTime.utc(2026, 9, 22, 19, 48));
      expect(late.pickupAt, DateTime.utc(2026, 9, 22, 19, 40), reason: 'the promise stays as it was');
      expect(late.dueAt, late.readyEstimateAt);

      final onTime = Order.fromJson({...orderJson(), 'readyEstimateAt': null});
      expect(onTime.readyEstimateAt, isNull);
      expect(onTime.dueAt, onTime.pickupAt);

      final older = Order.fromJson(orderJson());
      expect(older.readyEstimateAt, isNull);
      expect(older.dueAt, older.pickupAt);
      expect(late.copyWithStatus(OrderStatus.ready).readyEstimateAt, late.readyEstimateAt);
    });

    test('takes the word of the API on cancelling, and before the accept only from an older API', () {
      final charged = Order.fromJson({...orderJson(), 'status': 'PAID', 'canCancel': false});
      expect(charged.canCancel, isFalse);
      expect(charged.customerCanCancel, isFalse, reason: 'money was taken: the API said no');

      final fresh = Order.fromJson({...orderJson(), 'status': 'CREATED', 'canCancel': true});
      expect(fresh.customerCanCancel, isTrue);
      // A live event that the kitchen accepted it takes the cancel away before the re-read lands.
      expect(fresh.copyWithStatus(OrderStatus.accepted).customerCanCancel, isFalse);
      expect(fresh.copyWithStatus(OrderStatus.paid).customerCanCancel, isTrue);

      final older = Order.fromJson({...orderJson(), 'status': 'CREATED'});
      expect(older.canCancel, isNull);
      expect(older.customerCanCancel, isTrue);
      expect(Order.fromJson({...orderJson(), 'status': 'ACCEPTED'}).customerCanCancel, isFalse);
      expect(Order.fromJson(orderJson()).customerCanCancel, isFalse, reason: 'IN_PROGRESS');
    });

    test('reads who cancelled the order, why and what the kitchen added', () {
      final rejected = Order.fromJson({
        ...orderJson(),
        'status': 'CANCELLED',
        'cancelledBy': 'STORE',
        'cancelReason': 'OUT_OF_STOCK',
        'cancelComment': 'Нет овсяного молока',
      });
      expect(rejected.cancelledBy, OrderCanceller.store);
      expect(rejected.cancelReason, OrderCancelReason.outOfStock);
      expect(rejected.cancelComment, 'Нет овсяного молока');
      expect(rejected.copyWithStatus(OrderStatus.cancelled).cancelComment, 'Нет овсяного молока');

      final declined = Order.fromJson({
        ...orderJson(),
        'status': 'CANCELLED',
        'cancelledBy': 'STORE',
        'cancelReason': 'CARD_DECLINED',
      });
      expect(declined.cancelReason, OrderCancelReason.cardDeclined);
      expect(declined.cancelComment, isNull);

      final own = Order.fromJson({
        ...orderJson(),
        'status': 'CANCELLED',
        'cancelledBy': 'CUSTOMER',
        'cancelReason': null,
      });
      expect(own.cancelledBy, OrderCanceller.customer);
      expect(own.cancelReason, isNull);

      final older = Order.fromJson(orderJson());
      expect(older.cancelledBy, isNull);
      expect(older.cancelReason, isNull);

      // A party or a reason from a newer API does not break the order.
      final newer = Order.fromJson({...orderJson(), 'cancelledBy': 'SYSTEM', 'cancelReason': 'WEATHER'});
      expect(newer.cancelledBy, isNull);
      expect(newer.cancelReason, OrderCancelReason.unknown);
    });

    test('reads who cancelled an order in the history list', () {
      final summary = OrderSummary.fromJson({
        'id': 'ord_1',
        'orderCode': '4821',
        'status': 'CANCELLED',
        'pickupMode': 'ASAP',
        'pickupAt': '2026-09-22T19:40:00.000Z',
        'totalCents': 4050,
        'currency': 'MDL',
        'storeId': 'st_1',
        'storeName': 'NoName',
        'itemCount': 2,
        'createdAt': '2026-09-22T19:30:00.000Z',
        'cancelledBy': 'STORE',
        'cancelReason': 'CLOSING',
      });
      expect(summary.cancelledBy, OrderCanceller.store);
      expect(summary.cancelReason, OrderCancelReason.closing);
      expect(summary.withStatus(OrderStatus.cancelled).cancelReason, OrderCancelReason.closing);
    });

    test('reads whether the order can be reviewed and the review left on it', () {
      final open = Order.fromJson({...orderJson(), 'status': 'PICKED_UP', 'canReview': true, 'review': null});
      expect(open.canReview, isTrue);
      expect(open.customerCanReview, isTrue);
      expect(open.review, isNull);

      final reviewed = Order.fromJson({
        ...orderJson(),
        'status': 'DELIVERED',
        'canReview': false,
        'review': {'rating': 4, 'comment': 'Горячий и вовремя', 'createdAt': '2026-11-06T10:15:00.000Z'},
      });
      expect(reviewed.customerCanReview, isFalse);
      expect(reviewed.review?.rating, 4);
      expect(reviewed.review?.comment, 'Горячий и вовремя');
      expect(reviewed.review?.createdAt, DateTime.utc(2026, 11, 6, 10, 15));
      expect(reviewed.copyWithStatus(OrderStatus.delivered).review?.rating, 4);

      final bare = Order.fromJson({
        ...orderJson(),
        'status': 'PICKED_UP',
        'canReview': false,
        'review': {'rating': 5, 'comment': null, 'createdAt': '2026-11-06T10:15:00.000Z'},
      });
      expect(bare.review?.comment, isNull);

      // An API from before reviews says nothing: no review is asked for.
      final older = Order.fromJson({...orderJson(), 'status': 'PICKED_UP'});
      expect(older.canReview, isNull);
      expect(older.customerCanReview, isFalse);
      expect(older.review, isNull);
    });

    test('a live status that leaves the handover takes the review away until the re-read', () {
      final open = Order.fromJson({...orderJson(), 'status': 'PICKED_UP', 'canReview': true});
      expect(open.copyWithStatus(OrderStatus.pickedUp).customerCanReview, isTrue);
      expect(open.copyWithStatus(OrderStatus.cancelled).customerCanReview, isFalse);
      expect(OrderStatus.pickedUp.isHandedOver, isTrue);
      expect(OrderStatus.delivered.isHandedOver, isTrue);
      expect(OrderStatus.ready.isHandedOver, isFalse);
      expect(OrderStatus.cancelled.isHandedOver, isFalse);
    });

    test('reads the review state of an order in the history list', () {
      Map<String, dynamic> summaryJson() => {
        'id': 'ord_1',
        'orderCode': '4821',
        'status': 'PICKED_UP',
        'pickupMode': 'ASAP',
        'pickupAt': '2026-09-22T19:40:00.000Z',
        'totalCents': 4050,
        'currency': 'MDL',
        'storeId': 'st_1',
        'storeName': 'NoName',
        'itemCount': 2,
        'createdAt': '2026-09-22T19:30:00.000Z',
      };
      final open = OrderSummary.fromJson({...summaryJson(), 'canReview': true, 'reviewRating': null});
      expect(open.canReview, isTrue);
      expect(open.reviewRating, isNull);
      expect(open.withStatus(OrderStatus.pickedUp).canReview, isTrue);

      final reviewed = OrderSummary.fromJson({...summaryJson(), 'canReview': false, 'reviewRating': 5});
      expect(reviewed.canReview, isFalse);
      expect(reviewed.reviewRating, 5);
      expect(reviewed.withStatus(OrderStatus.pickedUp).reviewRating, 5);

      final older = OrderSummary.fromJson(summaryJson());
      expect(older.canReview, isFalse);
      expect(older.reviewRating, isNull);
    });

    test('serialises a review, leaving a blank comment out and trimming the rest', () {
      expect(const CreateOrderReviewRequest(rating: 4, comment: '  Горячий и вовремя \n').toJson(), {
        'rating': 4,
        'comment': 'Горячий и вовремя',
      });
      expect(const CreateOrderReviewRequest(rating: 5, comment: '   ').toJson(), {'rating': 5});
      expect(const CreateOrderReviewRequest(rating: 1).toJson(), {'rating': 1});
    });

    test('parses socket status events, tolerating unknown statuses', () {
      final event = OrderStatusEvent.fromJson({
        'orderId': 'ord_1',
        'status': 'READY',
        'etaSeconds': 0,
        'occurredAt': 'x',
      });
      expect(event.status, OrderStatus.ready);
      expect(OrderStatusEvent.fromJson({'orderId': 'o', 'status': 'LATER'}).status, OrderStatus.unknown);
    });

    test('serialises a create request with UTC pickup time and without nulls', () {
      final json = CreateOrderRequest(
        cartId: 'cart_1',
        pickupMode: PickupMode.scheduled,
        pickupAt: DateTime.utc(2026, 9, 22, 20, 15),
        fulfillmentType: FulfillmentType.pickup,
        couponCode: 'WELCOME10',
      ).toJson();
      expect(json, {
        'cartId': 'cart_1',
        'pickupMode': 'SCHEDULED',
        'pickupAt': '2026-09-22T20:15:00.000Z',
        'fulfillmentType': 'PICKUP',
        'couponCode': 'WELCOME10',
      });
    });
  });

  group('cart', () {
    test('parses modifier counts leniently', () {
      final cart = Cart.fromJson({
        'id': 'c1',
        'userId': 'u1',
        'storeId': 's1',
        'subtotalCents': 5000,
        'etaSeconds': 420,
        'updatedAt': '2026-09-22T19:30:00.000Z',
        'items': [
          {
            'id': 'i1',
            'productId': 'p1',
            'productName': 'Латте',
            'quantity': 2,
            'variationIds': <String>[],
            'modifiers': {'m1': 1, 'm2': 2.0, 'bad': 'x'},
            'unitPriceCents': 2500,
            'unitPrepSeconds': 180,
            'notes': null,
          },
        ],
      });
      expect(cart.itemCount, 2);
      expect(cart.items.single.modifiers, {'m1': 1, 'm2': 2});
      expect(cart.items.single.lineTotalCents, 5000);
    });

    test('drops empty optional fields from add-to-cart requests', () {
      expect(const AddCartItemRequest(storeId: 's', productId: 'p', quantity: 1).toJson(), {
        'storeId': 's',
        'productId': 'p',
        'quantity': 1,
      });
    });
  });

  group('auth', () {
    test('sends the Apple authorization code with an account deletion only when there is one', () {
      expect(const DeleteAccountRequest(appleAuthorizationCode: 'c1').toJson(), {'appleAuthorizationCode': 'c1'});
      expect(const DeleteAccountRequest().toJson(), isEmpty);
    });

    test('reads which sign-in methods the server offers, none from an API that predates the route', () {
      final methods = AuthMethods.fromJson({'email': true, 'google': true, 'apple': false, 'telegram': true});
      expect([methods.email, methods.google, methods.apple, methods.telegram], [true, true, false, true]);
      expect(AuthMethods.fromJson(const {}).email, isFalse);
    });

    test('counts a proven email as a way into the profile', () {
      final withEmail = SignInMethods.fromJson({
        'telegram': false,
        'google': true,
        'apple': false,
        'email': 'ivan@mail.ru',
      });
      expect(withEmail.email, 'ivan@mail.ru');
      expect(withEmail.count, 2);
      // An API from before email sign-in leaves the field out.
      expect(SignInMethods.fromJson({'telegram': true, 'google': false, 'apple': false}).count, 1);
    });

    test('sends the address and the code as they are', () {
      expect(const EmailSignInStartRequest(email: 'ivan@mail.ru', locale: 'ru').toJson(), {
        'email': 'ivan@mail.ru',
        'locale': 'ru',
      });
      expect(const EmailSignInVerifyRequest(email: 'ivan@mail.ru', code: '042917').toJson(), {
        'email': 'ivan@mail.ru',
        'code': '042917',
      });
    });
  });

  group('devices', () {
    test('sends the raw APNs token of an iPhone next to the FCM token', () {
      expect(
        const DeviceRegistration(
          type: 'IOS',
          pushToken: 'fcm-1',
          apnsToken: 'ab12',
          apnsEnvironment: 'PRODUCTION',
          locale: 'RU',
        ).toJson(),
        {'type': 'IOS', 'pushToken': 'fcm-1', 'apnsToken': 'ab12', 'apnsEnvironment': 'PRODUCTION', 'locale': 'RU'},
      );
    });

    test('leaves the APNs fields out on Android', () {
      expect(const DeviceRegistration(type: 'ANDROID', pushToken: 'fcm-2').toJson(), {
        'type': 'ANDROID',
        'pushToken': 'fcm-2',
      });
    });
  });

  group('payments and loyalty', () {
    test('parses the issuer list', () {
      final list = (fixture('institutes.json')! as List).map((e) => CardInstitute.fromJson(e as Map<String, dynamic>));
      expect(list.first.code, '0001');
    });

    test('extracts the last four digits from the bank mask', () {
      final card = BoundCard.fromJson({
        'id': 'card_1',
        'maskedPan': '9104 **** **** 1234',
        'isDefault': true,
        'cardState': -1,
        'createdAt': '2026-09-01T10:00:00.000Z',
      });
      expect(card.last4, '1234');
      expect(card.isInactive, isTrue);
    });

    test('parses a loyalty account at the top tier', () {
      final account = LoyaltyAccount.fromJson({
        'userId': 'u1',
        'pointsBalance': 1200,
        'lifetimePoints': 9000,
        'tier': 'SIGNATURE',
        'nextTier': null,
        'pointsToNextTier': 0,
        'tierProgressPercent': 100,
        'recent': <Object>[],
      });
      expect(account.tier, LoyaltyTier.signature);
      expect(account.nextTier, isNull);
    });

    test('reads why a promo code does not apply, with the minimum order when that is why', () {
      final refused = PromoValidation.fromJson({
        'valid': false,
        'reason': 'Minimum order is 50.00 MDL',
        'reasonCode': 'PROMO_MIN_ORDER',
        'minOrderCents': 5000,
        'currency': 'MDL',
        'promo': null,
        'discountCents': 0,
        'pointsMultiplier': 1,
      });
      expect(refused.valid, isFalse);
      expect(refused.reasonCode, 'PROMO_MIN_ORDER');
      expect(refused.minOrderCents, 5000);
      expect(refused.currency, 'MDL');

      final older = PromoValidation.fromJson({'valid': false, 'reason': 'Promo has expired'});
      expect(older.reasonCode, isNull);
      expect(older.minOrderCents, isNull);
    });

    test('feature flags default to off', () {
      final flags = FeatureFlags.fromJson({});
      expect(flags.agroprombankEnabled, isFalse);
      expect(flags.cardPaymentFlow, CardPaymentFlow.none);
      expect(flags.cardPaymentsEnabled, isFalse);
      expect(FeatureFlags.fromJson({'deliveryEnabled': true}).deliveryEnabled, isTrue);
    });

    test('reads the card payment flow, deriving it from agroprombankEnabled on an older API', () {
      final web = FeatureFlags.fromJson({'agroprombankEnabled': true, 'cardPaymentFlow': 'web'});
      expect(web.cardPaymentFlow, CardPaymentFlow.web);
      expect(web.webPaymentsEnabled, isTrue);
      expect(web.boundCardsEnabled, isFalse, reason: 'the server chose the bank page over bound cards');
      expect(web.cardPaymentsEnabled, isTrue);

      final older = FeatureFlags.fromJson({'agroprombankEnabled': true});
      expect(older.cardPaymentFlow, CardPaymentFlow.token);
      expect(older.boundCardsEnabled, isTrue);

      expect(FeatureFlags.fromJson({'cardPaymentFlow': 'none'}).cardPaymentsEnabled, isFalse);
      expect(
        FeatureFlags.fromJson({'agroprombankEnabled': true, 'cardPaymentFlow': 'something-new'}).cardPaymentFlow,
        CardPaymentFlow.token,
      );
      expect(const FeatureFlags(agroprombankEnabled: true).boundCardsEnabled, isTrue);
    });

    test('parses a web payment start, with and without a page to open', () {
      final started = StartWebPaymentResult.fromJson({
        'paymentId': 'pay_1',
        'invoiceId': 'inv_1',
        'status': 'REQUIRES_ACTION',
        'page': {
          'method': 'POST',
          'action': 'https://bank.example/pay',
          'fields': {'nivid': 'inv_1', 'sign': 'abc'},
          'url': 'https://bank.example/pay?nivid=inv_1&sign=abc',
        },
        'expiresAt': '2026-10-04T12:20:00.000Z',
      });
      expect(started.alreadySettled, isFalse);
      expect(started.page!.fields['nivid'], 'inv_1');
      expect(started.page!.url, startsWith('https://bank.example/pay?'));
      expect(started.expiresAt!.isUtc, isTrue);

      final held = StartWebPaymentResult.fromJson({
        'paymentId': 'pay_1',
        'invoiceId': 'inv_1',
        'status': 'SUCCEEDED',
        'page': null,
        'expiresAt': null,
      });
      expect(held.alreadySettled, isTrue);
      expect(held.expiresAt, isNull);

      expect(const StartWebPaymentRequest(orderId: 'o1').toJson(), {'orderId': 'o1', 'returnTo': 'mobile'});
    });
  });

  group('feedback', () {
    test('sends the kind and source as the API names them and leaves out what is not given', () {
      const bare = CreateFeedbackRequest(
        kind: FeedbackKind.problem,
        message: 'Cold coffee',
        source: FeedbackSource.ios,
      );
      expect(bare.toJson(), {'kind': 'PROBLEM', 'message': 'Cold coffee', 'source': 'IOS'});

      const full = CreateFeedbackRequest(
        kind: FeedbackKind.suggestion,
        message: 'Oat milk, please',
        source: FeedbackSource.android,
        contact: '@ana',
        appVersion: '1.2.0 (3)',
      );
      expect(full.toJson(), {
        'kind': 'SUGGESTION',
        'message': 'Oat milk, please',
        'source': 'ANDROID',
        'contact': '@ana',
        'appVersion': '1.2.0 (3)',
      });
    });

    test('parses the receipt', () {
      final receipt = FeedbackReceipt.fromJson({'id': 'fb_1', 'createdAt': '2026-10-07T10:00:00.000Z'});
      expect(receipt.id, 'fb_1');
      expect(receipt.createdAt.isUtc, isTrue);
    });
  });

  group('inbox', () {
    test('parses a page with a brand campaign and a platform announcement', () {
      final page = InboxPage.fromJson(fixture('inbox_page.json')! as Map<String, dynamic>);
      expect(page.nextCursor, 'inb_1');
      expect(page.unreadCount, 1);

      final campaign = page.items.first;
      expect(campaign.kind, InboxItemKind.brandCampaign);
      expect(campaign.sender.kind, InboxSenderKind.brand);
      expect(campaign.sender.logoUrl, startsWith('https://'));
      expect(campaign.link!.kind, InboxLinkKind.brand);
      expect(campaign.link!.storeId, isNull, reason: 'a brand with several stores links to the list of places');
      expect(campaign.isRead, isFalse);
      expect(campaign.createdAt.isUtc, isTrue);

      final announcement = page.items.last;
      expect(announcement.kind, InboxItemKind.platformAnnouncement);
      expect(announcement.sender.kind, InboxSenderKind.platform);
      expect(announcement.sender.logoUrl, isNull);
      expect(announcement.link!.storeId, 'st_1');
      expect(announcement.isRead, isTrue);
    });

    test('reads the last page, an item without a link and kinds this build does not know', () {
      final raw = (fixture('inbox_page.json')! as Map<String, dynamic>)['items'] as List<dynamic>;
      final item = InboxItem.fromJson({
        ...raw.first as Map<String, dynamic>,
        'kind': 'SOMETHING_NEW',
        'sender': {'kind': 'ROBOT', 'name': 'X', 'logoUrl': null, 'brandId': null},
        'link': null,
      });
      expect(item.kind, InboxItemKind.unknown);
      expect(item.sender.kind, InboxSenderKind.unknown);
      expect(item.link, isNull);

      final last = InboxPage.fromJson({'items': <Object>[], 'nextCursor': null, 'unreadCount': 0});
      expect(last.items, isEmpty);
      expect(last.nextCursor, isNull);
      expect(InboxUnreadCount.fromJson({'count': 3}).count, 3);
    });

    test('marks a copy read without touching the rest', () {
      final item = InboxPage.fromJson(fixture('inbox_page.json')! as Map<String, dynamic>).items.first;
      final read = item.withReadAt(DateTime.utc(2026, 10, 14, 10));
      expect(read.isRead, isTrue);
      expect(read.id, item.id);
      expect(read.link!.name, item.link!.name);
      expect(read.withReadAt(null).isRead, isFalse);
    });
  });
}
