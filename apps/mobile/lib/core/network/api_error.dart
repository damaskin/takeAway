import 'package:dio/dio.dart';

enum ApiErrorKind { network, unauthorized, notFound, conflict, rateLimited, rejected, server, unknown }

/// A failed API call, reduced to what the UI needs: a kind to branch on and,
/// when the server gave one, its human-readable message.
class ApiError implements Exception {
  const ApiError(this.kind, {this.message, this.statusCode});

  /// Normalises anything thrown by the data layer.
  factory ApiError.from(Object error) {
    if (error is ApiError) return error;
    if (error is! DioException) return const ApiError(ApiErrorKind.unknown);

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.connectionError:
      case DioExceptionType.transformTimeout:
        return const ApiError(ApiErrorKind.network);
      case DioExceptionType.cancel:
        return const ApiError(ApiErrorKind.unknown);
      case DioExceptionType.badCertificate:
      case DioExceptionType.badResponse:
      case DioExceptionType.unknown:
        break;
    }

    final status = error.response?.statusCode;
    final message = _serverMessage(error.response?.data);
    if (status == null) {
      return ApiError(error.error is Exception ? ApiErrorKind.network : ApiErrorKind.unknown, message: message);
    }
    final kind = switch (status) {
      401 || 403 => ApiErrorKind.unauthorized,
      404 => ApiErrorKind.notFound,
      409 => ApiErrorKind.conflict,
      429 => ApiErrorKind.rateLimited,
      >= 500 => ApiErrorKind.server,
      >= 400 => ApiErrorKind.rejected,
      _ => ApiErrorKind.unknown,
    };
    return ApiError(kind, message: message, statusCode: status);
  }

  final ApiErrorKind kind;

  /// NestJS puts the reason in `message` — a string, or a list of
  /// validation messages.
  final String? message;
  final int? statusCode;

  bool get isNetwork => kind == ApiErrorKind.network;

  static String? _serverMessage(Object? data) {
    if (data is Map) {
      final raw = data['message'];
      if (raw is String && raw.trim().isNotEmpty) return raw.trim();
      if (raw is List) {
        final parts = raw.whereType<String>().where((s) => s.trim().isNotEmpty).toList();
        if (parts.isNotEmpty) return parts.join('\n');
      }
    }
    return null;
  }

  @override
  String toString() => 'ApiError($kind, $statusCode, $message)';
}
