import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/features/menu/quick_add.dart';
import 'package:takeaway_mobile/features/product/catalog_options.dart';
import 'package:takeaway_mobile/features/product/product_options.dart';
import 'package:takeaway_mobile/l10n/app_localizations.dart';
import 'package:takeaway_mobile/shared/checkout_errors.dart';

import '../helpers/catalog_fixtures.dart';

void main() {
  final ru = lookupAppLocalizations(const Locale('ru'));
  final coffee = orderOptionGroups(cappuccino().optionGroups);

  group('quick add', () {
    test('opens a catalog product whose defaults are not a choice, adds one whose defaults are', () {
      expect(needsChoosing(cappuccino()), isTrue, reason: 'no size by default');
      expect(needsChoosing(shawarma()), isFalse, reason: 'chicken and one portion by default');
    });
  });

  group('options summary', () {
    final lines = optionLinesFor(coffee, cappuccinoExample);

    test('reads catalog lines as the kitchen does, without the product details', () {
      expect(optionsSummary(null, const [], const {}, optionLines: lines), cappuccinoExampleText);
      expect(optionsSummary(cappuccino(), const [], const {}, optionLines: lines), cappuccinoExampleText);
      expect(optionsSummary(null, const [], const {}), '');
    });
  });

  group('a fresher copy of the product', () {
    ProductDetail runOut(Set<String> ids) => ProductDetail.fromJson({
      ...cappuccino().toJson(),
      'optionGroups': [
        for (final group in cappuccinoGroups)
          {
            ...group,
            'options': [
              for (final option in group['options'] as List<Map<String, dynamic>>)
                {...option, if (ids.contains(option['id'])) 'available': false},
            ],
          },
      ],
    });

    test('keeps the choice as it was where everything is still there', () {
      expect(keepOfferedPicks(coffee, cappuccinoExample), cappuccinoExample);
    });

    test('starts a group over from its default when its pick ran out, keeps the rest of a list', () {
      final groups = orderOptionGroups(runOut({'o_oat', 'o_vanilla'}).optionGroups);
      expect(keepOfferedPicks(groups, cappuccinoExample), {
        'o_m': 1,
        'o_hot': 1,
        'o_cow': 1,
        'o_salted': 1,
        'o_sugar': 2,
      });
    });

    test('leaves a required variant with nothing to fall back to unpicked', () {
      final groups = orderOptionGroups(runOut({'o_m'}).optionGroups);
      final picks = keepOfferedPicks(groups, cappuccinoExample);
      expect(picks.containsKey('o_m'), isFalse);
      expect(missingOptionGroups(validateOptionPicks(groups, picks)), {'g_size'});
    });
  });

  group('what the add button says', () {
    test('names the groups still to choose', () {
      final errors = validateOptionPicks(coffee, defaultOptionPicks(coffee));
      expect(optionsHint(ru, coffee, errors), 'Выберите: Размер (кофе)');
      expect(missingOptionGroups(errors), {'g_size'});
      expect(optionsHint(ru, coffee, const []), isNull);
    });

    test('names what has run out when the dish cannot be made without it', () {
      final groups = orderOptionGroups(
        ProductDetail.fromJson({
          ...shawarma().toJson(),
          'optionGroups': [
            shawarmaGroups.first,
            groupJson('g_meat', 'Мясо (порции)', [
              optionJson(
                'o_meat',
                'Мясо / котлета',
                minQty: 1,
                maxQty: 2,
                defaultQty: 1,
                price: 2500,
                available: false,
              ),
            ], type: 'C'),
          ],
        }).optionGroups,
      );
      final errors = validateOptionPicks(groups, defaultOptionPicks(groups));
      expect(optionsHint(ru, groups, errors), 'Нет в наличии: Мясо / котлета');
    });

    test('falls back to a plain word for anything else', () {
      expect(
        optionsHint(ru, coffee, const [OptionPickError(OptionPickErrorCode.tooMany, groupId: 'g_syrups')]),
        'Проверьте выбор',
      );
    });
  });

  group('the cart refusing a choice', () {
    OptionsErrorBody body(String code, [String? reason]) => OptionsErrorBody.tryParse({
      'code': code,
      'errors': [
        if (reason != null) {'code': reason, 'groupId': 'g', 'optionId': 'o'},
      ],
    })!;

    test('is worded by its first reason', () {
      expect(optionsErrorText(ru, body('OPTIONS_REQUIRED')), 'Выберите варианты на странице позиции');
      expect(
        optionsErrorText(ru, body('OPTIONS_INVALID', 'OPTION_UNAVAILABLE')),
        'Что-то из выбранного только что закончилось — выберите другое',
      );
      expect(optionsErrorText(ru, body('OPTIONS_INVALID', 'TOO_FEW')), 'Выберите всё, что нужно для этой позиции');
      expect(optionsErrorText(ru, body('OPTIONS_INVALID', 'TOO_MANY')), 'Слишком много добавок — уберите лишнее');
      for (final reason in ['UNKNOWN_OPTION', 'HIDDEN_GROUP', 'BAD_QTY', 'NEW_REASON', null]) {
        expect(
          optionsErrorText(ru, body('OPTIONS_INVALID', reason)),
          'Меню изменилось — откройте позицию и выберите заново',
        );
      }
    });
  });
}
