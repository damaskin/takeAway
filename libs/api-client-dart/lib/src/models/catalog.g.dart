// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Store _$StoreFromJson(Map<String, dynamic> json) => Store(
  id: json['id'] as String,
  brandId: json['brandId'] as String,
  slug: json['slug'] as String,
  name: json['name'] as String,
  addressLine: json['addressLine'] as String,
  city: json['city'] as String,
  country: json['country'] as String,
  latitude: (json['latitude'] as num).toDouble(),
  longitude: (json['longitude'] as num).toDouble(),
  status: $enumDecode(_$StoreStatusEnumMap, json['status'], unknownValue: StoreStatus.unknown),
  fulfillmentTypes: (json['fulfillmentTypes'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  pickupPointType: json['pickupPointType'] as String,
  busyMeter: (json['busyMeter'] as num).toInt(),
  currentEtaSeconds: (json['currentEtaSeconds'] as num).toInt(),
  taxRateBps: (json['taxRateBps'] as num?)?.toInt() ?? 0,
  taxIncludedInPrice: json['taxIncludedInPrice'] as bool? ?? true,
  currency: json['currency'] as String,
  openNow: json['openNow'] as bool?,
  heroImageUrl: json['heroImageUrl'] as String?,
  distanceMeters: (json['distanceMeters'] as num?)?.toDouble(),
);

Map<String, dynamic> _$StoreToJson(Store instance) => <String, dynamic>{
  'id': instance.id,
  'brandId': instance.brandId,
  'slug': instance.slug,
  'name': instance.name,
  'addressLine': instance.addressLine,
  'city': instance.city,
  'country': instance.country,
  'latitude': instance.latitude,
  'longitude': instance.longitude,
  'status': _$StoreStatusEnumMap[instance.status]!,
  'fulfillmentTypes': instance.fulfillmentTypes,
  'pickupPointType': instance.pickupPointType,
  'busyMeter': instance.busyMeter,
  'currentEtaSeconds': instance.currentEtaSeconds,
  'openNow': instance.openNow,
  'taxRateBps': instance.taxRateBps,
  'taxIncludedInPrice': instance.taxIncludedInPrice,
  'currency': instance.currency,
  'heroImageUrl': instance.heroImageUrl,
  'distanceMeters': instance.distanceMeters,
};

const _$StoreStatusEnumMap = {
  StoreStatus.open: 'OPEN',
  StoreStatus.overloaded: 'OVERLOADED',
  StoreStatus.closed: 'CLOSED',
  StoreStatus.unknown: 'unknown',
};

StoreWorkingHour _$StoreWorkingHourFromJson(Map<String, dynamic> json) => StoreWorkingHour(
  weekday: (json['weekday'] as num).toInt(),
  opensAt: (json['opensAt'] as num).toInt(),
  closesAt: (json['closesAt'] as num).toInt(),
  isClosed: json['isClosed'] as bool,
);

Map<String, dynamic> _$StoreWorkingHourToJson(StoreWorkingHour instance) => <String, dynamic>{
  'weekday': instance.weekday,
  'opensAt': instance.opensAt,
  'closesAt': instance.closesAt,
  'isClosed': instance.isClosed,
};

BrandInfo _$BrandInfoFromJson(Map<String, dynamic> json) => BrandInfo(
  id: json['id'] as String,
  slug: json['slug'] as String,
  name: json['name'] as String,
  logoUrl: json['logoUrl'] as String?,
  themeOverrides: json['themeOverrides'] as Map<String, dynamic>?,
);

Map<String, dynamic> _$BrandInfoToJson(BrandInfo instance) => <String, dynamic>{
  'id': instance.id,
  'slug': instance.slug,
  'name': instance.name,
  'logoUrl': instance.logoUrl,
  'themeOverrides': instance.themeOverrides,
};

StoreDetail _$StoreDetailFromJson(Map<String, dynamic> json) => StoreDetail(
  id: json['id'] as String,
  brandId: json['brandId'] as String,
  slug: json['slug'] as String,
  name: json['name'] as String,
  addressLine: json['addressLine'] as String,
  city: json['city'] as String,
  country: json['country'] as String,
  latitude: (json['latitude'] as num).toDouble(),
  longitude: (json['longitude'] as num).toDouble(),
  status: $enumDecode(_$StoreStatusEnumMap, json['status'], unknownValue: StoreStatus.unknown),
  fulfillmentTypes: (json['fulfillmentTypes'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  pickupPointType: json['pickupPointType'] as String,
  busyMeter: (json['busyMeter'] as num).toInt(),
  currentEtaSeconds: (json['currentEtaSeconds'] as num).toInt(),
  taxRateBps: (json['taxRateBps'] as num?)?.toInt() ?? 0,
  taxIncludedInPrice: json['taxIncludedInPrice'] as bool? ?? true,
  currency: json['currency'] as String,
  timezone: json['timezone'] as String,
  minOrderCents: (json['minOrderCents'] as num?)?.toInt() ?? 0,
  galleryUrls: (json['galleryUrls'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  workingHours:
      (json['workingHours'] as List<dynamic>?)
          ?.map((e) => StoreWorkingHour.fromJson(e as Map<String, dynamic>))
          .toList() ??
      [],
  brand: BrandInfo.fromJson(json['brand'] as Map<String, dynamic>),
  openNow: json['openNow'] as bool?,
  heroImageUrl: json['heroImageUrl'] as String?,
  distanceMeters: (json['distanceMeters'] as num?)?.toDouble(),
  phone: json['phone'] as String?,
  email: json['email'] as String?,
);

Map<String, dynamic> _$StoreDetailToJson(StoreDetail instance) => <String, dynamic>{
  'id': instance.id,
  'brandId': instance.brandId,
  'slug': instance.slug,
  'name': instance.name,
  'addressLine': instance.addressLine,
  'city': instance.city,
  'country': instance.country,
  'latitude': instance.latitude,
  'longitude': instance.longitude,
  'status': _$StoreStatusEnumMap[instance.status]!,
  'fulfillmentTypes': instance.fulfillmentTypes,
  'pickupPointType': instance.pickupPointType,
  'busyMeter': instance.busyMeter,
  'currentEtaSeconds': instance.currentEtaSeconds,
  'openNow': instance.openNow,
  'taxRateBps': instance.taxRateBps,
  'taxIncludedInPrice': instance.taxIncludedInPrice,
  'currency': instance.currency,
  'heroImageUrl': instance.heroImageUrl,
  'distanceMeters': instance.distanceMeters,
  'timezone': instance.timezone,
  'phone': instance.phone,
  'email': instance.email,
  'minOrderCents': instance.minOrderCents,
  'galleryUrls': instance.galleryUrls,
  'workingHours': instance.workingHours.map((e) => e.toJson()).toList(),
  'brand': instance.brand.toJson(),
};

Variation _$VariationFromJson(Map<String, dynamic> json) => Variation(
  id: json['id'] as String,
  type: $enumDecode(_$VariationTypeEnumMap, json['type'], unknownValue: VariationType.unknown),
  name: json['name'] as String,
  priceDeltaCents: (json['priceDeltaCents'] as num).toInt(),
  prepTimeDeltaSeconds: (json['prepTimeDeltaSeconds'] as num?)?.toInt() ?? 0,
  sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
  isDefault: json['isDefault'] as bool? ?? false,
);

Map<String, dynamic> _$VariationToJson(Variation instance) => <String, dynamic>{
  'id': instance.id,
  'type': _$VariationTypeEnumMap[instance.type]!,
  'name': instance.name,
  'priceDeltaCents': instance.priceDeltaCents,
  'prepTimeDeltaSeconds': instance.prepTimeDeltaSeconds,
  'sortOrder': instance.sortOrder,
  'isDefault': instance.isDefault,
};

const _$VariationTypeEnumMap = {
  VariationType.size: 'SIZE',
  VariationType.temperature: 'TEMPERATURE',
  VariationType.milk: 'MILK',
  VariationType.cup: 'CUP',
  VariationType.unknown: 'unknown',
};

Modifier _$ModifierFromJson(Map<String, dynamic> json) => Modifier(
  id: json['id'] as String,
  slug: json['slug'] as String,
  name: json['name'] as String,
  priceDeltaCents: (json['priceDeltaCents'] as num).toInt(),
  prepTimeDeltaSeconds: (json['prepTimeDeltaSeconds'] as num?)?.toInt() ?? 0,
  minCount: (json['minCount'] as num?)?.toInt() ?? 0,
  maxCount: (json['maxCount'] as num?)?.toInt() ?? 1,
  sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
);

Map<String, dynamic> _$ModifierToJson(Modifier instance) => <String, dynamic>{
  'id': instance.id,
  'slug': instance.slug,
  'name': instance.name,
  'priceDeltaCents': instance.priceDeltaCents,
  'prepTimeDeltaSeconds': instance.prepTimeDeltaSeconds,
  'minCount': instance.minCount,
  'maxCount': instance.maxCount,
  'sortOrder': instance.sortOrder,
};

Product _$ProductFromJson(Map<String, dynamic> json) => Product(
  id: json['id'] as String,
  categoryId: json['categoryId'] as String,
  slug: json['slug'] as String,
  name: json['name'] as String,
  basePriceCents: (json['basePriceCents'] as num).toInt(),
  prepTimeSeconds: (json['prepTimeSeconds'] as num?)?.toInt() ?? 0,
  allergens: (json['allergens'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  dietTags: (json['dietTags'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  imageUrls: (json['imageUrls'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
  description: json['description'] as String?,
  caffeineLevel: (json['caffeineLevel'] as num?)?.toInt(),
  calories: (json['calories'] as num?)?.toInt(),
  proteinsGrams: (json['proteinsGrams'] as num?)?.toDouble(),
  fatsGrams: (json['fatsGrams'] as num?)?.toDouble(),
  carbsGrams: (json['carbsGrams'] as num?)?.toDouble(),
  onStopList: json['onStopList'] as bool? ?? false,
);

Map<String, dynamic> _$ProductToJson(Product instance) => <String, dynamic>{
  'id': instance.id,
  'categoryId': instance.categoryId,
  'slug': instance.slug,
  'name': instance.name,
  'description': instance.description,
  'basePriceCents': instance.basePriceCents,
  'prepTimeSeconds': instance.prepTimeSeconds,
  'caffeineLevel': instance.caffeineLevel,
  'calories': instance.calories,
  'proteinsGrams': instance.proteinsGrams,
  'fatsGrams': instance.fatsGrams,
  'carbsGrams': instance.carbsGrams,
  'allergens': instance.allergens,
  'dietTags': instance.dietTags,
  'imageUrls': instance.imageUrls,
  'sortOrder': instance.sortOrder,
  'onStopList': instance.onStopList,
};

ProductDetail _$ProductDetailFromJson(Map<String, dynamic> json) => ProductDetail(
  id: json['id'] as String,
  categoryId: json['categoryId'] as String,
  slug: json['slug'] as String,
  name: json['name'] as String,
  basePriceCents: (json['basePriceCents'] as num).toInt(),
  prepTimeSeconds: (json['prepTimeSeconds'] as num?)?.toInt() ?? 0,
  allergens: (json['allergens'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  dietTags: (json['dietTags'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  imageUrls: (json['imageUrls'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
  brandId: json['brandId'] as String,
  variations:
      (json['variations'] as List<dynamic>?)?.map((e) => Variation.fromJson(e as Map<String, dynamic>)).toList() ?? [],
  modifiers:
      (json['modifiers'] as List<dynamic>?)?.map((e) => Modifier.fromJson(e as Map<String, dynamic>)).toList() ?? [],
  description: json['description'] as String?,
  caffeineLevel: (json['caffeineLevel'] as num?)?.toInt(),
  calories: (json['calories'] as num?)?.toInt(),
  proteinsGrams: (json['proteinsGrams'] as num?)?.toDouble(),
  fatsGrams: (json['fatsGrams'] as num?)?.toDouble(),
  carbsGrams: (json['carbsGrams'] as num?)?.toDouble(),
  onStopList: json['onStopList'] as bool? ?? false,
);

Map<String, dynamic> _$ProductDetailToJson(ProductDetail instance) => <String, dynamic>{
  'id': instance.id,
  'categoryId': instance.categoryId,
  'slug': instance.slug,
  'name': instance.name,
  'description': instance.description,
  'basePriceCents': instance.basePriceCents,
  'prepTimeSeconds': instance.prepTimeSeconds,
  'caffeineLevel': instance.caffeineLevel,
  'calories': instance.calories,
  'proteinsGrams': instance.proteinsGrams,
  'fatsGrams': instance.fatsGrams,
  'carbsGrams': instance.carbsGrams,
  'allergens': instance.allergens,
  'dietTags': instance.dietTags,
  'imageUrls': instance.imageUrls,
  'sortOrder': instance.sortOrder,
  'onStopList': instance.onStopList,
  'brandId': instance.brandId,
  'variations': instance.variations.map((e) => e.toJson()).toList(),
  'modifiers': instance.modifiers.map((e) => e.toJson()).toList(),
};

MenuCategory _$MenuCategoryFromJson(Map<String, dynamic> json) => MenuCategory(
  id: json['id'] as String,
  slug: json['slug'] as String,
  name: json['name'] as String,
  sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
  products:
      (json['products'] as List<dynamic>?)?.map((e) => Product.fromJson(e as Map<String, dynamic>)).toList() ?? [],
  description: json['description'] as String?,
  iconUrl: json['iconUrl'] as String?,
  availableFrom: (json['availableFrom'] as num?)?.toInt(),
  availableTo: (json['availableTo'] as num?)?.toInt(),
);

Map<String, dynamic> _$MenuCategoryToJson(MenuCategory instance) => <String, dynamic>{
  'id': instance.id,
  'slug': instance.slug,
  'name': instance.name,
  'description': instance.description,
  'iconUrl': instance.iconUrl,
  'sortOrder': instance.sortOrder,
  'availableFrom': instance.availableFrom,
  'availableTo': instance.availableTo,
  'products': instance.products.map((e) => e.toJson()).toList(),
};

Menu _$MenuFromJson(Map<String, dynamic> json) => Menu(
  storeId: json['storeId'] as String,
  storeSlug: json['storeSlug'] as String,
  categories:
      (json['categories'] as List<dynamic>?)?.map((e) => MenuCategory.fromJson(e as Map<String, dynamic>)).toList() ??
      [],
);

Map<String, dynamic> _$MenuToJson(Menu instance) => <String, dynamic>{
  'storeId': instance.storeId,
  'storeSlug': instance.storeSlug,
  'categories': instance.categories.map((e) => e.toJson()).toList(),
};

PickupSlot _$PickupSlotFromJson(Map<String, dynamic> json) => PickupSlot(
  startsAt: DateTime.parse(json['startsAt'] as String),
  endsAt: DateTime.parse(json['endsAt'] as String),
  taken: (json['taken'] as num).toInt(),
  capacity: (json['capacity'] as num).toInt(),
  available: json['available'] as bool,
);

Map<String, dynamic> _$PickupSlotToJson(PickupSlot instance) => <String, dynamic>{
  'startsAt': instance.startsAt.toIso8601String(),
  'endsAt': instance.endsAt.toIso8601String(),
  'taken': instance.taken,
  'capacity': instance.capacity,
  'available': instance.available,
};
