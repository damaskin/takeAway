// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'inbox.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

InboxSender _$InboxSenderFromJson(Map<String, dynamic> json) => InboxSender(
  kind: $enumDecode(_$InboxSenderKindEnumMap, json['kind'], unknownValue: InboxSenderKind.unknown),
  name: json['name'] as String,
  logoUrl: json['logoUrl'] as String?,
  brandId: json['brandId'] as String?,
);

const _$InboxSenderKindEnumMap = {
  InboxSenderKind.brand: 'BRAND',
  InboxSenderKind.platform: 'PLATFORM',
  InboxSenderKind.unknown: 'unknown',
};

InboxLink _$InboxLinkFromJson(Map<String, dynamic> json) => InboxLink(
  kind: $enumDecode(_$InboxLinkKindEnumMap, json['kind'], unknownValue: InboxLinkKind.unknown),
  name: json['name'] as String,
  storeId: json['storeId'] as String?,
  storeSlug: json['storeSlug'] as String?,
  brandId: json['brandId'] as String?,
);

const _$InboxLinkKindEnumMap = {
  InboxLinkKind.store: 'STORE',
  InboxLinkKind.brand: 'BRAND',
  InboxLinkKind.unknown: 'unknown',
};

InboxItem _$InboxItemFromJson(Map<String, dynamic> json) => InboxItem(
  id: json['id'] as String,
  kind: $enumDecode(_$InboxItemKindEnumMap, json['kind'], unknownValue: InboxItemKind.unknown),
  title: json['title'] as String,
  body: json['body'] as String,
  sender: InboxSender.fromJson(json['sender'] as Map<String, dynamic>),
  createdAt: DateTime.parse(json['createdAt'] as String),
  link: json['link'] == null ? null : InboxLink.fromJson(json['link'] as Map<String, dynamic>),
  readAt: json['readAt'] == null ? null : DateTime.parse(json['readAt'] as String),
);

const _$InboxItemKindEnumMap = {
  InboxItemKind.brandCampaign: 'BRAND_CAMPAIGN',
  InboxItemKind.platformAnnouncement: 'PLATFORM_ANNOUNCEMENT',
  InboxItemKind.unknown: 'unknown',
};

InboxPage _$InboxPageFromJson(Map<String, dynamic> json) => InboxPage(
  items: (json['items'] as List<dynamic>?)?.map((e) => InboxItem.fromJson(e as Map<String, dynamic>)).toList() ?? [],
  unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
  nextCursor: json['nextCursor'] as String?,
);

InboxUnreadCount _$InboxUnreadCountFromJson(Map<String, dynamic> json) =>
    InboxUnreadCount(count: (json['count'] as num).toInt());
