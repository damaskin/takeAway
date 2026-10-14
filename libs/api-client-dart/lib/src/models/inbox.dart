import 'package:json_annotation/json_annotation.dart';

part 'inbox.g.dart';

/// «Уведомления» — the customer's inbox: brand campaigns and announcements
/// from takeAway itself. Order news is not here; the Orders screens show it.
@JsonEnum(alwaysCreate: true)
enum InboxItemKind {
  @JsonValue('BRAND_CAMPAIGN')
  brandCampaign,
  @JsonValue('PLATFORM_ANNOUNCEMENT')
  platformAnnouncement,
  unknown,
}

@JsonEnum(alwaysCreate: true)
enum InboxSenderKind {
  @JsonValue('BRAND')
  brand,

  /// takeAway itself: the app draws its own mark, not [InboxSender.logoUrl].
  @JsonValue('PLATFORM')
  platform,
  unknown,
}

@JsonEnum(alwaysCreate: true)
enum InboxLinkKind {
  @JsonValue('STORE')
  store,
  @JsonValue('BRAND')
  brand,
  unknown,
}

/// Who a message is from, as the list shows it.
@JsonSerializable(createToJson: false)
class InboxSender {
  const InboxSender({required this.kind, required this.name, this.logoUrl, this.brandId});

  factory InboxSender.fromJson(Map<String, dynamic> json) => _$InboxSenderFromJson(json);

  @JsonKey(unknownEnumValue: InboxSenderKind.unknown)
  final InboxSenderKind kind;
  final String name;
  final String? logoUrl;
  final String? brandId;
}

/// Where tapping a message leads.
@JsonSerializable(createToJson: false)
class InboxLink {
  const InboxLink({required this.kind, required this.name, this.storeId, this.storeSlug, this.brandId});

  factory InboxLink.fromJson(Map<String, dynamic> json) => _$InboxLinkFromJson(json);

  @JsonKey(unknownEnumValue: InboxLinkKind.unknown)
  final InboxLinkKind kind;

  /// The store whose menu opens. A BRAND link has one only when the brand
  /// has exactly one store open to customers; with several (or none yet)
  /// it is null and the clients show the list of places instead.
  final String? storeId;
  final String? storeSlug;
  final String? brandId;

  /// The store's or the brand's name, for the button.
  final String name;
}

/// One message of `GET /inbox`, or `GET /inbox/{id}`.
@JsonSerializable(createToJson: false)
class InboxItem {
  const InboxItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.sender,
    required this.createdAt,
    this.link,
    this.readAt,
  });

  factory InboxItem.fromJson(Map<String, dynamic> json) => _$InboxItemFromJson(json);

  final String id;
  @JsonKey(unknownEnumValue: InboxItemKind.unknown)
  final InboxItemKind kind;
  final String title;
  final String body;
  final InboxSender sender;
  final InboxLink? link;
  final DateTime createdAt;

  /// Null until the customer opened it.
  final DateTime? readAt;

  bool get isRead => readAt != null;

  /// This message with [readAt] set, or cleared when null.
  InboxItem withReadAt(DateTime? readAt) => InboxItem(
    id: id,
    kind: kind,
    title: title,
    body: body,
    sender: sender,
    link: link,
    createdAt: createdAt,
    readAt: readAt,
  );
}

/// `GET /inbox?cursor=&limit=` — newest first.
@JsonSerializable(createToJson: false)
class InboxPage {
  const InboxPage({required this.items, required this.unreadCount, this.nextCursor});

  factory InboxPage.fromJson(Map<String, dynamic> json) => _$InboxPageFromJson(json);

  @JsonKey(defaultValue: <InboxItem>[])
  final List<InboxItem> items;

  /// Pass as `cursor` for the next page; null on the last one.
  final String? nextCursor;
  @JsonKey(defaultValue: 0)
  final int unreadCount;
}

/// `GET /inbox/unread-count` — the badge on the bell and on the profile.
@JsonSerializable(createToJson: false)
class InboxUnreadCount {
  const InboxUnreadCount({required this.count});

  factory InboxUnreadCount.fromJson(Map<String, dynamic> json) => _$InboxUnreadCountFromJson(json);

  final int count;
}
