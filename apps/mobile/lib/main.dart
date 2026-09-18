// M6 PR1 entry-point. Boots Riverpod + Hive + Firebase before MaterialApp.
// Each feature wires its own routes through GoRouter in `app.dart` (added in
// the next PR).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  runApp(const ProviderScope(child: TakeAwayApp()));
}

class TakeAwayApp extends StatelessWidget {
  const TakeAwayApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'takeAway',
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFFCB9A6F), // caramel — matches design tokens
      ),
      home: const _BootScreen(),
    );
  }
}

class _BootScreen extends StatelessWidget {
  const _BootScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: const [
            Text('takeAway', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w600)),
            SizedBox(height: 8),
            Text('Pre-order. Skip the queue. Pick it up.'),
          ],
        ),
      ),
    );
  }
}
