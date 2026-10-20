import 'package:flutter/material.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../core/format/time.dart';
import '../core/theme/tokens.dart';
import '../l10n/app_localizations.dart';

/// What a store card or the menu header says about the hours, beside the
/// wait: when a closed store opens (pre-orders taken meanwhile), or until
/// when an open one works. The same rules as the web (`storeHoursNote` in
/// `@takeaway/utils`); times on the device clock, like the rest of the app.
enum StoreHoursKind {
  /// Closed for orders now, opens at [StoreHoursNote.at]; pre-orders taken.
  opens,

  /// Closed for orders now with no opening time to name (no shift yet).
  preorder,

  /// Open, but the queue is too long for «now»; pre-orders taken.
  queueFull,

  /// The kitchen paused the store until [StoreHoursNote.at] («Технический
  /// перерыв»); pre-orders for later taken.
  paused,

  /// Within hours, but an order for now would not be ready before the
  /// closing; pre-orders taken.
  closingSoon,

  /// Open for orders now, until [StoreHoursNote.at].
  until,
}

class StoreHoursNote {
  const StoreHoursNote(this.kind, {this.at, this.days = 0});

  final StoreHoursKind kind;
  final DateTime? at;

  /// Calendar days from today to [at]: 0 later today, 1 tomorrow.
  final int days;
}

/// Null when there is nothing to add: a store that takes no orders at all
/// (shown as closed, as before), or an open one without a closing time (open
/// around the clock, or an API that predates `closesAt`).
StoreHoursNote? storeHoursNote(Store store, {DateTime? now}) {
  if (store.isOpen) {
    final closes = store.closesAt;
    return closes == null ? null : StoreHoursNote(StoreHoursKind.until, at: closes);
  }
  if (!store.preorderOnly) return null;
  final reason = store.asapBlockedReason;
  final pausedUntil = store.pausedUntil;
  if (reason == AsapBlockedReason.queueFull) return const StoreHoursNote(StoreHoursKind.queueFull);
  if (reason == AsapBlockedReason.paused && pausedUntil != null) {
    return StoreHoursNote(StoreHoursKind.paused, at: pausedUntil);
  }
  if (reason == AsapBlockedReason.closingSoon) return const StoreHoursNote(StoreHoursKind.closingSoon);
  final opens = store.opensAt;
  if (opens == null) return const StoreHoursNote(StoreHoursKind.preorder);
  return StoreHoursNote(StoreHoursKind.opens, at: opens, days: calendarDaysBetween(now ?? DateTime.now(), opens));
}

/// Whole calendar days from [from] to [to] on the device clock: 0 the same
/// day, 1 the next.
int calendarDaysBetween(DateTime from, DateTime to) {
  final a = from.toLocal();
  final b = to.toLocal();
  return DateTime.utc(b.year, b.month, b.day).difference(DateTime.utc(a.year, a.month, a.day)).inDays;
}

/// «Сейчас закрыто · откроется завтра в 9:00 · можно заказать ко времени»,
/// «Большая очередь — только ко времени», «Технический перерыв до 12:30 ·
/// можно заказать ко времени», «до 21:00»; see [storeHoursNote].
String? storeHoursText(BuildContext context, Store store, {DateTime? now}) {
  final note = storeHoursNote(store, now: now);
  if (note == null) return null;
  final l10n = AppLocalizations.of(context);
  final at = note.at;
  return switch (note.kind) {
    StoreHoursKind.until => l10n.storeOpenUntil(formatClock(context, at!)),
    StoreHoursKind.queueFull => l10n.storeQueueFullPreorder,
    StoreHoursKind.paused => l10n.storePausedPreorder(formatClock(context, at!)),
    StoreHoursKind.closingSoon => l10n.storeClosingSoonPreorder,
    StoreHoursKind.preorder => l10n.storeClosedPreorder,
    StoreHoursKind.opens => switch (note.days) {
      <= 0 => l10n.storeOpensAt(formatClock(context, at!)),
      1 => l10n.storeOpensTomorrowAt(formatClock(context, at!)),
      _ => l10n.storeOpensOnAt(_dayMonth(context, at!), formatClock(context, at)),
    },
  };
}

/// Why «Как можно скорее» is off at checkout, with what to do instead; null
/// while the store takes an order for now or gave no reason.
///
/// [refused] is the reason the API gave a moment ago when it turned an
/// order for now down. It counts only while the store still reads open: a
/// closing too close for this very order's cooking time, say, which the
/// store's own state does not show.
String? asapBlockedText(BuildContext context, Store store, {AsapBlockedReason? refused, DateTime? now}) {
  final reason = store.isOpen ? refused : store.asapBlockedReason;
  if (reason == null) return null;
  final l10n = AppLocalizations.of(context);
  final opens = store.opensAt;
  final pausedUntil = store.pausedUntil;
  final closes = store.closesAt;
  return switch (reason) {
    AsapBlockedReason.queueFull => l10n.asapBlockedQueueFull,
    AsapBlockedReason.shiftClosed => l10n.asapBlockedShiftClosed,
    AsapBlockedReason.paused =>
      pausedUntil == null ? l10n.asapBlockedPaused : l10n.asapBlockedPausedUntil(formatClock(context, pausedUntil)),
    AsapBlockedReason.closingSoon =>
      closes == null ? l10n.asapBlockedClosingSoon : l10n.asapBlockedClosingSoonAt(formatClock(context, closes)),
    AsapBlockedReason.outsideHours when opens != null => switch (calendarDaysBetween(now ?? DateTime.now(), opens)) {
      <= 0 => l10n.asapBlockedOpensAt(formatClock(context, opens)),
      1 => l10n.asapBlockedOpensTomorrowAt(formatClock(context, opens)),
      _ => l10n.asapBlockedOpensOnAt(_dayMonth(context, opens), formatClock(context, opens)),
    },
    _ => null,
  };
}

String _dayMonth(BuildContext context, DateTime at) =>
    MaterialLocalizations.of(context).formatShortMonthDay(at.toLocal());

/// A pickup time as a clock time, «09:15 завтра» when it falls on the next
/// calendar day — a pre-order placed at night is for the morning.
String pickupClock(BuildContext context, DateTime at, {DateTime? now}) {
  final clock = formatClock(context, at);
  return calendarDaysBetween(now ?? DateTime.now(), at) == 1 ? AppLocalizations.of(context).timeTomorrow(clock) : clock;
}

/// The hours line as a small row: a moon and the opening time while the
/// store takes pre-orders only, plain «до 21:00» while it is open. Nothing
/// when there is nothing to say.
class StoreHoursLine extends StatelessWidget {
  const StoreHoursLine({required this.store, this.color, this.maxLines = 2, super.key});

  final Store store;

  /// Text colour; the secondary text colour when null.
  final Color? color;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final text = storeHoursText(context, store);
    if (text == null) return const SizedBox.shrink();
    final brand = context.brand;
    final tint = color ?? brand.textSecondary;
    final style = context.text.labelMedium?.copyWith(color: tint);
    if (store.isOpen) return Text(text, style: style, maxLines: 1, overflow: TextOverflow.ellipsis);
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(Icons.schedule_send_rounded, size: 15, color: brand.amber),
        ),
        const SizedBox(width: 6),
        Flexible(
          child: Text(text, style: style, maxLines: maxLines, overflow: TextOverflow.ellipsis),
        ),
      ],
    );
  }
}
