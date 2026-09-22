import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/network/api_error.dart';

void main() {
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
