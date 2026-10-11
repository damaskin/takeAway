import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/quantity_stepper.dart';
import 'product_options.dart';

/// "+3 руб." / "−3 руб." for a price change; empty for none.
String priceDelta(BuildContext context, int cents, String currency) {
  if (cents == 0) return '';
  return '${cents > 0 ? '+' : '−'}${context.money(cents.abs(), currency)}';
}

/// A single-choice option group — size, milk, temperature, cup: its title
/// and one compact chip per option, wrapping onto a second line when they do
/// not fit. Each chip shows its price change.
class VariationChips extends StatelessWidget {
  const VariationChips({
    required this.title,
    required this.options,
    required this.selected,
    required this.currency,
    required this.onSelect,
    super.key,
  });

  final String title;
  final List<Variation> options;
  final String? selected;
  final String currency;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        OptionsTitle(title),
        Wrap(
          spacing: 6,
          runSpacing: 8,
          children: [
            for (final v in options)
              _Chip(
                label: v.name,
                delta: priceDelta(context, v.priceDeltaCents, currency),
                active: v.id == selected,
                onTap: () => onSelect(v.id),
              ),
          ],
        ),
      ],
    );
  }
}

class OptionsTitle extends StatelessWidget {
  const OptionsTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 10),
    child: Text(text, style: context.text.titleMedium),
  );
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.delta, required this.active, required this.onTap});

  final String label;
  final String delta;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    const on = Colors.white;
    return MergeSemantics(
      child: Semantics(
        selected: active,
        inMutuallyExclusiveGroup: true,
        child: Pressable(
          onTap: onTap,
          scale: 0.95,
          child: AnimatedContainer(
            duration: Motion.medium,
            curve: Motion.emphasized,
            constraints: const BoxConstraints(minHeight: 44, minWidth: 56),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: active ? brand.caramel : brand.foam,
              borderRadius: BorderRadius.circular(Radii.pill),
              border: Border.all(color: active ? brand.caramel : brand.border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Flexible(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: context.text.labelLarge?.copyWith(color: active ? on : brand.textPrimary),
                  ),
                ),
                if (delta.isNotEmpty) ...[
                  const SizedBox(width: 4),
                  Text(
                    delta,
                    style: context.text.labelMedium?.copyWith(
                      fontSize: 12,
                      color: active ? on.withValues(alpha: 0.85) : brand.textTertiary,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One group of add-ons as a row that opens in place: «Сиропы · не выбрано ›»
/// or «Сиропы · Ваниль, Карамель ›»; open, a compact list with a price and a
/// tick (one at most) or a stepper (several) per add-on. A group with an
/// add-on that has to be taken is marked «обязательно».
class AddonGroupTile extends StatelessWidget {
  const AddonGroupTile({
    required this.group,
    required this.counts,
    required this.currency,
    required this.expanded,
    required this.onToggle,
    required this.onChanged,
    super.key,
  });

  final AddonGroup group;
  final Map<String, int> counts;
  final String currency;
  final bool expanded;
  final VoidCallback onToggle;
  final void Function(String modifierId, int count) onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final title = group.name ?? l10n.productAddons;
    final chosen = addonGroupSummary(group, counts);
    final summary = chosen.isEmpty ? l10n.productAddonsNone : chosen;

    return AnimatedContainer(
      duration: Motion.medium,
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.input),
        border: Border.all(color: chosen.isEmpty ? brand.borderLight : brand.caramel.withValues(alpha: 0.45)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: true,
            expanded: expanded,
            label: [title, summary, if (group.isRequired) l10n.productRequired].join(', '),
            excludeSemantics: true,
            onTap: onToggle,
            child: InkWell(
              onTap: () {
                HapticFeedback.selectionClick();
                onToggle();
              },
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 52),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text.rich(
                          TextSpan(
                            children: [
                              TextSpan(text: title, style: context.text.titleSmall),
                              TextSpan(
                                text: ' · $summary',
                                style: context.text.bodyMedium?.copyWith(
                                  color: chosen.isEmpty ? brand.textTertiary : brand.caramel,
                                ),
                              ),
                            ],
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (group.isRequired) ...[const SizedBox(width: 8), _RequiredBadge(label: l10n.productRequired)],
                      const SizedBox(width: 4),
                      AnimatedRotation(
                        turns: expanded ? 0.25 : 0,
                        duration: Motion.medium,
                        curve: Motion.emphasized,
                        child: Icon(Icons.chevron_right_rounded, color: brand.textTertiary),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          AnimatedSize(
            duration: Motion.medium,
            curve: Motion.emphasized,
            alignment: Alignment.topCenter,
            child: expanded
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Divider(height: 1, color: brand.borderLight),
                      for (final m in group.modifiers)
                        _AddonRow(
                          modifier: m,
                          count: counts[m.id] ?? m.minCount,
                          currency: currency,
                          onChanged: (count) => onChanged(m.id, count),
                        ),
                    ],
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}

class _RequiredBadge extends StatelessWidget {
  const _RequiredBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: brand.caramelSoft, borderRadius: BorderRadius.circular(Radii.pill)),
      child: Text(
        label,
        style: context.text.labelSmall?.copyWith(color: brand.caramel, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _AddonRow extends StatelessWidget {
  const _AddonRow({required this.modifier, required this.count, required this.currency, required this.onChanged});

  final Modifier modifier;
  final int count;
  final String currency;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final single = modifier.maxCount <= 1;
    final locked = single && modifier.minCount >= 1;
    final price = priceDelta(context, modifier.priceDeltaCents, currency);

    void toggle() {
      HapticFeedback.selectionClick();
      onChanged(count > 0 ? 0 : 1);
    }

    final row = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: Padding(
        padding: EdgeInsets.fromLTRB(14, 2, single ? 4 : 8, 2),
        child: Row(
          children: [
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(modifier.name, style: context.text.bodyLarge),
                  if (!single) Text(l10n.productAddonLimit(modifier.maxCount), style: context.text.bodySmall),
                ],
              ),
            ),
            if (price.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(left: 8, right: 4),
                child: Text(
                  price,
                  style: context.text.bodyMedium?.copyWith(
                    color: count > 0 ? brand.textPrimary : brand.textSecondary,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            if (single)
              Checkbox(value: count > 0, activeColor: brand.caramel, onChanged: locked ? null : (_) => toggle())
            else
              QuantityStepper(
                value: count,
                min: modifier.minCount,
                max: modifier.maxCount,
                compact: true,
                buttonSize: 44,
                onChanged: onChanged,
              ),
          ],
        ),
      ),
    );

    // The whole row ticks a single add-on, not just the box.
    return single
        ? MergeSemantics(
            child: InkWell(onTap: locked ? null : toggle, child: row),
          )
        : Semantics(container: true, label: [modifier.name, price].where((s) => s.isNotEmpty).join(', '), child: row);
  }
}
