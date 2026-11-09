import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/format/time.dart';
import '../../core/network/api_error.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/product_kinds.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/product_image.dart';
import '../../shared/widgets/quantity_stepper.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../auth/sign_in_sheet.dart';
import '../cart/cart_controller.dart';
import '../cart/upsell.dart';
import '../cart/upsell_row.dart';
import '../catalog/catalog_providers.dart';
import '../menu/product_card.dart';
import 'catalog_options.dart';
import 'option_widgets.dart';
import 'product_options.dart';

/// Product detail and customisation.
class ProductScreen extends ConsumerStatefulWidget {
  const ProductScreen({required this.productId, this.preview, super.key});

  final String productId;

  /// Menu card data, so the photo and name show instantly while the full
  /// product (options, nutrition) loads.
  final Product? preview;

  @override
  ConsumerState<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends ConsumerState<ProductScreen> {
  final Map<VariationType, String> _variations = {};
  final Map<String, int> _modifiers = {};

  /// The choice from the options catalog, for a product with catalog groups
  /// (then [_variations] and [_modifiers] stay empty).
  OptionPicks _picks = const {};

  /// The customer changed [_picks]: a fresher copy of the product keeps
  /// their choice instead of starting over from the defaults.
  bool _picksTouched = false;

  /// Add-on groups shown open, by [AddonGroup.key].
  final Set<String> _expanded = {};
  final _notes = TextEditingController();
  int _quantity = 1;
  ProductDetail? _optionsFrom;
  bool _adding = false;
  bool _showNotes = false;

  @override
  void initState() {
    super.initState();
    // Product details are kept for the session, but an add-in can run out
    // in between and its option is then gone from the menu. A product that
    // was opened before is fetched again, so the screen offers only what
    // can be ordered now.
    final key = (productId: widget.productId, storeId: ref.read(activeStoreIdProvider));
    if (ref.read(storeProductProvider(key)).hasValue) {
      Future.microtask(() {
        if (mounted) ref.invalidate(storeProductProvider(key));
      });
    }
  }

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  /// Picks the defaults, and again whenever a fresher copy of the product
  /// arrives: choices that are still on offer stay as the customer left
  /// them, ones that ran out fall back to the default or are dropped. The
  /// first copy also opens the add-on groups with something to be taken.
  void _initDefaults(ProductDetail product) {
    if (identical(product, _optionsFrom)) return;
    final first = _optionsFrom == null;
    _optionsFrom = product;
    final groups = orderOptionGroups(product.optionGroups);
    _picks = first || !_picksTouched ? defaultOptionPicks(groups) : keepOfferedPicks(groups, _picks);
    final types = <VariationType>{};
    for (final type in variationOrder) {
      final group = variationsOf(product, type);
      if (group.isEmpty) continue;
      types.add(type);
      final chosen = _variations[type];
      if (chosen != null && group.any((v) => v.id == chosen)) continue;
      _variations[type] = (group.firstWhere((v) => v.isDefault, orElse: () => group.first)).id;
    }
    _variations.removeWhere((type, _) => !types.contains(type));
    final offered = {for (final m in product.modifiers) m.id: m};
    _modifiers.removeWhere((id, _) => !offered.containsKey(id));
    for (final m in product.modifiers) {
      _modifiers.putIfAbsent(m.id, () => m.minCount);
    }
    if (first) {
      _expanded.addAll([
        for (final group in addonGroups(product))
          if (group.isRequired) group.key,
      ]);
    }
  }

  /// One add-on group open at a time: opening one closes the others.
  void _toggleGroup(String key) => setState(() {
    if (_expanded.contains(key)) {
      _expanded.remove(key);
    } else {
      _expanded
        ..clear()
        ..add(key);
    }
  });

  void _togglePick(ProductDetail product, String optionId) => setState(() {
    _picksTouched = true;
    _picks = toggleOptionPick(orderOptionGroups(product.optionGroups), _picks, optionId);
  });

  void _setPickQty(ProductDetail product, String optionId, int qty) => setState(() {
    _picksTouched = true;
    _picks = setOptionQty(orderOptionGroups(product.optionGroups), _picks, optionId, qty);
  });

  int _unitPrice(ProductDetail product) {
    if (product.hasOptionGroups) {
      return priceWithOptionPicks(product.basePriceCents, orderOptionGroups(product.optionGroups), _picks);
    }
    var total = product.basePriceCents;
    for (final v in product.variations) {
      if (_variations[v.type] == v.id) total += v.priceDeltaCents;
    }
    for (final m in product.modifiers) {
      total += (_modifiers[m.id] ?? 0) * m.priceDeltaCents;
    }
    return total;
  }

  /// A cart only takes products of its store's brand. Prefer the store the
  /// customer is browsing; a product opened some other way falls back to
  /// any store of its brand.
  Store? _storeFor(ProductDetail product) {
    final active = ref.watch(activeStoreProvider);
    if (active != null && active.brandId == product.brandId) return active;
    final stores = ref.watch(sortedStoresProvider).valueOrNull ?? const [];
    for (final item in stores) {
      if (item.store.brandId == product.brandId) return item.store;
    }
    return null;
  }

  Future<void> _add(ProductDetail product, Store store) async {
    // A store taking no orders at all takes nothing into its cart; the bar says why.
    if (_adding || !store.takesOrders) return;
    if (!await ensureSignedIn(context, ref)) return;
    setState(() => _adding = true);
    final catalog = product.hasOptionGroups;
    try {
      await ref
          .read(cartProvider(store.id).notifier)
          .add(
            productId: product.id,
            quantity: _quantity,
            variationIds: catalog ? const [] : _variations.values.toList(),
            modifiers: catalog ? const {} : _modifiers,
            options: catalog ? toOptionSelections(_picks) : null,
            notes: _notes.text,
          );
      unawaited(HapticFeedback.mediumImpact());
      // Back to the menu, where the cart bar acknowledges the add.
      if (mounted) context.pop();
    } on Object catch (error) {
      if (mounted) {
        setState(() => _adding = false);
        Snack.error(context, error);
        // The cart refused the choice — most likely something ran out a
        // moment ago: fetch the product again so the screen shows it.
        if (ApiError.from(error).code == OptionsErrorBody.codeInvalid) {
          ref.invalidate(storeProductProvider((productId: widget.productId, storeId: ref.read(activeStoreIdProvider))));
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // As the store being browsed sells it: options it ran out of are not offered.
    final activeStoreId = ref.watch(activeStoreIdProvider);
    final key = (productId: widget.productId, storeId: activeStoreId);
    final async = ref.watch(storeProductProvider(key));
    final product = async.valueOrNull;
    if (product != null) _initDefaults(product);
    final preview = product ?? widget.preview;
    final brand = context.brand;
    final store = product == null ? null : _storeFor(product);
    final menuStoreId = store?.id ?? activeStoreId;
    final menu = menuStoreId == null ? null : ref.watch(menuProvider(menuStoreId)).valueOrNull?.value;
    final kind = preview == null ? null : productKindOf(preview, menu: menu);
    final groups = orderOptionGroups(product?.optionGroups ?? const []);
    final catalog = groups.isNotEmpty;
    final summary = catalog
        ? describeOptionLines(optionLinesFor(groups, _picks))
        : optionsSummary(product, _variations.values, _modifiers, onlyChoices: true);
    final pickErrors = catalog ? validateOptionPicks(groups, _picks) : const <OptionPickError>[];
    final hint = optionsHint(AppLocalizations.of(context), groups, pickErrors);
    // No photo, no picture: the screen starts with the name under a plain
    // bar instead of a stand-in image.
    final photo = preview?.imageUrl;
    final hasPhoto = ProductImage.isUsable(photo);

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: hasPhoto ? MediaQuery.sizeOf(context).width * 0.92 : null,
            pinned: true,
            stretch: hasPhoto,
            backgroundColor: brand.cream,
            leading: Padding(
              padding: const EdgeInsets.all(8),
              child: IconButton.filled(
                style: IconButton.styleFrom(
                  backgroundColor: brand.foam.withValues(alpha: 0.92),
                  foregroundColor: brand.textPrimary,
                ),
                tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
                icon: const Icon(Icons.close_rounded),
                onPressed: () => context.pop(),
              ),
            ),
            flexibleSpace: hasPhoto
                ? FlexibleSpaceBar(
                    background: Hero(
                      tag: productHeroTag(widget.productId),
                      child: ProductImage(url: photo, seed: widget.productId),
                    ),
                  )
                : null,
          ),
          SliverToBoxAdapter(
            child: Container(
              // Over a photo the details ride up onto it on a rounded sheet.
              decoration: hasPhoto
                  ? BoxDecoration(
                      color: brand.cream,
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
                    )
                  : null,
              transform: hasPhoto ? Matrix4.translationValues(0, -24, 0) : null,
              padding: EdgeInsets.fromLTRB(20, hasPhoto ? 24 : 8, 20, 0),
              child: async.hasError && preview == null
                  ? ErrorState(error: async.error!, onRetry: () => ref.invalidate(storeProductProvider(key)))
                  : _Details(
                      preview: preview,
                      product: product,
                      kind: kind,
                      summary: summary,
                      currency: store?.currency ?? ref.watch(activeStoreProvider)?.currency ?? 'USD',
                      variations: _variations,
                      modifiers: _modifiers,
                      expanded: _expanded,
                      onVariation: (type, id) => setState(() => _variations[type] = id),
                      onModifier: (id, count) => setState(() => _modifiers[id] = count),
                      onToggleGroup: _toggleGroup,
                      optionGroups: groups,
                      picks: _picks,
                      missingGroups: missingOptionGroups(pickErrors),
                      onTogglePick: (id) => _togglePick(product!, id),
                      onPickQty: (id, qty) => _setPickQty(product!, id, qty),
                      notes: _notes,
                      showNotes: _showNotes,
                      onShowNotes: () => setState(() => _showNotes = true),
                      pairing: _pairing(product?.id ?? widget.productId, kind, store, menu),
                    ),
            ),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 120)),
        ],
      ),
      bottomNavigationBar: product == null
          ? null
          : _BottomBar(
              product: product,
              store: store,
              quantity: _quantity,
              unitPrice: _unitPrice(product),
              summary: summary,
              hint: hint,
              adding: _adding,
              onQuantity: (q) => setState(() => _quantity = q),
              onAdd: store == null || product.onStopList || !store.takesOrders || hint != null
                  ? null
                  : () => _add(product, store),
            ),
    );
  }

  /// Under the product, while the store takes orders: «Часто берут вместе»
  /// — what its customers bought together with this product — else, under a
  /// drink, «К этому напитку» with something to eat from the same store.
  /// Nothing until the store has answered.
  Widget? _pairing(String productId, ProductKind? kind, Store? store, Menu? menu) {
    if (store == null || !store.takesOrders || menu == null) return null;
    final asked = ref.watch(storeSuggestionsProvider(suggestionsKey(store.id, [productId])));
    if (!asked.hasValue) return null;
    final together = boughtTogether(menu, asked.value, exclude: {productId});
    final items = together.isNotEmpty
        ? together
        : (kind?.isDrink ?? false)
        ? foodSuggestions(menu, exclude: {productId})
        : const <Suggestion>[];
    if (items.isEmpty) return null;
    final l10n = AppLocalizations.of(context);
    return UpsellRow(
      title: together.isNotEmpty ? l10n.upsellTogether : l10n.productPairsWith,
      items: items,
      store: store,
      onAdded: (added) => Snack.show(context, l10n.addedToCart(added.name), icon: Icons.check_circle_rounded),
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({
    required this.preview,
    required this.product,
    required this.kind,
    required this.summary,
    required this.currency,
    required this.variations,
    required this.modifiers,
    required this.expanded,
    required this.onVariation,
    required this.onModifier,
    required this.onToggleGroup,
    required this.optionGroups,
    required this.picks,
    required this.missingGroups,
    required this.onTogglePick,
    required this.onPickQty,
    required this.notes,
    required this.showNotes,
    required this.onShowNotes,
    required this.pairing,
  });

  final Product? preview;
  final ProductDetail? product;
  final ProductKind? kind;

  /// The chosen options in a line, empty when there is nothing to choose.
  final String summary;
  final String currency;
  final Map<VariationType, String> variations;
  final Map<String, int> modifiers;
  final Set<String> expanded;
  final void Function(VariationType type, String id) onVariation;
  final void Function(String id, int count) onModifier;
  final ValueChanged<String> onToggleGroup;

  /// The product's catalog groups, variants first; empty for a product on
  /// the older options.
  final List<ProductOptionGroup> optionGroups;
  final OptionPicks picks;

  /// Groups still to choose from, marked «обязательно».
  final Set<String> missingGroups;
  final ValueChanged<String> onTogglePick;
  final void Function(String optionId, int qty) onPickQty;
  final TextEditingController notes;
  final bool showNotes;
  final VoidCallback onShowNotes;
  final Widget? pairing;

  /// A drink by its category; on an API without kinds, anything with a size,
  /// temperature, milk or cup to choose. (The caffeine level used to count
  /// too; it left the menu on 2026-11-05.)
  bool get _isDrink {
    final known = kind;
    if (known != null) return known.isDrink;
    return product?.variations.isNotEmpty ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final p = product ?? preview;
    final drink = _isDrink;
    // A meal's calories and nutrition; a drink or a pastry shows none, even
    // from an API that still sends them. Unknown kind (an API without kinds): none.
    final nutrition = kind?.showsNutrition ?? false;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (p == null) ...[
          const ShimmerScope(child: Skeleton(width: 220, height: 28)),
        ] else ...[
          Text(p.name, style: context.text.displaySmall),
          AnimatedSize(
            duration: Motion.medium,
            curve: Motion.emphasized,
            alignment: Alignment.topLeft,
            child: summary.isEmpty
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      summary,
                      key: const ValueKey('product-summary'),
                      style: context.text.bodyLarge?.copyWith(color: brand.caramel),
                    ),
                  ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (p.prepTimeSeconds > 0)
                _MetaChip(icon: Icons.timer_outlined, label: l10n.minutes(minutesCeil(p.prepTimeSeconds))),
              if (nutrition && p.calories != null)
                _MetaChip(icon: Icons.local_fire_department_outlined, label: l10n.productCalories(p.calories!)),
            ],
          ),
          if (p.description != null && p.description!.trim().isNotEmpty) ...[
            const SizedBox(height: 14),
            Text(p.description!, style: context.text.bodyLarge?.copyWith(color: brand.textSecondary)),
          ],
          if (nutrition && p.hasNutrition) ...[
            const SizedBox(height: 10),
            Text(
              l10n.productNutrition(_grams(p.proteinsGrams), _grams(p.fatsGrams), _grams(p.carbsGrams)),
              style: context.text.bodySmall,
            ),
          ],
        ],
        const SizedBox(height: 4),
        if (product == null)
          const ShimmerScope(
            child: Padding(
              padding: EdgeInsets.only(top: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Skeleton(width: 80),
                  SizedBox(height: 12),
                  Skeleton(height: 44, radius: Radii.pill),
                  SizedBox(height: 24),
                  Skeleton(height: 52, radius: Radii.input),
                ],
              ),
            ),
          )
        else ...[
          // A group shown by a condition (ice for an iced coffee) slides in
          // and out as the condition changes.
          for (final group in optionGroups)
            AnimatedSize(
              key: ValueKey('group-${group.id}'),
              duration: Motion.medium,
              curve: Motion.emphasized,
              alignment: Alignment.topCenter,
              child: isGroupVisible(group, optionGroups, picks)
                  ? OptionGroupSection(
                      group: group,
                      picks: picks,
                      currency: currency,
                      missing: missingGroups.contains(group.id),
                      onToggle: onTogglePick,
                      onQty: onPickQty,
                    )
                  : const SizedBox(width: double.infinity),
            ),
          for (final type in variationOrder)
            if (variationsOf(product!, type) case final options when options.isNotEmpty)
              VariationChips(
                title: _variationTitle(l10n, type),
                options: options,
                selected: variations[type],
                currency: currency,
                onSelect: (id) => onVariation(type, id),
              ),
          if (product!.modifiers.isNotEmpty) ...[
            const SizedBox(height: 20),
            for (final group in addonGroups(product!))
              AddonGroupTile(
                key: ValueKey('addons-${group.key}'),
                group: group,
                counts: modifiers,
                currency: currency,
                expanded: expanded.contains(group.key),
                onToggle: () => onToggleGroup(group.key),
                onChanged: onModifier,
              ),
          ],
          const SizedBox(height: 12),
          AnimatedSwitcher(
            duration: Motion.medium,
            child: showNotes
                ? TextField(
                    key: const ValueKey('notes'),
                    controller: notes,
                    autofocus: true,
                    maxLength: 200,
                    minLines: 2,
                    maxLines: 4,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      labelText: drink ? l10n.productNote : l10n.productNoteFood,
                      hintText: drink ? l10n.productNoteHint : l10n.productNoteFoodHint,
                    ),
                  )
                : Align(
                    key: const ValueKey('notes-button'),
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: onShowNotes,
                      icon: const Icon(Icons.edit_note_rounded),
                      label: Text(drink ? l10n.productNote : l10n.productNoteFood),
                    ),
                  ),
          ),
          if (pairing != null) ...[const SizedBox(height: 20), pairing!],
        ],
      ],
    );
  }

  static String _grams(double? value) {
    if (value == null) return '—';
    return value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toStringAsFixed(1);
  }

  static String _variationTitle(AppLocalizations l10n, VariationType type) => switch (type) {
    VariationType.size => l10n.variationSize,
    VariationType.temperature => l10n.variationTemperature,
    VariationType.milk => l10n.variationMilk,
    VariationType.cup => l10n.variationCup,
    VariationType.unknown => l10n.variationOther,
  };
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: brand.latte.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: brand.textSecondary),
          const SizedBox(width: 5),
          Text(label, style: context.text.labelMedium?.copyWith(color: brand.textPrimary)),
        ],
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  const _BottomBar({
    required this.product,
    required this.store,
    required this.quantity,
    required this.unitPrice,
    required this.summary,
    required this.hint,
    required this.adding,
    required this.onQuantity,
    required this.onAdd,
  });

  final ProductDetail product;
  final Store? store;
  final int quantity;
  final int unitPrice;

  /// The chosen options, so what goes into the cart is in view by the button.
  final String summary;

  /// What is still to choose before the button works (see [optionsHint]);
  /// shown in place of [summary].
  final String? hint;
  final bool adding;
  final ValueChanged<int> onQuantity;
  final VoidCallback? onAdd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final currency = store?.currency ?? 'USD';

    return Container(
      padding: EdgeInsets.fromLTRB(16, 10, 16, 12 + MediaQuery.paddingOf(context).bottom),
      decoration: BoxDecoration(
        color: brand.foam,
        border: Border(top: BorderSide(color: brand.borderLight)),
        boxShadow: brand.liftedShadow,
      ),
      child: store == null
          ? Text(l10n.productNoStore, textAlign: TextAlign.center, style: context.text.bodyMedium)
          : !store!.takesOrders
          ? Text(
              l10n.storeClosedNoOrders,
              textAlign: TextAlign.center,
              style: context.text.bodyMedium?.copyWith(color: brand.berry),
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AnimatedSize(
                  duration: Motion.medium,
                  curve: Motion.emphasized,
                  alignment: Alignment.bottomLeft,
                  child: product.onStopList
                      ? const SizedBox(width: double.infinity)
                      : hint != null
                      ? Padding(
                          padding: const EdgeInsets.only(bottom: 8, left: 4, right: 4),
                          child: Text(
                            hint!,
                            key: const ValueKey('bar-hint'),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: context.text.bodySmall?.copyWith(color: brand.caramel, fontWeight: FontWeight.w600),
                          ),
                        )
                      : summary.isEmpty
                      ? const SizedBox(width: double.infinity)
                      : Padding(
                          padding: const EdgeInsets.only(bottom: 8, left: 4, right: 4),
                          child: Text(
                            summary,
                            key: const ValueKey('bar-summary'),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.text.bodySmall?.copyWith(color: brand.textSecondary),
                          ),
                        ),
                ),
                Row(
                  children: [
                    QuantityStepper(value: quantity, min: 1, max: 20, onChanged: onQuantity),
                    const SizedBox(width: 12),
                    Expanded(
                      child: product.onStopList
                          ? FilledButton(onPressed: null, child: Text(l10n.soldOut))
                          : PrimaryButton(
                              label: l10n.quickAdd,
                              loading: adding,
                              onPressed: onAdd,
                              trailing: AnimatedMoney(
                                cents: unitPrice * quantity,
                                currency: currency,
                                style: context.text.labelLarge!.copyWith(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}
