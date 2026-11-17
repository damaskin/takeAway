import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/format/points.dart';
import '../../core/format/time.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/error_message.dart';
import '../../shared/money_text.dart';
import '../../shared/store_hours.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/skeleton.dart';
import '../catalog/catalog_providers.dart';
import 'checkout_controller.dart';

/// Rounded white card with a heading — the building block of checkout.
class CheckoutSection extends StatelessWidget {
  const CheckoutSection({required this.title, required this.child, this.icon, super.key});

  final String title;
  final IconData? icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: brand.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (icon != null) ...[Icon(icon, size: 20, color: brand.caramel), const SizedBox(width: 8)],
              Text(title, style: context.text.titleMedium),
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

/// Two-way pill toggle (Pickup / Delivery, Now / Later).
class SegmentToggle<T> extends StatelessWidget {
  const SegmentToggle({
    required this.value,
    required this.options,
    required this.onChanged,
    this.disabled = const {},
    super.key,
  });

  final T value;
  final List<(T, String, IconData)> options;
  final ValueChanged<T> onChanged;

  /// Options shown but not selectable right now, e.g. ASAP after hours.
  final Set<T> disabled;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: brand.cream, borderRadius: BorderRadius.circular(Radii.button)),
      child: Row(
        children: [
          for (final (option, label, icon) in options)
            Expanded(
              child: Pressable(
                onTap: disabled.contains(option)
                    ? null
                    : () {
                        if (option != value) onChanged(option);
                      },
                child: AnimatedOpacity(
                  duration: Motion.medium,
                  opacity: disabled.contains(option) ? 0.4 : 1,
                  child: AnimatedContainer(
                    duration: Motion.medium,
                    curve: Motion.emphasized,
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    decoration: BoxDecoration(
                      color: option == value ? brand.foam : Colors.transparent,
                      borderRadius: BorderRadius.circular(Radii.button - 3),
                      boxShadow: option == value ? brand.softShadow : null,
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(icon, size: 18, color: option == value ? brand.caramel : brand.textTertiary),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            label,
                            overflow: TextOverflow.ellipsis,
                            style: context.text.labelLarge?.copyWith(
                              color: option == value ? brand.textPrimary : brand.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// 15-minute windows over the next 24 hours, a scrolling row per day under
/// «Сегодня» / «Завтра»; full ones stay visible but struck through, so a busy
/// morning reads as busy rather than broken. Fetched for the cart, so a
/// window too busy for its work shows as full.
class SlotPicker extends ConsumerWidget {
  const SlotPicker({
    required this.storeId,
    required this.selected,
    required this.onSelect,
    this.cartId,
    this.asapOffered = true,
    super.key,
  });

  final String storeId;
  final String? cartId;
  final DateTime? selected;
  final ValueChanged<PickupSlot> onSelect;

  /// False while «as soon as possible» is off: the empty state then does not
  /// suggest it.
  final bool asapOffered;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final slots = ref.watch(pickupSlotsProvider((storeId: storeId, cartId: cartId)));

    return slots.when(
      loading: () => const ShimmerScope(
        child: Row(
          children: [
            Skeleton(width: 72, height: 44, radius: Radii.pill),
            SizedBox(width: 8),
            Skeleton(width: 72, height: 44, radius: Radii.pill),
            SizedBox(width: 8),
            Skeleton(width: 72, height: 44, radius: Radii.pill),
          ],
        ),
      ),
      error: (error, _) => Text(errorMessage(context, error), style: TextStyle(color: brand.berry)),
      data: (list) {
        if (list.isEmpty || list.every((s) => !s.available)) {
          return Text(
            asapOffered ? l10n.noSlots : l10n.noSlotsClosed,
            style: context.text.bodyMedium?.copyWith(color: brand.berry),
          );
        }
        final now = DateTime.now();
        final days = <(int, List<PickupSlot>)>[];
        for (final slot in list) {
          final day = calendarDaysBetween(now, slot.startsAt);
          if (days.isNotEmpty && days.last.$1 == day) {
            days.last.$2.add(slot);
          } else {
            days.add((day, [slot]));
          }
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final (day, daySlots) in days) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(switch (day) {
                  <= 0 => l10n.slotDayToday,
                  1 => l10n.slotDayTomorrow,
                  _ => MaterialLocalizations.of(context).formatShortMonthDay(daySlots.first.startsAt.toLocal()),
                }, style: context.text.labelMedium?.copyWith(color: brand.textSecondary)),
              ),
              _SlotRow(slots: daySlots, selected: selected, onSelect: onSelect),
              const SizedBox(height: 10),
            ],
            Text(l10n.slotsHint, style: context.text.bodySmall),
          ],
        );
      },
    );
  }
}

/// One day of windows, scrolling sideways.
class _SlotRow extends StatelessWidget {
  const _SlotRow({required this.slots, required this.selected, required this.onSelect});

  final List<PickupSlot> slots;
  final DateTime? selected;
  final ValueChanged<PickupSlot> onSelect;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: slots.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final slot = slots[index];
          final active = selected != null && slot.startsAt.isAtSameMomentAs(selected!);
          final label = formatClock(context, slot.startsAt);
          return Pressable(
            onTap: slot.available
                ? () {
                    HapticFeedback.selectionClick();
                    onSelect(slot);
                  }
                : null,
            child: AnimatedContainer(
              duration: Motion.medium,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: active ? brand.caramel : brand.foam,
                borderRadius: BorderRadius.circular(Radii.pill),
                border: Border.all(color: active ? brand.caramel : brand.border),
              ),
              child: Text(
                label,
                style: context.text.labelLarge?.copyWith(
                  color: active
                      ? Colors.white
                      : slot.available
                      ? brand.textPrimary
                      : brand.textTertiary,
                  decoration: slot.available ? null : TextDecoration.lineThrough,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Code input with an Apply / clear button and the server's verdict below.
/// A code applied from outside (the welcome bonus) shows in the field too.
class CodeField extends StatefulWidget {
  const CodeField({
    required this.label,
    required this.icon,
    required this.state,
    required this.successText,
    required this.onApply,
    required this.onClear,
    this.clearLabel,
    super.key,
  });

  final String label;
  final IconData icon;
  final AppliedCode state;
  final String? successText;
  final ValueChanged<String> onApply;
  final VoidCallback onClear;

  /// Words for taking an applied code off («Убрать»); a cross without.
  final String? clearLabel;

  @override
  State<CodeField> createState() => _CodeFieldState();
}

class _CodeFieldState extends State<CodeField> {
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller.text = widget.state.code ?? '';
  }

  @override
  void didUpdateWidget(CodeField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Follow a code put in or taken off by checkout itself; a code the
    // customer typed is already there (in their own letter case).
    final code = widget.state.code;
    if (code == oldWidget.state.code) return;
    if (code == null) {
      _controller.clear();
    } else if (_controller.text.trim().toUpperCase() != code) {
      _controller.text = code;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final s = widget.state;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _controller,
          enabled: !s.ok,
          // A disabled field ignores every touch by default, its suffix
          // too — and the suffix is how an applied code comes off.
          ignorePointers: false,
          textCapitalization: TextCapitalization.characters,
          autocorrect: false,
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9_-]')),
            LengthLimitingTextInputFormatter(40),
          ],
          onSubmitted: s.busy ? null : widget.onApply,
          decoration: InputDecoration(
            labelText: widget.label,
            prefixIcon: Icon(widget.icon, color: s.ok ? brand.mint : null),
            suffixIcon: Padding(
              padding: const EdgeInsets.only(right: 6),
              child: s.busy
                  ? const Padding(
                      padding: EdgeInsets.all(14),
                      child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  : s.ok && widget.clearLabel != null
                  ? TextButton(
                      onPressed: () {
                        _controller.clear();
                        widget.onClear();
                      },
                      child: Text(widget.clearLabel!),
                    )
                  : s.ok
                  ? IconButton(
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () {
                        _controller.clear();
                        widget.onClear();
                      },
                    )
                  : TextButton(onPressed: () => widget.onApply(_controller.text), child: Text(l10n.apply)),
            ),
          ),
        ),
        AnimatedSize(
          duration: Motion.medium,
          child: s.ok && widget.successText != null
              ? Padding(
                  padding: const EdgeInsets.only(top: 6, left: 4),
                  child: Row(
                    children: [
                      Icon(Icons.check_circle_rounded, size: 16, color: brand.mint),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(widget.successText!, style: context.text.bodySmall?.copyWith(color: brand.mint)),
                      ),
                    ],
                  ),
                )
              : !s.ok && !s.busy && s.code != null
              ? Padding(
                  padding: const EdgeInsets.only(top: 6, left: 4),
                  child: Text(
                    s.error == null ? l10n.promoInvalid : errorMessage(context, s.error!),
                    style: context.text.bodySmall?.copyWith(color: brand.berry),
                  ),
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}

/// One line of the order summary.
class SummaryLine extends StatelessWidget {
  const SummaryLine({
    required this.label,
    required this.cents,
    required this.currency,
    this.negative = false,
    this.emphasized = false,
    super.key,
  });

  final String label;
  final int cents;
  final String currency;
  final bool negative;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final style = emphasized
        ? context.text.titleLarge
        : context.text.bodyMedium?.copyWith(color: negative ? brand.mint : brand.textSecondary);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          if (negative) Text('− ', style: style),
          AnimatedMoney(cents: cents, currency: currency, style: style ?? const TextStyle()),
        ],
      ),
    );
  }
}

/// How many points to spend, typed with up to two decimals («12,4» or
/// «12.40»), under «Оплатить баллами». Applied with «Применить», the
/// keyboard's done key or on leaving the field; shows the server's quote back
/// («12,40»), or keeps what the customer typed while it was under the minimum.
class PointsAmountField extends StatefulWidget {
  const PointsAmountField({required this.state, required this.capUnits, required this.onApply, super.key});

  final PointsState state;

  /// The most the order can take, in units, for the «Не больше» line.
  final int capUnits;

  /// Called with the typed amount in units (see [Points.parse]).
  final ValueChanged<int> onApply;

  @override
  State<PointsAmountField> createState() => _PointsAmountFieldState();
}

class _PointsAmountFieldState extends State<PointsAmountField> {
  /// Digits, then at most one separator and two decimals.
  static final _shape = RegExp(r'^\d{0,7}([.,]\d{0,2})?$');

  final _controller = TextEditingController();
  final _focus = FocusNode();

  /// The amount last sent, in units: leaving the field does not ask about it
  /// again (a done key unfocuses right after submitting, and an amount under
  /// the minimum stays in the field).
  int? _asked;

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocus);
    _controller.addListener(_onText);
  }

  /// Leaving the field applies what was typed — scrolling the keyboard away
  /// or tapping elsewhere is how most people finish an amount.
  void _onFocus() {
    if (mounted && !_focus.hasFocus) _apply(again: false);
  }

  void _onText() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_controller.text.isEmpty && widget.state.spent > 0) _show(widget.state.spent);
  }

