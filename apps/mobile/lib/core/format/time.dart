import 'package:flutter/material.dart';

/// Clock time in the device's convention (24 h unless the user chose 12 h).
String formatClock(BuildContext context, DateTime time) {
  final local = time.toLocal();
  return MaterialLocalizations.of(context).formatTimeOfDay(
    TimeOfDay.fromDateTime(local),
    alwaysUse24HourFormat: MediaQuery.maybeAlwaysUse24HourFormatOf(context) ?? true,
  );
}

/// Whole minutes, never below one — "ready in 0 min" reads like a bug.
int minutesCeil(int seconds) => seconds <= 0 ? 1 : (seconds / 60).ceil();

/// `m:ss` countdown label.
String formatCountdown(Duration remaining) {
  final clamped = remaining.isNegative ? Duration.zero : remaining;
  final minutes = clamped.inMinutes;
  final seconds = clamped.inSeconds.remainder(60).toString().padLeft(2, '0');
  return '$minutes:$seconds';
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
