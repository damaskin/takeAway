import 'dart:math' as math;

import 'models/options.dart';

// The rules of the options catalog («Добавки и варианты», item 17), ported
// from `libs/utils/src/lib/option-groups.ts`, case for case (the tests port
// its spec). The API re-checks and re-prices every line; the product screen
// prices the choice live with the same rules, so the price on the card, in
// the cart and on the order cannot drift apart.

/// A choice: option id → how many (1 for A and B). An option that is not in
/// the map, or is at 0, is not taken.
typedef OptionPicks = Map<String, int>;

/// The order a product page asks in: variants first, then add-ons, each kind
/// in the order given.
List<ProductOptionGroup> orderOptionGroups(List<ProductOptionGroup> groups) => [
  ...groups.where((g) => g.kind == OptionGroupKind.variant),
  ...groups.where((g) => g.kind != OptionGroupKind.variant),
];

/// The fewest and most options of an A group that may be picked.
({int min, int max}) selectBounds(ProductOptionGroup group) {
  final max = math.max(1, group.maxSelect ?? group.options.length);
  final min = math.max(group.kind == OptionGroupKind.variant ? 1 : 0, group.minSelect ?? 0);
  return (min: math.min(min, max), max: max);
}

/// The bounds of a C option's counter.
({int min, int max}) qtyBounds(ProductOptionItem option) {
  final min = math.max(0, option.minQty ?? 0);
  return (min: min, max: math.max(min, math.min(option.maxQty ?? optionMaxQtyLimit, optionMaxQtyLimit)));
}

/// How many units of a C option the base price already includes (the meat in
/// a shawarma).
int freeQty(ProductOptionGroup group, ProductOptionItem option) =>
    group.type == OptionGroupType.c ? math.max(0, option.defaultQty ?? 0) : 0;

/// Whether a group is shown for this choice: always without a condition, and
/// always when the condition's option is not on the product (a cola has no
/// «Подача», so its «Лёд» is always there); otherwise only while that option
/// is picked and its own group is shown.
bool isGroupVisible(ProductOptionGroup group, List<ProductOptionGroup> groups, Map<String, num> picks) =>
    _isVisible(group, groups, picks, <String>{});

bool _isVisible(ProductOptionGroup group, List<ProductOptionGroup> groups, Map<String, num> picks, Set<String> seen) {
  final condition = group.showIfOptionId;
  if (condition == null || condition.isEmpty) return true;
  final owner = groups.where((g) => g.options.any((o) => o.id == condition)).firstOrNull;
  if (owner == null) return true;
  if (seen.contains(group.id)) return false; // a loop of conditions shows nothing
  seen.add(group.id);
  return (picks[condition] ?? 0) > 0 && _isVisible(owner, groups, picks, seen);
}

/// The groups shown for this choice, in the order given.
List<ProductOptionGroup> visibleOptionGroups(List<ProductOptionGroup> groups, Map<String, num> picks) =>
    groups.where((group) => isGroupVisible(group, groups, picks)).toList();

/// The choice with the picks of hidden groups dropped (and zeros removed) —
/// what is left after the customer switches iced back to hot.
OptionPicks normalizeOptionPicks(List<ProductOptionGroup> groups, OptionPicks picks) {
  final out = <String, int>{};
  for (final group in visibleOptionGroups(groups, picks)) {
    for (final option in group.options) {
      final qty = picks[option.id] ?? 0;
      if (qty > 0) out[option.id] = qty;
    }
  }
  // Dropping a pick can hide another group (its condition): settle again.
  return out.length == picks.values.where((qty) => qty > 0).length ? out : normalizeOptionPicks(groups, out);
}

/// What the product page starts with: every available default of A and B
/// (up to the group's maximum), every C option at its `defaultQty`, then the
/// picks of groups hidden by that choice dropped. A required variant without
/// a default stays unpicked — the customer has to choose it.
OptionPicks defaultOptionPicks(List<ProductOptionGroup> groups) {
  final picks = <String, int>{};
  for (final group in groups) {
    if (group.type == OptionGroupType.c) {
      for (final option in group.options) {
        if (!option.available) continue;
        final bounds = qtyBounds(option);
        final qty = math.min(math.max(option.defaultQty ?? 0, bounds.min), bounds.max);
        if (qty > 0) picks[option.id] = qty;
      }
      continue;
    }
    final defaults = group.options.where((o) => o.isDefault && o.available).toList();
    final limit = group.type == OptionGroupType.a ? selectBounds(group).max : defaults.length;
    for (final option in defaults.take(limit)) {
      picks[option.id] = 1;
    }
  }
  return normalizeOptionPicks(groups, picks);
}

