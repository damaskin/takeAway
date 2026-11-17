import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/format/points.dart';
import 'package:takeaway_mobile/l10n/app_localizations.dart';

/// Points travel as integer units, a hundredth of a point each (1 point =
/// 1 руб.); the customer reads and types points.
void main() {
  test('a point is a hundred units', () {
    expect(pointUnitsPerPoint, 100);
    expect(Points.fromUnits(1240), 12.4);
    expect(Points.fromUnits(3000), 30);
    expect(Points.fromUnits(40), 0.4);
  });

  group('Points.parse', () {
    test('takes a comma or a dot, with up to two decimals', () {
      expect(Points.parse('12,4'), 1240);
      expect(Points.parse('12.40'), 1240);
      expect(Points.parse('12'), 1200);
      expect(Points.parse('0,4'), 40);
      expect(Points.parse(',5'), 50);
      expect(Points.parse('7.'), 700);
      expect(Points.parse(' 1 234,50 '), 123450, reason: 'grouping spaces, a non-breaking one too');
      expect(Points.parse('1 234'), 123400);
    });

    test('rounds a third decimal half up', () {
      expect(Points.parse('12,345'), 1235);
      expect(Points.parse('12,344'), 1234);
      expect(Points.parse('0,285'), 29, reason: 'counted in digits, not in floating point');
      expect(Points.parse('0,995'), 100);
      expect(Points.parse('1,2349'), 123);
    });

    test('reads anything that is not a non-negative number as 0', () {
      for (final raw in ['', ' ', ',', '.', 'abc', '12a', '-5', '+5', '1.2.3', '1,2.3', '1e3', '9999999999999']) {
        expect(Points.parse(raw), 0, reason: '«$raw»');
      }
    });
  });

  group('Points.format', () {
    test('whole points without decimals, anything else with two', () {
      expect(Points.format(3000), '30');
      expect(Points.format(1240), '12.40');
      expect(Points.format(40), '0.40');
      expect(Points.format(0), '0');
      expect(Points.format(1240, locale: 'ru'), '12,40');
      expect(Points.format(320, locale: 'ru'), '3,20');
    });

    test('groups thousands like money and marks a spend with a real minus', () {
      expect(Points.format(123450), '1,234.50');
      expect(Points.format(123450, locale: 'ru'), '1 234,50');
      expect(Points.format(-320, locale: 'ru'), '−3,20');
      expect(Points.format(-500), '−5');
    });

    test('keeps one shape when asked to', () {
      expect(Points.format(3000, fractional: true), '30.00');
      expect(Points.format(1249, fractional: false), '12');
      expect(Points.format(1251, locale: 'ru', fractional: false), '13');
    });
  });

  test('Points.input writes a number to edit, without grouping', () {
    expect(Points.input(123450, locale: 'ru'), '1234,50');
    expect(Points.input(123450), '1234.50');
    expect(Points.input(3000, locale: 'ru'), '30');
    expect(Points.input(40, locale: 'ru'), '0,40');
  });

  group('Points.label', () {
    final ru = lookupAppLocalizations(const Locale('ru'));
    final en = lookupAppLocalizations(const Locale('en'));

    test('declines «балл» for whole points', () {
      expect(Points.label(ru, 100), '1 балл');
      expect(Points.label(ru, 2100), '21 балл');
      expect(Points.label(ru, 300), '3 балла');
      expect(Points.label(ru, 2400), '24 балла');
      expect(Points.label(ru, 500), '5 баллов');
      expect(Points.label(ru, 1100), '11 баллов');
      expect(Points.label(ru, 1200), '12 баллов');
      expect(Points.label(ru, 3000), '30 баллов');
      expect(Points.label(ru, 0), '0 баллов');
      expect(Points.label(ru, 123400), '1 234 балла');
    });

    test('says «балла» for any fraction', () {
      expect(Points.label(ru, 1240), '12,40 балла');
      expect(Points.label(ru, 40), '0,40 балла');
      expect(Points.label(ru, 150), '1,50 балла');
      expect(Points.label(ru, 2150), '21,50 балла');
      expect(Points.label(ru, 501), '5,01 балла');
    });

    test('point / points in English', () {
      expect(Points.label(en, 100), '1 point');
      expect(Points.label(en, 3000), '30 points');
      expect(Points.label(en, 1240), '12.40 points');
      expect(Points.label(en, 101), '1.01 points');
      expect(Points.label(en, 0), '0 points');
    });

    test('drops the sign', () {
      expect(Points.label(ru, -320), '3,20 балла');
    });
  });
}
