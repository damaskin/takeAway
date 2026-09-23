import 'dart:convert';
import 'dart:io';

import 'package:takeaway_api/takeaway_api.dart';
import 'package:test/test.dart';

/// Fixtures under `test/fixtures` are real responses captured from the
/// public production API (stores, menu, slots, product, institutes); order
/// and cart payloads are built from the API DTOs, since those need a login.
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

    test('parses pickup slots as UTC instants', () {
      final slots = (fixture('pickup_slots.json')! as List)
          .map((e) => PickupSlot.fromJson(e as Map<String, dynamic>))
          .toList();
      expect(slots, hasLength(greaterThan(10)));
      expect(slots.first.startsAt.isUtc, isTrue);
      expect(slots.first.endsAt.difference(slots.first.startsAt), const Duration(minutes: 15));
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
      expect(OrderStatus.accepted.isCancellable, isTrue);
      expect(OrderStatus.inProgress.isCancellable, isFalse);
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

    test('feature flags default to off', () {
      expect(FeatureFlags.fromJson({}).agroprombankEnabled, isFalse);
      expect(FeatureFlags.fromJson({'deliveryEnabled': true}).deliveryEnabled, isTrue);
    });
  });
}
