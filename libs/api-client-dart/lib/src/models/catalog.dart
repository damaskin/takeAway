import 'package:json_annotation/json_annotation.dart';

part 'catalog.g.dart';

@JsonEnum(alwaysCreate: true)
enum StoreStatus {
  @JsonValue('OPEN')
  open,
  @JsonValue('OVERLOADED')
  overloaded,
  @JsonValue('CLOSED')
  closed,
  unknown,
}

/// Why a store cannot take an ASAP order right now; pre-orders for later may
/// still work (see [Store.takesOrders]). A value this build does not know
/// reads as [unknown]: closed for now, pre-orders may work.
@JsonEnum(alwaysCreate: true)
enum AsapBlockedReason {
  /// Outside working hours, and the kitchen did not extend them.
  @JsonValue('OUTSIDE_HOURS')
  outsideHours,

  /// Within working hours, but no shift is open. Since 2026-10-20 the
  /// schedule opens and closes shifts by itself, so this shows only for a
  /// moment between the schedule's passes.
  @JsonValue('SHIFT_CLOSED')
  shiftClosed,

  /// The queue would push the handover past the longest acceptable wait.
  @JsonValue('QUEUE_FULL')
  queueFull,

  /// The kitchen paused the store («Технический перерыв») until
  /// [Store.pausedUntil].
  @JsonValue('PAUSED')
  paused,

  /// Within working hours, but an order placed now would not be ready before
  /// the store closes ([Store.closesAt], or the kitchen's extension).
  @JsonValue('CLOSING_SOON')
  closingSoon,
  unknown;

  /// [raw] as the API spells it (`PAUSED`) — in an error body, say — and
  /// [unknown] for anything else; null stays null.
  static AsapBlockedReason? parse(Object? raw) => raw is String
      ? _$AsapBlockedReasonEnumMap.entries
            .firstWhere((e) => e.value == raw, orElse: () => const MapEntry(AsapBlockedReason.unknown, 'UNKNOWN'))
            .key
      : null;
}

/// Why the kitchen paused the store. Customers are shown a neutral
/// «Технический перерыв» whatever it is.
@JsonEnum(alwaysCreate: true)
enum StorePauseReason {
  @JsonValue('EQUIPMENT')
  equipment,
  @JsonValue('NO_INGREDIENTS')
  noIngredients,
  @JsonValue('NO_STAFF')
  noStaff,
  @JsonValue('OTHER')
  other,
  unknown,
}

@JsonEnum(alwaysCreate: true)
enum VariationType {
  @JsonValue('SIZE')
  size,
  @JsonValue('TEMPERATURE')
  temperature,
  @JsonValue('MILK')
  milk,
  @JsonValue('CUP')
  cup,
  unknown,
}

@JsonSerializable(explicitToJson: true)
class Store {
  const Store({
    required this.id,
    required this.brandId,
    required this.slug,
    required this.name,
    required this.addressLine,
    required this.city,
    required this.country,
    required this.latitude,
    required this.longitude,
    required this.status,
    required this.fulfillmentTypes,
    required this.pickupPointType,
    required this.busyMeter,
    required this.currentEtaSeconds,
    required this.taxRateBps,
    required this.taxIncludedInPrice,
    required this.currency,
    this.openNow,
    this.acceptingOrders,
    this.asapBlockedReason,
    this.opensAt,
    this.closesAt,
    this.pausedUntil,
    this.pauseReason,
    this.brandName,
    this.logoUrl,
    this.heroImageUrl,
    this.kinds,
    this.distanceMeters,
  });

  factory Store.fromJson(Map<String, dynamic> json) => _$StoreFromJson(json);

  Map<String, dynamic> toJson() => _$StoreToJson(this);

  final String id;
  final String brandId;
  final String slug;
  final String name;
  final String addressLine;
  final String city;
  final String country;
  final double latitude;
  final double longitude;
  @JsonKey(unknownEnumValue: StoreStatus.unknown)
  final StoreStatus status;
  @JsonKey(defaultValue: <String>[])
  final List<String> fulfillmentTypes;
  final String pickupPointType;
  final int busyMeter;
  final int currentEtaSeconds;

  /// Whether an ASAP order placed now would be accepted: not switched off, a
  /// shift is running, within working hours (or the kitchen extended them)
  /// and the queue is not full. Working hours win over the shift (owner
  /// decision 2026-10-14). Null from API versions that predate it.
  final bool? openNow;

  /// Whether the store takes some order right now: an ASAP one ([openNow]) or
  /// a pre-order for a time in the next 24 hours, even while the shift is
  /// closed. False means not working at all; checkout is refused. Null from
  /// API versions that predate shifts.
  final bool? acceptingOrders;

