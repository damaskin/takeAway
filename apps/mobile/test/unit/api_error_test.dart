import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/network/api_error.dart';
import 'package:takeaway_mobile/features/auth/auth_service.dart';

void main() {
  group('decodeTelegramAuthResult', () {
    String encode(Map<String, Object?> payload) =>
        base64Url.encode(utf8.encode(jsonEncode(payload))).replaceAll('=', '');

    test('decodes Telegram’s unpadded base64 payload and keeps only the whitelisted fields', () {
      final payload = decodeTelegramAuthResult(
        encode({
          'id': 123456789,
          'first_name': 'Иван',
          'last_name': 'Д.',
          'username': 'ivan',
          'photo_url': 'https://t.me/i/userpic/320/x.jpg',
          'auth_date': 1790000000,
          'hash': 'abc123',
          'unexpected': 'dropped',
        }),
      );

      expect(payload, isNotNull);
      expect(payload!['id'], 123456789);
      expect(payload['first_name'], 'Иван');
      expect(payload.containsKey('unexpected'), isFalse, reason: 'the API rejects unknown properties');
    });

    test('accepts standard base64 as well', () {
      final raw = base64.encode(utf8.encode(jsonEncode({'id': 1, 'first_name': 'A', 'auth_date': 2, 'hash': 'h'})));
      expect(decodeTelegramAuthResult(raw), isNotNull);
    });

    test('treats a declined or damaged result as no sign-in', () {
      expect(decodeTelegramAuthResult(null), isNull);
      expect(decodeTelegramAuthResult('false'), isNull);
      expect(decodeTelegramAuthResult('%%%'), isNull);
      expect(decodeTelegramAuthResult(encode({'first_name': 'no id'})), isNull);
    });
  });

  group('ApiError', () {
    DioException response(int status, Object? data) => DioException(
      requestOptions: RequestOptions(path: '/x'),
      response: Response<Object?>(
        requestOptions: RequestOptions(path: '/x'),
        statusCode: status,
        data: data,
      ),
      type: DioExceptionType.badResponse,
    );

    test('keeps the server message', () {
      final e = ApiError.from(response(400, {'message': 'Store is closed', 'statusCode': 400}));
      expect(e.kind, ApiErrorKind.rejected);
      expect(e.message, 'Store is closed');
    });

    test('joins validation messages', () {
      final e = ApiError.from(
        response(400, {
          'message': ['phone must be E.164', 'name too long'],
        }),
      );
      expect(e.message, 'phone must be E.164\nname too long');
    });

    test('classifies transport failures as network', () {
      final e = ApiError.from(
        DioException(
          requestOptions: RequestOptions(path: '/x'),
          type: DioExceptionType.connectionTimeout,
        ),
      );
      expect(e.isNetwork, isTrue);
    });

    test('maps status codes to kinds', () {
      expect(ApiError.from(response(401, null)).kind, ApiErrorKind.unauthorized);
      expect(ApiError.from(response(404, null)).kind, ApiErrorKind.notFound);
      expect(ApiError.from(response(429, null)).kind, ApiErrorKind.rateLimited);
      expect(ApiError.from(response(502, null)).kind, ApiErrorKind.server);
    });
  });
}
