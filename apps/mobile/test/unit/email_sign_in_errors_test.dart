import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/network/api_error.dart';
import 'package:takeaway_mobile/l10n/app_localizations.dart';
import 'package:takeaway_mobile/shared/email_sign_in_errors.dart';

void main() {
  final ru = lookupAppLocalizations(const Locale('ru'));

  ApiError refusal(int status, Map<String, Object?> body) => ApiError.from(
    DioException(
      requestOptions: RequestOptions(path: '/auth/email/start'),
      response: Response<Object?>(
        requestOptions: RequestOptions(path: '/auth/email/start'),
        statusCode: status,
        data: {'statusCode': status, ...body},
      ),
      type: DioExceptionType.badResponse,
    ),
  );

  test('words the hourly limit in whole minutes', () {
    expect(
      emailSignInErrorText(ru, refusal(429, {'code': 'EMAIL_CODE_LIMIT', 'retryAfterSeconds': 1500})),
      'На этот адрес отправлено слишком много кодов. Попробуйте через 25 мин.',
    );
  });

  test('explains why the address a customer signs in with cannot simply be replaced', () {
    expect(
      emailSignInErrorText(ru, refusal(409, {'code': 'EMAIL_IS_SIGN_IN_METHOD'})),
      startsWith('Вы входите по коду на эту почту.'),
    );
  });

  test('leaves other refusals to the general wording', () {
    expect(emailSignInErrorText(ru, refusal(429, const {})), isNull);
    expect(emailSignInErrorText(ru, refusal(400, {'code': 'PROMO_EXPIRED'})), isNull);
  });
}