  /// Why [openNow] is false; null while it is true and from older APIs.
  @JsonKey(unknownEnumValue: AsapBlockedReason.unknown)
  final AsapBlockedReason? asapBlockedReason;

  /// Start of the next working-hours window while outside hours, else null.
  final DateTime? opensAt;

  /// End of the current working-hours window while within hours; null outside
  /// hours and for a store open around the clock.
  final DateTime? closesAt;

  /// The kitchen paused the store until then ([AsapBlockedReason.paused]);
  /// pre-orders for a time inside the pause are refused too. Null when not
  /// paused and from API versions that predate pauses.
  final DateTime? pausedUntil;

  /// Why the store is paused; null when it is not.
  @JsonKey(unknownEnumValue: StorePauseReason.unknown)
  final StorePauseReason? pauseReason;
  @JsonKey(defaultValue: 0)
  final int taxRateBps;
  @JsonKey(defaultValue: true)
  final bool taxIncludedInPrice;
  final String currency;

  /// Name of the business behind the store. Null from API versions that
  /// predate it.
  final String? brandName;

  /// Logo for the store card — the brand's, stores have none of their own.
  final String? logoUrl;

  /// Photo of the store itself; null when it has none (store cards then show
  /// the brand's [logoUrl]).
  final String? heroImageUrl;

  /// What the store sells: `COFFEE`, `FOOD` or both. Only the string entries
  /// are kept; null from API versions that predate it, and a missing or
  /// empty list means a coffee shop.
  @JsonKey(fromJson: _kindsFromJson)
  final List<String>? kinds;
  final double? distanceMeters;

  bool get hasLocation => latitude != 0 || longitude != 0;

  /// Takes ASAP orders right now. Falls back to the manual switch alone when
  /// the API does not send [openNow].
  bool get isOpen => status != StoreStatus.closed && !isInactive && (openNow ?? true);

  /// Takes no orders at all right now — switched off, or nothing bookable in
  /// the next 24 hours. Shown as "not working"; checkout is refused.
  bool get isInactive => status == StoreStatus.closed || acceptingOrders == false;

  /// Takes some order right now: ASAP, or a pre-order for later while it is
  /// closed for ASAP. The menu, the cart and checkout stay usable. An API
  /// without [acceptingOrders] knows ASAP only, so [isOpen] decides there.
  bool get takesOrders => acceptingOrders == null ? isOpen : !isInactive;

  /// Takes orders for a time later only: closed now (after hours, a full
  /// queue, a kitchen pause, the closing too close), open for pre-orders.
  bool get preorderOnly => takesOrders && !isOpen;

  /// [status] as customers see it: a store that does not take ASAP orders
  /// right now (see [isOpen]) reads as closed.
  StoreStatus get effectiveStatus => isOpen ? status : StoreStatus.closed;
  bool get supportsDelivery => fulfillmentTypes.contains('DELIVERY');
  String get fullAddress => [addressLine, city].where((p) => p.trim().isNotEmpty).join(', ');
}

@JsonSerializable(explicitToJson: true)
class StoreWorkingHour {
  const StoreWorkingHour({
    required this.weekday,
    required this.opensAt,
    required this.closesAt,
    required this.isClosed,
  });

  factory StoreWorkingHour.fromJson(Map<String, dynamic> json) => _$StoreWorkingHourFromJson(json);

  Map<String, dynamic> toJson() => _$StoreWorkingHourToJson(this);

  /// 0 = Sunday … 6 = Saturday.
  final int weekday;

  /// Minutes since local midnight.
  final int opensAt;
  final int closesAt;
  final bool isClosed;
}

@JsonSerializable(explicitToJson: true)
class BrandInfo {
  const BrandInfo({required this.id, required this.slug, required this.name, this.logoUrl, this.themeOverrides});

  factory BrandInfo.fromJson(Map<String, dynamic> json) => _$BrandInfoFromJson(json);

  Map<String, dynamic> toJson() => _$BrandInfoToJson(this);

  final String id;
  final String slug;
  final String name;
  final String? logoUrl;
  final Map<String, dynamic>? themeOverrides;
}

@JsonSerializable(explicitToJson: true)
class StoreDetail extends Store {
  const StoreDetail({
    required super.id,
    required super.brandId,
    required super.slug,
    required super.name,
    required super.addressLine,
    required super.city,
    required super.country,
    required super.latitude,
    required super.longitude,
    required super.status,
    required super.fulfillmentTypes,
    required super.pickupPointType,
    required super.busyMeter,
    required super.currentEtaSeconds,
    required super.taxRateBps,
    required super.taxIncludedInPrice,
    required super.currency,
    required this.timezone,
    required this.minOrderCents,
    required this.galleryUrls,
    required this.workingHours,
    required this.brand,
    super.openNow,
    super.acceptingOrders,
    super.asapBlockedReason,
    super.opensAt,
    super.closesAt,
    super.pausedUntil,
    super.pauseReason,
    super.heroImageUrl,
    super.kinds,
    super.distanceMeters,
    this.phone,
    this.email,
  });

