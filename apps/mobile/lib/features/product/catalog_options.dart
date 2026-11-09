import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/quantity_stepper.dart';
import 'option_widgets.dart';

/// One group of the options catalog («Добавки и варианты») on the product
/// screen: its name, what it allows, and one row per option — a round mark
/// for a one-of list (A, max 1), a checkbox for a several-of list (A, max >
/// 1, the rest greyed once the maximum is picked), a switch (B) or a −/+
/// counter (C). Every row shows its note and its price: what an add-on costs,
/// what a variant adds or takes off, what one more unit costs and how many
/// the price includes. An option the store has run out of is greyed with
/// «Нет в наличии» and cannot be picked.
///
/// The rules — what a tap does, the bounds — are the API's own
/// (`toggleOptionPick`, `setOptionQty` in `takeaway_api`); the screen holds
/// the picks.
class OptionGroupSection extends StatelessWidget {
  const OptionGroupSection({
    required this.group,
    required this.picks,
    required this.currency,
    required this.missing,
    required this.onToggle,
    required this.onQty,
    super.key,
  });

  final ProductOptionGroup group;
  final OptionPicks picks;
  final String currency;

  /// The group still needs a pick: marked «обязательно» until it has one.
  final bool missing;
  final ValueChanged<String> onToggle;
  final void Function(String optionId, int qty) onQty;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final rule = _rule(l10n);
    // A several-of list that has its maximum takes no more; a one-of list
    // moves its pick instead.
    final max = selectBounds(group).max;
    final picked = group.options.where((o) => (picks[o.id] ?? 0) > 0).length;
    final full = group.type == OptionGroupType.a && max > 1 && picked >= max;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 20, bottom: 10),
          child: Row(
            children: [
              Expanded(
                child: Wrap(
                  spacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(group.name, style: context.text.titleMedium),
                    if (rule != null) Text(rule, style: context.text.bodySmall?.copyWith(color: brand.textTertiary)),
                  ],
                ),
              ),
              AnimatedSwitcher(
                duration: Motion.medium,
                child: missing ? RequiredBadge(label: l10n.productRequired) : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
        // A Material of its own, so a row's ripple shows on the card.
        Material(
          color: brand.foam,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.input),
            side: BorderSide(color: missing ? brand.caramel.withValues(alpha: 0.45) : brand.borderLight),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (index, option) in group.options.indexed) ...[
                if (index > 0) Divider(height: 1, indent: 14, color: brand.borderLight),
                _OptionRow(
                  key: ValueKey('option-${option.id}'),
                  group: group,
                  option: option,
                  qty: picks[option.id] ?? 0,
                  currency: currency,
                  blocked: full && (picks[option.id] ?? 0) == 0,
                  onToggle: () => onToggle(option.id),
                  onQty: (qty) => onQty(option.id, qty),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  /// «до 2» / «от 1 до 2» beside a several-of list; nothing for the rest,
  /// whose control says it.
  String? _rule(AppLocalizations l10n) {
    if (group.type != OptionGroupType.a) return null;
    final bounds = selectBounds(group);
    if (bounds.max <= 1) return null;
    return bounds.min > 0 ? l10n.optionPickRange(bounds.min, bounds.max) : l10n.productAddonLimit(bounds.max);
  }
}

class _OptionRow extends StatelessWidget {
  const _OptionRow({
    required this.group,
    required this.option,
    required this.qty,
    required this.currency,
    required this.blocked,
    required this.onToggle,
    required this.onQty,
    super.key,
  });

  final ProductOptionGroup group;
  final ProductOptionItem option;
  final int qty;
  final String currency;

  /// A several-of list is full: this unpicked option cannot be added.
  final bool blocked;
  final VoidCallback onToggle;
  final ValueChanged<int> onQty;

  bool get _counter => group.type == OptionGroupType.c;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final on = qty > 0;
    final out = !option.available;
    // An option that ran out can still be switched off, never on.
    final enabled = _counter || on || (!out && !blocked);
    final free = freeQty(group, option);
    final price = priceDelta(context, option.priceCents, currency);
    final details = [
      ?option.note,
      if (out) l10n.optionUnavailable,
      if (_counter && free > 0) l10n.optionIncluded(free),
      if (_counter && price.isNotEmpty) l10n.optionPerUnit(price),
    ];
    final dim = out || blocked;

    final texts = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(option.name, style: context.text.bodyLarge?.copyWith(color: dim ? brand.textTertiary : null)),
        if (details.isNotEmpty)
          Text(
            details.join(' · '),
            style: context.text.bodySmall?.copyWith(color: out ? brand.berry : brand.textSecondary),
          ),
      ],
    );

    final row = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 52),
      child: Padding(
        padding: EdgeInsets.fromLTRB(14, 4, _counter ? 8 : 6, 4),
        child: Row(
          children: [
            Expanded(child: texts),
            if (!_counter && price.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(left: 8, right: 4),
                child: Text(
                  price,
                  style: context.text.bodyMedium?.copyWith(
                    color: on ? brand.textPrimary : brand.textSecondary,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            _control(context, enabled),
          ],
        ),
      ),
    );

    if (_counter) {
      return Semantics(
        container: true,
        label: [option.name, ...details].join(', '),
        child: Opacity(opacity: out && !on ? 0.6 : 1, child: row),
      );
    }

    void tap() {
      HapticFeedback.selectionClick();
      onToggle();
    }

    // The whole row picks, not just the mark.
    return MergeSemantics(
      child: Semantics(
        inMutuallyExclusiveGroup: _oneOf,
        child: InkWell(onTap: enabled ? tap : null, child: row),
      ),
    );
  }

  bool get _oneOf => group.type == OptionGroupType.a && selectBounds(group).max == 1;

  Widget _control(BuildContext context, bool enabled) {
    final brand = context.brand;
    final on = qty > 0;
    switch (group.type) {
      case OptionGroupType.c:
        final bounds = qtyBounds(option);
        return QuantityStepper(
          value: qty,
          min: bounds.min,
          // Nothing more of what has run out.
          max: option.available ? bounds.max : qty,
          compact: true,
          buttonSize: 44,
          onChanged: onQty,
        );
      case OptionGroupType.b:
        return Switch.adaptive(value: on, onChanged: enabled ? (_) => onToggle() : null);
      case OptionGroupType.a when _oneOf:
        return Semantics(
          checked: on,
          child: SizedBox.square(
            dimension: 44,
            child: Icon(
              on ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded,
              color: on
                  ? brand.caramel
                  : enabled
                  ? brand.textTertiary
                  : brand.border,
            ),
          ),
        );
      case OptionGroupType.a || OptionGroupType.d || OptionGroupType.unknown:
        return Checkbox(value: on, activeColor: brand.caramel, onChanged: enabled ? (_) => onToggle() : null);
    }
  }
}