/// The choice after a tap on an A or B option. A one-of group (max 1) moves
/// its pick there; tapping the picked option again clears it unless the group
/// needs one. A several-of group adds or removes it, and refuses one above
/// its maximum. B switches it. An unavailable option cannot be switched on.
/// Groups the change hides lose their picks.
OptionPicks toggleOptionPick(List<ProductOptionGroup> groups, OptionPicks picks, String optionId) {
  final found = _findOption(groups, optionId);
  if (found == null || found.group.type == OptionGroupType.c) return {...picks};
  final (:group, :option) = found;
  final on = (picks[optionId] ?? 0) > 0;
  final next = {...picks};
  if (on) {
    final picked = group.options.where((o) => (picks[o.id] ?? 0) > 0).length;
    final bounds = selectBounds(group);
    if (group.type == OptionGroupType.a && bounds.max == 1 && picked <= bounds.min) return next;
    next.remove(optionId);
    return normalizeOptionPicks(groups, next);
  }
  if (!option.available) return next;
  if (group.type == OptionGroupType.a) {
    final max = selectBounds(group).max;
    if (max == 1) {
      for (final other in group.options) {
        next.remove(other.id);
      }
    } else if (group.options.where((o) => (picks[o.id] ?? 0) > 0).length >= max) {
      return next;
    }
  }
  next[optionId] = 1;
  return normalizeOptionPicks(groups, next);
}

/// The choice with a C option's counter set to [qty], kept within its bounds.
OptionPicks setOptionQty(List<ProductOptionGroup> groups, OptionPicks picks, String optionId, int qty) {
  final found = _findOption(groups, optionId);
  if (found == null || found.group.type != OptionGroupType.c) return {...picks};
  final option = found.option;
  final bounds = qtyBounds(option);
  final next = {...picks};
  final wanted = math.min(math.max(qty, bounds.min), bounds.max);
  if (!option.available && wanted > (picks[optionId] ?? 0)) return next;
  if (wanted > 0) {
    next[optionId] = wanted;
  } else {
    next.remove(optionId);
  }
  return normalizeOptionPicks(groups, next);
}

/// Everything that keeps the choice out of the cart, in page order; empty
/// when it can go in. The API answers 400 with the first one. Takes any
/// numbers, as the API is sent, so a fraction reads as [OptionPickErrorCode.badQty].
List<OptionPickError> validateOptionPicks(List<ProductOptionGroup> groups, Map<String, num> picks) {
  final errors = <OptionPickError>[];
  for (final MapEntry(key: optionId, value: qty) in picks.entries) {
    if (qty == 0) continue;
    final found = _findOption(groups, optionId);
    if (found == null) {
      errors.add(OptionPickError(OptionPickErrorCode.unknownOption, optionId: optionId));
    } else if (!_isWhole(qty) || qty < 0) {
      errors.add(OptionPickError(OptionPickErrorCode.badQty, groupId: found.group.id, optionId: optionId));
    }
  }
  if (errors.isNotEmpty) return errors;

  for (final group in groups) {
    final visible = isGroupVisible(group, groups, picks);
    final picked = group.options.where((o) => (picks[o.id] ?? 0) > 0).toList();
    if (!visible) {
      if (picked.isNotEmpty) {
        errors.add(OptionPickError(OptionPickErrorCode.hiddenGroup, groupId: group.id, optionId: picked.first.id));
      }
      continue;
    }
    for (final option in picked) {
      if (!option.available) {
        errors.add(OptionPickError(OptionPickErrorCode.optionUnavailable, groupId: group.id, optionId: option.id));
      }
      if (group.type != OptionGroupType.c && picks[option.id] != 1) {
        errors.add(OptionPickError(OptionPickErrorCode.badQty, groupId: group.id, optionId: option.id));
      }
    }
    if (group.type == OptionGroupType.a) {
      final bounds = selectBounds(group);
      if (picked.length < bounds.min) errors.add(OptionPickError(OptionPickErrorCode.tooFew, groupId: group.id));
      if (picked.length > bounds.max) errors.add(OptionPickError(OptionPickErrorCode.tooMany, groupId: group.id));
    } else if (group.type == OptionGroupType.c) {
      for (final option in group.options) {
        final qty = picks[option.id] ?? 0;
        final bounds = qtyBounds(option);
        if (qty < bounds.min) {
          errors.add(
            OptionPickError(
              option.available ? OptionPickErrorCode.tooFew : OptionPickErrorCode.optionUnavailable,
              groupId: group.id,
              optionId: option.id,
            ),
          );
        }
        if (qty > bounds.max) {
          errors.add(OptionPickError(OptionPickErrorCode.tooMany, groupId: group.id, optionId: option.id));
        }
      }
    }
  }
  return errors;
}

/// The product cannot go in with one tap: what the page starts with is not a
/// valid choice (a size to pick, meat that has run out). Defaults that make a
/// valid choice do not stop a quick add.
bool needsOptionChoice(List<ProductOptionGroup> groups) =>
    validateOptionPicks(groups, defaultOptionPicks(groups)).isNotEmpty;

/// The picked options as order lines, in page order: the groups in the order
/// given, each group's options in theirs. Hidden groups and zeros are left out.
List<OptionLine> optionLinesFor(List<ProductOptionGroup> groups, OptionPicks picks) => [
  for (final group in visibleOptionGroups(groups, picks))
    for (final option in group.options)
      if ((picks[option.id] ?? 0) > 0) _line(group, option, picks[option.id]!),
];

