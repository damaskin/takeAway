import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

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
class CodeField extends StatefulWidget {
  const CodeField({
    required this.label,
    required this.icon,
    required this.state,
    required this.successText,
    required this.onApply,
    required this.onClear,
    super.key,
  });

  final String label;
  final IconData icon;
  final AppliedCode state;
  final String? successText;
  final ValueChanged<String> onApply;
  final VoidCallback onClear;

  @override
  State<CodeField> createState() => _CodeFieldState();
}

class _CodeFieldState extends State<CodeField> {
  final _controller = TextEditingController();

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
