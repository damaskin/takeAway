import 'package:intl/intl.dart';

/// Price formatting. All amounts travel as integer minor units (cents) with
/// an explicit ISO-style currency code, exactly as the API sends them.
///
/// Whole amounts drop the `.00` (a latte is "25 MDL", not "25.00 MDL");
/// fractional ones keep two digits. Symbol placement follows the locale:
/// English puts a sign in front ("$4.50"), Russian after ("4,50 $"), and
/// currencies without a widely known sign are written as a code after the
/// number in both.
abstract final class Money {
  static const _prefixSigns = {'USD': r'$', 'EUR': '€', 'GBP': '£', 'THB': '฿', 'IDR': 'Rp'};

  /// Codes spelled out after the number. The Transnistrian rouble has no ISO
  /// code; locally it is written "руб.".
  static const _suffixCodes = {'AED': 'AED', 'MDL': 'MDL', 'RUP': 'RUP'};
  static const _suffixCodesRu = {'RUP': 'руб.'};

  static String format(int cents, String currency, {String locale = 'en'}) {
    final negative = cents < 0;
    final abs = cents.abs();
    final digits = abs % 100 == 0 ? 0 : 2;
    final number = NumberFormat.decimalPatternDigits(locale: locale, decimalDigits: digits).format(abs / 100);
    final isRussian = locale.toLowerCase().startsWith('ru');
    final code = currency.toUpperCase();

    final String body;
    final prefix = _prefixSigns[code];
    if (prefix != null && !isRussian) {
      body = '$prefix$number';
    } else if (prefix != null) {
      body = '$number $prefix';
    } else {
      final label = (isRussian ? _suffixCodesRu[code] : null) ?? _suffixCodes[code] ?? code;
      body = '$number $label';
    }
    return negative ? '−$body' : body;
  }
}
