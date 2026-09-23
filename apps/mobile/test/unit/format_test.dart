import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/format/money.dart';
import 'package:takeaway_mobile/core/format/time.dart';

void main() {
  group('Money.format', () {
    test('drops the cents on whole amounts and keeps them otherwise', () {
      expect(Money.format(2500, 'USD'), r'$25');
      expect(Money.format(450, 'USD'), r'$4.50');
    });

    test('writes currencies without a common sign as a code after the number', () {
      expect(Money.format(2200, 'MDL'), '22 MDL');
      expect(Money.format(1250, 'AED'), '12.50 AED');
    });

    test('follows Russian number formatting and sign placement', () {
      expect(Money.format(450, 'USD', locale: 'ru'), '4,50 \$');
      expect(Money.format(123456, 'MDL', locale: 'ru'), '1 234,56 MDL');
    });

    test('spells the Transnistrian rouble the local way in Russian', () {
      expect(Money.format(3300, 'RUP', locale: 'ru'), '33 руб.');
      expect(Money.format(3300, 'RUP'), '33 RUP');
    });

    test('marks negative amounts with a real minus sign', () {
      expect(Money.format(-500, 'GBP'), '−£5');
    });
  });

  group('time helpers', () {
    test('formats a countdown as m:ss and never goes negative', () {
      expect(formatCountdown(const Duration(minutes: 7, seconds: 5)), '7:05');
      expect(formatCountdown(const Duration(seconds: -10)), '0:00');
    });

    test('rounds minutes up and never shows zero', () {
      expect(minutesCeil(61), 2);
      expect(minutesCeil(0), 1);
    });

    test('formats distances for both languages', () {
      expect(formatDistance(850), '850 m');
      expect(formatDistance(1234), '1.2 km');
      expect(formatDistance(1234, locale: 'ru'), '1,2 км');
      expect(formatDistance(15200), '15 km');
    });
  });
}