  factory StoreDetail.fromJson(Map<String, dynamic> json) => _$StoreDetailFromJson(json);

  @override
  Map<String, dynamic> toJson() => _$StoreDetailToJson(this);

  final String timezone;
  final String? phone;
  final String? email;
  @JsonKey(defaultValue: 0)
  final int minOrderCents;
  @JsonKey(defaultValue: <String>[])
  final List<String> galleryUrls;
  @JsonKey(defaultValue: <StoreWorkingHour>[])
  final List<StoreWorkingHour> workingHours;
  final BrandInfo brand;
}

@JsonSerializable(explicitToJson: true)
class Variation {
  const Variation({
    required this.id,
    required this.type,
    required this.name,
    required this.priceDeltaCents,
    required this.prepTimeDeltaSeconds,
    required this.sortOrder,
    required this.isDefault,
  });

  factory Variation.fromJson(Map<String, dynamic> json) => _$VariationFromJson(json);

  Map<String, dynamic> toJson() => _$VariationToJson(this);

  final String id;
  @JsonKey(unknownEnumValue: VariationType.unknown)
  final VariationType type;
  final String name;
  final int priceDeltaCents;
  @JsonKey(defaultValue: 0)
  final int prepTimeDeltaSeconds;
  @JsonKey(defaultValue: 0)
  final int sortOrder;
  @JsonKey(defaultValue: false)
  final bool isDefault;
}

@JsonSerializable(explicitToJson: true)
class Modifier {
  const Modifier({
    required this.id,
    required this.slug,
    required this.name,
    required this.priceDeltaCents,
    required this.prepTimeDeltaSeconds,
    required this.minCount,
    required this.maxCount,
    required this.sortOrder,
    this.group,
  });

  factory Modifier.fromJson(Map<String, dynamic> json) => _$ModifierFromJson(json);

  Map<String, dynamic> toJson() => _$ModifierToJson(this);

  final String id;
  final String slug;
  final String name;
  final int priceDeltaCents;
  @JsonKey(defaultValue: 0)
  final int prepTimeDeltaSeconds;
  @JsonKey(defaultValue: 0)
  final int minCount;
  @JsonKey(defaultValue: 1)
  final int maxCount;
  @JsonKey(defaultValue: 0)
  final int sortOrder;

  /// Display group of the add-on — «Сиропы», «Соусы», «Убрать». Null (or
  /// blank, or from API versions that predate it) means the generic
  /// «Добавки».
  @JsonKey(fromJson: _labelFromJson)
  final String? group;
}

@JsonSerializable(explicitToJson: true)
class Product {
  const Product({
    required this.id,
    required this.categoryId,
    required this.slug,
    required this.name,
    required this.basePriceCents,
    required this.prepTimeSeconds,
    required this.allergens,
    required this.dietTags,
    required this.imageUrls,
    required this.sortOrder,
    this.description,
    this.caffeineLevel,
    this.calories,
    this.proteinsGrams,
    this.fatsGrams,
    this.carbsGrams,
    this.onStopList = false,
    this.categoryKind,
  });

  factory Product.fromJson(Map<String, dynamic> json) => _$ProductFromJson(json);

  Map<String, dynamic> toJson() => _$ProductToJson(this);

  final String id;
  final String categoryId;
  final String slug;
  final String name;
  final String? description;
  final int basePriceCents;
  @JsonKey(defaultValue: 0)
  final int prepTimeSeconds;
  final int? caffeineLevel;
  final int? calories;
  final double? proteinsGrams;
  final double? fatsGrams;
  final double? carbsGrams;
  @JsonKey(defaultValue: <String>[])
  final List<String> allergens;
  @JsonKey(defaultValue: <String>[])
  final List<String> dietTags;
  @JsonKey(defaultValue: <String>[])
  final List<String> imageUrls;
  @JsonKey(defaultValue: 0)
  final int sortOrder;
  @JsonKey(defaultValue: false)
  final bool onStopList;

  /// Kind of the product's category: `HOT_DRINKS`, `COLD_DRINKS`, `FOOD`,
  /// `BAKERY` or `OTHER`, as sent (values this client does not know pass
  /// through). Null from API versions that predate it.
  @JsonKey(fromJson: _labelFromJson)
  final String? categoryKind;

  String? get imageUrl => imageUrls.isEmpty ? null : imageUrls.first;
  bool get hasNutrition => proteinsGrams != null || fatsGrams != null || carbsGrams != null;
}

