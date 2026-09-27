import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/auth/session_manager.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/features/cart/cart_controller.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  ProviderContainer containerFor(FakeApi api) {
    final container = ProviderContainer(
      overrides: [
        sessionManagerProvider.overrideWithValue(
          SessionManager(storage: MemorySessionStorage(), initial: testSession()),
        ),
        apiProvider.overrideWithValue(api),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('an add made while the cart is still loading is not undone by that load', () async {
    // Right after sign-in: the cart read is slow and the first add follows at once.
    final api = FakeApi()..cartDelay = const Duration(milliseconds: 200);
    final container = containerFor(api);
    final subscription = container.listen(cartProvider('st_1'), (_, _) {});
    addTearDown(subscription.close);

    await container.read(cartProvider('st_1').notifier).add(productId: 'p_croissant');
    await Future<void>.delayed(const Duration(milliseconds: 300));

    expect(container.read(cartProvider('st_1')).value?.itemCount, 1);
  });

  test('announces what was added so the cart bar can acknowledge it', () async {
    final container = containerFor(FakeApi());
    final subscription = container.listen(cartProvider('st_1'), (_, _) {});
    addTearDown(subscription.close);

    await container.read(cartProvider('st_1').notifier).add(productId: 'p_croissant');
    final first = container.read(cartAdditionProvider);
    await container.read(cartProvider('st_1').notifier).add(productId: 'p_croissant');

    expect(first?.productName, 'Круассан');
    expect(container.read(cartAdditionProvider), isNot(same(first)), reason: 'the same item twice still registers');
  });

  test('quick taps on + all count, however the answers come back', () async {
    final api = FakeApi()
      ..seedCart(FakeApi.croissant())
      // The first change is slow, the second fast: sent side by side, the
      // second would land first and the first would then undo it.
      ..updateDelays.addAll(const [Duration(milliseconds: 120), Duration(milliseconds: 10), Duration.zero]);
    final container = containerFor(api);
    final subscription = container.listen(cartProvider('st_1'), (_, _) {});
    addTearDown(subscription.close);
    await container.read(cartProvider('st_1').future);

    final shown = <int>[];
    container.listen(cartProvider('st_1'), (_, next) => shown.add(next.value!.items.single.quantity));

    // What the stepper does: the next count is the one on screen plus one.
    Future<void> tapPlus() {
      final item = container.read(cartProvider('st_1')).value!.items.single;
      return container.read(cartProvider('st_1').notifier).setQuantity(item.id, item.quantity + 1);
    }

    await Future.wait([tapPlus(), tapPlus(), tapPlus()]);

    expect(container.read(cartProvider('st_1')).value!.items.single.quantity, 4);
    expect((await api.cart('st_1')).items.single.quantity, 4, reason: 'the server ends up with every tap');
    for (var i = 1; i < shown.length; i++) {
      expect(shown[i], greaterThanOrEqualTo(shown[i - 1]), reason: 'the count never jumps back: $shown');
    }
  });
}
