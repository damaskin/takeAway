import 'package:intl/intl.dart';

import '../../l10n/app_localizations.dart';

/// Hundredths of a point in one point. The API keeps every points figure —
/// balance, ledger amounts, the redeem quote, `pointsToSpend` — as an integer
/// count of these units; one point is worth one major currency unit (1 point
/// = 1 руб.), so a unit is worth a cent.
const pointUnitsPerPoint = 100;

/// Loyalty points as the customer reads and types them: «12,40 балла»,
/// «30 баллов», never the raw units the API counts in.
abstract final class Points {
  static final _input = RegExp(r'^(\d*)(?:[.,](\d*))?$');
  static final _spaces = RegExp(r'\s');

  /// [units] as a number of points: 1240 → 12.4.
  static double fromUnits(int units) => units / pointUnitsPerPoint;

  /// What the customer typed, in units: «12,4», «12.40» → 1240, «12» →
  /// 1200; a third decimal rounds half up («0,285» → 29). Anything that is
  /// not a non-negative number (empty, letters, a minus, two separators) is
  /// 0. Spaces are ignored, so a grouped «1 234,50» reads too.
  static int parse(String raw) {
    final match = _input.firstMatch(raw.replaceAll(_spaces, ''));
    if (match == null) return 0;
    final whole = match.group(1)!;
    final fraction = match.group(2) ?? '';
    // Twelve digits of points is past any balance; it is not a number here.
    if ((whole.isEmpty && fraction.isEmpty) || whole.length > 12) return 0;
    final digits = fraction.padRight(3, '0');
    final units = (whole.isEmpty ? 0 : int.parse(whole)) * pointUnitsPerPoint + int.parse(digits.substring(0, 2));
    return digits.codeUnitAt(2) >= 0x35 ? units + 1 : units;
  }

  /// [units] as a points number for [locale]: whole points without decimals
  /// («30»), anything else with two («12,40», «0.40»), grouped like money
  /// («1 234,50») and with a real minus sign when negative. [fractional]
  /// forces the two decimals on (true) or rounds to whole points (false) —
  /// for a number counting up to a balance, which must not change its shape
  /// on the way.
  static String format(int units, {String locale = 'en', bool? fractional}) {
    final abs = units.abs();
    final digits = (fractional ?? abs % pointUnitsPerPoint != 0) ? 2 : 0;
    final number = NumberFormat.decimalPatternDigits(locale: locale, decimalDigits: digits).format(fromUnits(abs));
    return units < 0 ? '−$number' : number;
  }

  /// [units] for an input field: like [format], without the grouping.
  static String input(int units, {String locale = 'en'}) {
    final abs = units.abs();
    if (abs % pointUnitsPerPoint == 0) return '${abs ~/ pointUnitsPerPoint}';
    final separator = NumberFormat.decimalPattern(locale).symbols.DECIMAL_SEP;
    return fromUnits(abs).toStringAsFixed(2).replaceFirst('.', separator);
  }

  /// [units] with the noun in the app language: «1 балл», «3 балла»,
  /// «30 баллов», «12,40 балла» (any fraction takes «балла»); "1 point",
  /// "12.40 points". The sign is dropped — the caller words a spend.
  static String label(AppLocalizations l10n, int units) =>
      l10n.pointsCount(fromUnits(units.abs()), format(units.abs(), locale: l10n.localeName));
}