/// What keeps the choice out of the cart, said by the add button: the groups
/// still to choose («Выберите: Размер (кофе)»), else what has run out, else
/// a plain «Проверьте выбор». Null when the choice can go in.
String? optionsHint(AppLocalizations l10n, List<ProductOptionGroup> groups, List<OptionPickError> errors) {
  if (errors.isEmpty) return null;
  String? groupName(String? id) => groups.where((g) => g.id == id).firstOrNull?.name;
  String? optionName(String? id) => groups.expand((g) => g.options).where((o) => o.id == id).firstOrNull?.name;
  final missing = {
    for (final error in errors)
      if (error.code == OptionPickErrorCode.tooFew) ?groupName(error.groupId),
  };
  if (missing.isNotEmpty) return l10n.optionsChoose(missing.join(', '));
  final out = {
    for (final error in errors)
      if (error.code == OptionPickErrorCode.optionUnavailable) ?optionName(error.optionId),
  };
  if (out.isNotEmpty) return l10n.optionsOutOfStock(out.join(', '));
  return l10n.optionsCheck;
}

/// Groups that still need a pick (a variant not chosen): marked on screen.
Set<String> missingOptionGroups(List<OptionPickError> errors) => {
  for (final error in errors)
    if (error.code == OptionPickErrorCode.tooFew) ?error.groupId,
};