  @override
  void didUpdateWidget(PointsAmountField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A new quote: the field shows what actually goes on the order.
    final spent = widget.state.spent;
    if (spent > 0 && (spent != oldWidget.state.spent || oldWidget.state.busy && !widget.state.busy)) _show(spent);
  }

  void _show(int units) {
    final text = Points.input(units, locale: AppLocalizations.of(context).localeName);
    if (_controller.text != text) _controller.text = text;
  }

  bool get _changed => Points.parse(_controller.text) != widget.state.spent;

  /// Sends the typed amount unless it is what goes on the order already;
  /// [again]: also when it was just asked (the customer pressed «Применить»
  /// after a failed quote).
  void _apply({bool again = true}) {
    final units = Points.parse(_controller.text);
    if (widget.state.busy || !_changed || (!again && units == _asked)) return;
    _asked = units;
    widget.onApply(units);
  }

  @override
  void dispose() {
    // Gone with the switch turned off: what was typed is not applied then.
    _focus
      ..removeListener(_onFocus)
      ..dispose();
    _controller
      ..removeListener(_onText)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final busy = widget.state.busy;
    return TextField(
      key: const ValueKey('points-amount'),
      controller: _controller,
      focusNode: _focus,
      // Not disabled: that would take the keyboard away mid-quote.
      readOnly: busy,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textInputAction: TextInputAction.done,
      inputFormatters: [TextInputFormatter.withFunction((old, next) => _shape.hasMatch(next.text) ? next : old)],
      onSubmitted: (_) => _apply(),
      decoration: InputDecoration(
        labelText: l10n.pointsAmount,
        helperText: widget.capUnits > 0 ? l10n.pointsAmountMax(Points.label(l10n, widget.capUnits)) : null,
        suffixIcon: busy
            ? const Padding(
                padding: EdgeInsets.all(14),
                child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              )
            : _changed
            ? Padding(
                padding: const EdgeInsets.only(right: 6),
                child: TextButton(onPressed: _apply, child: Text(l10n.apply)),
              )
            : null,
      ),
    );
  }
}
