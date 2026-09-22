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
    this.heroImageUrl,
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

  /// Whether an ASAP order placed now would be accepted — the manual switch
  /// plus working hours, computed by the API in the store's timezone. Null
  /// from API versions that predate it.
  final bool? openNow;
  @JsonKey(defaultValue: 0)
  final int taxRateBps;
  @JsonKey(defaultValue: true)
  final bool taxIncludedInPrice;
  final String currency;
  final String? heroImageUrl;
  final double? distanceMeters;

  bool get hasLocation => latitude != 0 || longitude != 0;

  /// Takes ASAP orders right now. Falls back to the manual switch alone when
  /// the API does not send [openNow].
  bool get isOpen => status != StoreStatus.closed && (openNow ?? true);

  /// [status] with working hours applied: a store switched on but outside its
  /// hours reads as closed.
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
    super.heroImageUrl,
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