@JsonSerializable(explicitToJson: true)
class ProductDetail extends Product {
  const ProductDetail({
    required super.id,
    required super.categoryId,
    required super.slug,
    required super.name,
    required super.basePriceCents,
    required super.prepTimeSeconds,
    required super.allergens,
    required super.dietTags,
    required super.imageUrls,
    required super.sortOrder,
    required this.brandId,
    required this.variations,
    required this.modifiers,
    super.description,
    super.caffeineLevel,
    super.calories,
    super.proteinsGrams,
    super.fatsGrams,
    super.carbsGrams,
    super.onStopList,
    super.categoryKind,
  });

  factory ProductDetail.fromJson(Map<String, dynamic> json) => _$ProductDetailFromJson(json);

  @override
  Map<String, dynamic> toJson() => _$ProductDetailToJson(this);

  final String brandId;
  @JsonKey(defaultValue: <Variation>[])
  final List<Variation> variations;
  @JsonKey(defaultValue: <Modifier>[])
  final List<Modifier> modifiers;
}

@JsonSerializable(explicitToJson: true)
class MenuCategory {
  const MenuCategory({
    required this.id,
    required this.slug,
    required this.name,
    required this.sortOrder,
    required this.products,
    this.description,
    this.iconUrl,
    this.availableFrom,
    this.availableTo,
    this.kind,
  });

  factory MenuCategory.fromJson(Map<String, dynamic> json) => _$MenuCategoryFromJson(json);

  Map<String, dynamic> toJson() => _$MenuCategoryToJson(this);

  final String id;
  final String slug;
  final String name;
  final String? description;
  final String? iconUrl;
  @JsonKey(defaultValue: 0)
  final int sortOrder;
  final int? availableFrom;
  final int? availableTo;
  @JsonKey(defaultValue: <Product>[])
  final List<Product> products;

  /// What the category holds: `HOT_DRINKS`, `COLD_DRINKS`, `FOOD`, `BAKERY`
  /// or `OTHER`, as sent. Null from API versions that predate it.
  @JsonKey(fromJson: _labelFromJson)
  final String? kind;
}

@JsonSerializable(explicitToJson: true)
class Menu {
  const Menu({required this.storeId, required this.storeSlug, required this.categories});

  factory Menu.fromJson(Map<String, dynamic> json) => _$MenuFromJson(json);

  Map<String, dynamic> toJson() => _$MenuToJson(this);

  final String storeId;
  final String storeSlug;
  @JsonKey(defaultValue: <MenuCategory>[])
  final List<MenuCategory> categories;

  /// Categories that actually have something to show.
  List<MenuCategory> get visibleCategories => categories.where((c) => c.products.isNotEmpty).toList();

  Iterable<Product> get allProducts => categories.expand((c) => c.products);
}

/// `GET /stores/{idOrSlug}/suggestions`: what to offer next to the products
/// in hand — the cart's lines, or the product on screen.
@JsonSerializable()
class StoreSuggestions {
  const StoreSuggestions({required this.productIds, required this.source});

  factory StoreSuggestions.fromJson(Map<String, dynamic> json) => _$StoreSuggestionsFromJson(json);

  Map<String, dynamic> toJson() => _$StoreSuggestionsToJson(this);

  /// Products of the store's menu, in stock, best first; none of those in hand.
  @JsonKey(defaultValue: <String>[])
  final List<String> productIds;

  /// `copurchase` — what customers bought together with the products in hand
  /// over the last 90 days; `rule` — bakery and food next to a drink, from
  /// the menu, while the store has too few orders to tell.
  @JsonKey(defaultValue: 'rule')
  final String source;

  /// The only case the row may say «Часто берут вместе».
  bool get boughtTogether => source == 'copurchase';
}

@JsonSerializable(explicitToJson: true)
class PickupSlot {
  const PickupSlot({
    required this.startsAt,
    required this.endsAt,
    required this.taken,
    required this.capacity,
    required this.available,
  });

  factory PickupSlot.fromJson(Map<String, dynamic> json) => _$PickupSlotFromJson(json);

  Map<String, dynamic> toJson() => _$PickupSlotToJson(this);

  final DateTime startsAt;
  final DateTime endsAt;
  final int taken;
  final int capacity;
  final bool available;
}

List<String>? _kindsFromJson(Object? raw) => raw is List
    ? [
        for (final kind in raw)
          if (kind is String) kind,
      ]
    : null;

/// A text field that older APIs leave out and newer ones may send blank:
/// anything but a non-blank string reads as null.
String? _labelFromJson(Object? raw) => raw is String && raw.trim().isNotEmpty ? raw.trim() : null;
