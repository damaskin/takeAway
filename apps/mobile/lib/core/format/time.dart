import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../l10n/app_localizations.dart';

/// Clock time in the device's convention (24 h unless the user chose 12 h).
String formatClock(BuildContext context, DateTime time) {
  final local = time.toLocal();
  return MaterialLocalizations.of(context).formatTimeOfDay(
    TimeOfDay.fromDateTime(local),
    alwaysUse24HourFormat: MediaQuery.maybeAlwaysUse24HourFormatOf(context) ?? true,
  );
}

/// Minutes since local midnight as a clock time; 1440 is "24:00", the end
/// of the day, which `TimeOfDay` cannot hold.
String formatMinutesOfDay(BuildContext context, int minutes) {
  if (minutes >= 24 * 60) return '24:00';
  return MaterialLocalizations.of(context).formatTimeOfDay(
    TimeOfDay(hour: minutes ~/ 60, minute: minutes % 60),
    alwaysUse24HourFormat: MediaQuery.maybeAlwaysUse24HourFormatOf(context) ?? true,
  );
}

/// Whole minutes, never below one — "ready in 0 min" reads like a bug.
int minutesCeil(int seconds) => seconds <= 0 ? 1 : (seconds / 60).ceil();

/// `m:ss` countdown label; `h:mm:ss` from an hour up — a pre-order for
/// tomorrow morning is not «780:00».
String formatCountdown(Duration remaining) {
  final clamped = remaining.isNegative ? Duration.zero : remaining;
  final seconds = clamped.inSeconds.remainder(60).toString().padLeft(2, '0');
  if (clamped.inHours > 0) {
    final minutes = clamped.inMinutes.remainder(60).toString().padLeft(2, '0');
    return '${clamped.inHours}:$minutes:$seconds';
  }
  return '${clamped.inMinutes}:$seconds';
}

/// Metres to a short label: 850 m, 1.2 km.
String formatDistance(double metres, {String locale = 'en'}) {
  final ru = locale.startsWith('ru');
  if (metres < 1000) return '${metres.round()} ${ru ? 'м' : 'm'}';
  final km = (metres / 1000).toStringAsFixed(metres < 10000 ? 1 : 0);
  return '${ru ? km.replaceAll('.', ',') : km} ${ru ? 'км' : 'km'}';
}

bool isSameDay(DateTime a, DateTime b) {
  final x = a.toLocal();
  final y = b.toLocal();
  return x.year == y.year && x.month == y.month && x.day == y.day;
}

/// How long ago [time] was, as a list of messages says it: just now, minutes
/// or hours ago today, yesterday, then the date — with the year once it is
/// not this one. A time slightly ahead of the phone's clock is "just now".
String formatAgo(AppLocalizations l10n, DateTime time, {required String locale, DateTime? now}) {
  final local = time.toLocal();
  final current = (now ?? DateTime.now()).toLocal();
  final elapsed = current.difference(local);
  if (elapsed < const Duration(minutes: 1)) return l10n.timeJustNow;
  if (elapsed < const Duration(hours: 1)) return l10n.timeMinutesAgo(elapsed.inMinutes);
  if (isSameDay(local, current)) return l10n.timeHoursAgo(elapsed.inHours);
  if (isSameDay(local, DateTime(current.year, current.month, current.day - 1))) return l10n.timeYesterday;
  return (local.year == current.year ? DateFormat.MMMd(locale) : DateFormat.yMMMd(locale)).format(local);
}
