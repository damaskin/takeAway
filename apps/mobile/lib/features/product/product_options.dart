import 'package:takeaway_api/takeaway_api.dart';

/// Order of the single-choice groups on the product screen and in option
/// summaries: size first, as the API's order snapshot has them.
const variationOrder = [
  VariationType.size,
  VariationType.temperature,
  VariationType.milk,
  VariationType.cup,
  VariationType.unknown,
];

/// [product]'s variations of [type], in menu order.
List<Variation> variationsOf(ProductDetail product, VariationType type) =>
    product.variations.where((v) => v.type == type).toList()..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

/// Add-ons that share a display group — «Сиропы», «Соусы», «Убрать».
class AddonGroup {
  const AddonGroup({required this.name, required this.modifiers});

  /// The group as the menu names it; null for the generic «Добавки».
  final String? name;

  /// In menu order.
  final List<Modifier> modifiers;

  /// Stable id of the group on the screen.
  String get key => name ?? '';

  /// Something in it has to be taken (`minCount` ≥ 1): the screen opens the
  /// group and marks it «обязательно».
  bool get isRequired => modifiers.any((m) => m.minCount > 0);
}

/// [product]'s add-ons by display group, groups in the order their first
/// add-on comes in the menu. Add-ons without a group share one.
List<AddonGroup> addonGroups(ProductDetail product) {
  final sorted = [...product.modifiers]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
  final groups = <String, List<Modifier>>{};
  final names = <String, String?>{};
  for (final m in sorted) {
    final name = m.group;
    final key = name ?? '';
    groups.putIfAbsent(key, () => []).add(m);
    names.putIfAbsent(key, () => name);
  }
  return [for (final entry in groups.entries) AddonGroup(name: names[entry.key], modifiers: entry.value)];
}

/// What is taken from [group] — "Ваниль, 2× Карамель"; empty when nothing.
String addonGroupSummary(AddonGroup group, Map<String, int> counts) => [
  for (final m in group.modifiers)
    if ((counts[m.id] ?? 0) > 0) _counted(m, counts[m.id]!),
].join(', ');

/// Human summary of the chosen options — "Large · Oat milk · 2× Shot", size
/// first. Names come from the product details (carts and orders store only
/// ids), so it is empty until they arrive.
///
/// [onlyChoices] leaves out a variation that is the only one of its type —
/// the product screen does not repeat what the customer could not choose.
String optionsSummary(
  ProductDetail? product,
  Iterable<String> variationIds,
  Map<String, int> modifiers, {
  bool onlyChoices = false,
}) {
  if (product == null) return '';
  final chosen = variationIds.toSet();
  final parts = <String>[
    for (final type in variationOrder)
      for (final group in [variationsOf(product, type)])
        if (!onlyChoices || group.length > 1)
          for (final v in group)
            if (chosen.contains(v.id)) v.name,
    for (final m in [...product.modifiers]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder)))
      if ((modifiers[m.id] ?? 0) > 0) _counted(m, modifiers[m.id]!),
  ];
  return parts.join(' · ');
}

String _counted(Modifier m, int count) => count > 1 ? '$count× ${m.name}' : m.name;
