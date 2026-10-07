// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'feedback.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Map<String, dynamic> _$CreateFeedbackRequestToJson(CreateFeedbackRequest instance) => <String, dynamic>{
  'kind': _$FeedbackKindEnumMap[instance.kind]!,
  'message': instance.message,
  'source': _$FeedbackSourceEnumMap[instance.source]!,
  'contact': ?instance.contact,
  'appVersion': ?instance.appVersion,
};

const _$FeedbackKindEnumMap = {
  FeedbackKind.review: 'REVIEW',
  FeedbackKind.suggestion: 'SUGGESTION',
  FeedbackKind.problem: 'PROBLEM',
};

const _$FeedbackSourceEnumMap = {
  FeedbackSource.ios: 'IOS',
  FeedbackSource.android: 'ANDROID',
  FeedbackSource.web: 'WEB',
  FeedbackSource.tma: 'TMA',
};

FeedbackReceipt _$FeedbackReceiptFromJson(Map<String, dynamic> json) =>
    FeedbackReceipt(id: json['id'] as String, createdAt: DateTime.parse(json['createdAt'] as String));