OptionLine _line(ProductOptionGroup group, ProductOptionItem option, int qty) {
  final free = freeQty(group, option);
  return OptionLine(
    groupId: group.id,
    groupName: group.name,
    kind: group.kind,
    type: group.type,
    optionId: option.id,
    name: option.name,
    qty: qty,
    unitPriceCents: option.priceCents,
    freeQty: free,
    totalCents: group.type == OptionGroupType.c ? option.priceCents * math.max(0, qty - free) : option.priceCents,
  );
}

/// One item with this choice: the base price, plus each picked variant's and
/// A/B add-on's price, plus each C add-on's price for every unit above what
/// the base already includes.
int priceWithOptionPicks(int basePriceCents, List<ProductOptionGroup> groups, OptionPicks picks) =>
    optionLinesFor(groups, picks).fold(basePriceCents, (cents, line) => cents + line.totalCents);

/// The choice in one run of text, as the kitchen and the receipt read it:
/// the variants joined by commas, then every add-on group on its own, its
/// options joined by « + », a count after ×. A C option left at the amount
/// the dish includes (one meat portion) is not mentioned.
///
/// "M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2"
String describeOptionLines(List<OptionLine> lines) {
  final variants = [
    for (final line in lines)
      if (line.kind == OptionGroupKind.variant) _lineText(line),
  ];
  final addonGroups = <String, List<String>>{};
  for (final line in lines) {
    if (line.kind == OptionGroupKind.variant) continue;
    if (line.type == OptionGroupType.c && line.freeQty > 0 && line.qty == line.freeQty) continue;
    addonGroups.putIfAbsent(line.groupId, () => []).add(_lineText(line));
  }
  return [
    variants.join(', '),
    for (final texts in addonGroups.values) texts.join(' + '),
  ].where((part) => part.isNotEmpty).join(' · ');
}

String _lineText(OptionLine line) => line.qty > 1 ? '${line.name} ×${line.qty}' : line.name;

/// The choice as the API takes it, in a stable order (option id).
List<OptionSelection> toOptionSelections(OptionPicks picks) {
  final ids = picks.keys.where((id) => picks[id]! > 0).toList()..sort();
  return [for (final id in ids) OptionSelection(optionId: id, qty: picks[id]!)];
}

/// The choice from the API's form. Repeated options add up.
OptionPicks fromOptionSelections(Iterable<OptionSelection> selections) {
  final picks = <String, int>{};
  for (final OptionSelection(:optionId, :qty) in selections) {
    picks[optionId] = (picks[optionId] ?? 0) + qty;
  }
  return picks;
}

/// Two cart lines of one product with the same key are the same thing and
/// merge into one line; a different choice is a different line.
String optionSelectionKey(Iterable<OptionSelection> selections) =>
    toOptionSelections(fromOptionSelections(selections)).map((s) => '${s.optionId}:${s.qty}').join(',');

/// The line's options as one run of text for a receipt or an order list,
/// read from an order line's snapshot (`OrderItem.productSnapshot`) without
/// trusting its shape — the port of the web's `describeOrderItemOptions`:
/// the older options' names ("L · Oat · +Vanilla syrup ×2"), then the
/// catalog's ("M, Горячий · Овсяное"). Empty when there are none.
String describeOrderItemOptions(Map<String, Object?> snapshot) {
  final variations = _snapshotVariations(snapshot['variations']);
  final modifiers = [
    if (snapshot['modifierLines'] case final List<Object?> raw)
      for (final entry in raw)
        if (entry case {
          'id': String _,
          'name': final String name,
          'count': final num count,
        } when count.isFinite && count > 0)
          count > 1 ? '+$name ×${_number(count)}' : '+$name',
  ];
  return [
    ...variations,
    ...modifiers,
    describeOptionLines(OptionLine.listFrom(snapshot['optionLines'])),
  ].where((part) => part.isNotEmpty).join(' · ');
}

/// The order a barista reads a drink in, as the web sorts an order line's
/// variations: size, milk, temperature, cup. Other types are left out.
const _variationDisplayOrder = ['SIZE', 'MILK', 'TEMPERATURE', 'CUP'];

List<String> _snapshotVariations(Object? raw) {
  if (raw is! List) return const [];
  final known = [
    for (final entry in raw)
      if (entry case {
        'id': String _,
        'name': final String name,
        'type': final String type,
      } when _variationDisplayOrder.contains(type))
        (name: name, rank: _variationDisplayOrder.indexOf(type)),
  ];
  // A stable sort, ties kept in the order given.
  final indexed = known.indexed.toList()
    ..sort((a, b) => a.$2.rank != b.$2.rank ? a.$2.rank.compareTo(b.$2.rank) : a.$1.compareTo(b.$1));
  return [for (final (_, v) in indexed) v.name];
}

String _number(num value) => value == value.roundToDouble() ? value.toInt().toString() : value.toString();

bool _isWhole(num qty) => qty is int || (qty.isFinite && qty == qty.roundToDouble());

({ProductOptionGroup group, ProductOptionItem option})? _findOption(List<ProductOptionGroup> groups, String optionId) {
  for (final group in groups) {
    for (final option in group.options) {
      if (option.id == optionId) return (group: group, option: option);
    }
  }
  return null;
}
