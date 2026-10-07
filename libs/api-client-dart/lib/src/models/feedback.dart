import 'package:json_annotation/json_annotation.dart';

part 'feedback.g.dart';

/// What the customer is writing about in «Обратная связь».
@JsonEnum(alwaysCreate: true)
enum FeedbackKind {
  @JsonValue('REVIEW')
  review,
  @JsonValue('SUGGESTION')
  suggestion,
  @JsonValue('PROBLEM')
  problem,
}

/// Which client the feedback was written in.
@JsonEnum(alwaysCreate: true)
enum FeedbackSource {
  @JsonValue('IOS')
  ios,
  @JsonValue('ANDROID')
  android,
  @JsonValue('WEB')
  web,
  @JsonValue('TMA')
  tma,
}

/// Longest message the API accepts, after trimming (`FEEDBACK_MESSAGE_MAX_LENGTH`).
const feedbackMessageMaxLength = 2000;

/// Longest "how to reach me" the API accepts, after trimming.
const feedbackContactMaxLength = 200;

/// Body of `POST /feedback`. Signed-in accounts only; more than five in an
/// hour answers 429 `FEEDBACK_TOO_MANY`.
@JsonSerializable(createFactory: false)
class CreateFeedbackRequest {
  const CreateFeedbackRequest({
    required this.kind,
    required this.message,
    required this.source,
    this.contact,
    this.appVersion,
  });

  final FeedbackKind kind;
  final String message;
  final FeedbackSource source;

  /// How to reach the customer, when it is not the account's own contacts.
  @JsonKey(includeIfNull: false)
  final String? contact;

  /// The app build, e.g. `1.2.0 (3)`.
  @JsonKey(includeIfNull: false)
  final String? appVersion;

  Map<String, dynamic> toJson() => _$CreateFeedbackRequestToJson(this);
}

/// What `POST /feedback` answers with.
@JsonSerializable(createToJson: false)
class FeedbackReceipt {
  const FeedbackReceipt({required this.id, required this.createdAt});

  factory FeedbackReceipt.fromJson(Map<String, dynamic> json) => _$FeedbackReceiptFromJson(json);

  final String id;
  final DateTime createdAt;
}
