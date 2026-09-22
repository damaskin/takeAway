import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/storage/app_prefs.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../catalog/catalog_providers.dart';
import '../stores/store_widgets.dart';
import 'menu_search_screen.dart';
import 'menu_widgets.dart';
import 'product_card.dart';

/// Home tab: the menu of the store the customer orders from.
class MenuScreen extends ConsumerWidget {
  const MenuScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stores = ref.watch(storesProvider);
    final store = ref.watch(activeStoreProvider);

    // A single store is chosen for the customer; remember it so the cart
    // and checkout agree on it.
    if (store != null && ref.read(activeStoreIdProvider) != store.id) {
      WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(activeStoreIdProvider.notifier).select(store.id));
    }

    return Scaffold(
      body: stores.when(
        loading: () => const _MenuSkeleton(),
        error: (error, _) => SafeArea(
          child: ErrorState(error: error, onRetry: () => ref.invalidate(storesProvider)),
        ),
        data: (_) => store == null
            ? const SafeArea(bottom: false, child: StorePickerList())
            : _MenuView(key: ValueKey(store.id), store: store),
      ),
    );
  }
}

class _MenuView extends ConsumerStatefulWidget {
  const _MenuView({required this.store, super.key});

  final Store store;

  @override
  ConsumerState<_MenuView> createState() => _MenuViewState();
}

