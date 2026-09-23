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
}