class _MenuViewState extends ConsumerState<_MenuView> {
  final _scroll = ScrollController();
  List<GlobalKey> _sectionKeys = const [];
  List<GlobalKey> _chipKeys = const [];
  String _signature = '';
  int _selected = 0;
  bool _jumping = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_spy);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// Keys follow the category list, not the build — regenerating them on
  /// every rebuild would tear down every card in the grid.
  void _syncKeys(List<MenuCategory> categories) {
    final signature = categories.map((c) => c.id).join('|');
    if (signature == _signature) return;
    _signature = signature;
    _sectionKeys = [for (final _ in categories) GlobalKey()];
    _chipKeys = [for (final _ in categories) GlobalKey()];
    if (_selected >= categories.length) _selected = 0;
  }

  /// Bottom edge of the pinned category bar in global coordinates: the
  /// scroll view starts under the status bar and the bar pins to its top.
  double _barBottom() => MediaQuery.paddingOf(context).top + CategoryBarDelegate.height;

  /// Highlights the category whose section is under the pinned bar.
  void _spy() {
    if (_jumping || _sectionKeys.isEmpty) return;
    final barBottom = _barBottom();
    var current = 0;
    for (var i = 0; i < _sectionKeys.length; i++) {
      final box = _sectionKeys[i].currentContext?.findRenderObject() as RenderBox?;
      if (box == null || !box.attached) continue;
      final top = box.localToGlobal(Offset.zero).dy;
      if (top <= barBottom + 24) current = i;
    }
    if (current != _selected) {
      setState(() => _selected = current);
      _revealChip(current);
    }
  }

  void _revealChip(int index) {
    final chip = _chipKeys[index].currentContext;
    if (chip != null) {
      unawaited(Scrollable.ensureVisible(chip, alignment: 0.4, duration: Motion.medium, curve: Curves.easeOutCubic));
    }
  }

  Future<void> _jumpTo(int index) async {
    final target = _sectionKeys[index].currentContext?.findRenderObject();
    setState(() => _selected = index);
    _revealChip(index);
    if (target == null) return;
    // Offset that would put the section at the viewport top, minus the
    // pinned bar that covers that strip.
    final reveal = RenderAbstractViewport.of(target).getOffsetToReveal(target, 0).offset;
    final destination = (reveal - CategoryBarDelegate.height + 4).clamp(0.0, _scroll.position.maxScrollExtent);
    _jumping = true;
    await _scroll.animateTo(destination, duration: const Duration(milliseconds: 520), curve: Motion.emphasized);
    _jumping = false;
  }

  void _openSearch(Menu menu) => Navigator.of(context).push(
    PageRouteBuilder<void>(
      transitionDuration: Motion.medium,
      reverseTransitionDuration: Motion.fast,
      pageBuilder: (_, _, _) => MenuSearchScreen(menu: menu, store: widget.store),
      transitionsBuilder: (_, animation, _, child) => FadeTransition(opacity: animation, child: child),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    final menuAsync = ref.watch(menuProvider(store.id));
    final brand = context.brand;
    final l10n = AppLocalizations.of(context);

    final menu = menuAsync.valueOrNull;
    final categories = menu?.value.visibleCategories ?? const <MenuCategory>[];
    _syncKeys(categories);

    return Stack(
      children: [
        SafeArea(
          bottom: false,
          child: RefreshIndicator(
            color: brand.caramel,
            onRefresh: () async {
              ref
                ..invalidate(storesProvider)
                ..invalidate(menuProvider(store.id));
              await ref.read(menuProvider(store.id).future);
            },
            child: CustomScrollView(
              controller: _scroll,
              physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
              slivers: [
                SliverToBoxAdapter(
                  child: MenuHeader(store: store, onSearch: menu == null ? () {} : () => _openSearch(menu.value)),
                ),
                const SliverToBoxAdapter(child: ActiveOrderCard()),
                SliverToBoxAdapter(
                  child: StoreNotice(store: store, offline: menu?.stale ?? false),
                ),
                if (menuAsync.isLoading && menu == null)
                  const SliverToBoxAdapter(child: _GridSkeleton())
                else if (menuAsync.hasError && menu == null)
                  SliverFillRemaining(
                    hasScrollBody: false,
                    child: ErrorState(error: menuAsync.error!, onRetry: () => ref.invalidate(menuProvider(store.id))),
                  )
                else if (categories.isEmpty)
                  SliverFillRemaining(
                    hasScrollBody: false,
                    child: EmptyState(icon: Icons.local_cafe_outlined, title: l10n.menuEmpty),
                  )
                else ...[
                  SliverPersistentHeader(
                    pinned: true,
                    delegate: CategoryBarDelegate(
                      categories: categories,
                      selected: _selected,
                      onSelect: _jumpTo,
                      chipKeys: _chipKeys,
                      background: brand.cream,
                      divider: brand.borderLight,
                    ),
                  ),
                  for (var i = 0; i < categories.length; i++) ...[
                    SliverToBoxAdapter(
                      child: Padding(
                        key: _sectionKeys[i],
                        padding: EdgeInsets.fromLTRB(20, i == 0 ? 8 : 24, 20, 12),
                        child: Text(categories[i].name, style: context.text.headlineSmall),
                      ),
                    ),
                    SliverPadding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      sliver: SliverGrid.builder(
                        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 240,
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          childAspectRatio: 0.66,
                        ),
                        itemCount: categories[i].products.length,
                        itemBuilder: (context, index) =>
                            ProductCard(product: categories[i].products[index], store: store),
                      ),
                    ),
                  ],
                  const SliverToBoxAdapter(child: SizedBox(height: 110)),
                ],
              ],
            ),
          ),
        ),
        Positioned(left: 16, right: 16, bottom: 12, child: CartBar(currency: store.currency)),
      ],
    );
  }
}

class _MenuSkeleton extends StatelessWidget {
  const _MenuSkeleton();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.all(20),
          physics: const NeverScrollableScrollPhysics(),
          children: const [
            Skeleton(width: 220, height: 30),
            SizedBox(height: 16),
            Skeleton(height: 72, radius: Radii.card),
            SizedBox(height: 20),
            _GridSkeleton(padded: false),
          ],
        ),
      ),
    );
  }
}

class _GridSkeleton extends StatelessWidget {
  const _GridSkeleton({this.padded = true});

  final bool padded;

  @override
  Widget build(BuildContext context) {
    return ShimmerScope(
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: padded ? 16 : 0, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                for (final w in [70.0, 90.0, 80.0]) ...[
                  Skeleton(width: w, height: 34, radius: Radii.pill),
                  const SizedBox(width: 8),
                ],
              ],
            ),
            const SizedBox(height: 20),
            for (var row = 0; row < 2; row++) ...[
              const Row(
                children: [
                  Expanded(child: Skeleton(height: 230, radius: Radii.card)),
                  SizedBox(width: 12),
                  Expanded(child: Skeleton(height: 230, radius: Radii.card)),
                ],
              ),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
    );
  }
}
