import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/format/time.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/chips.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/product_image.dart';
import '../../shared/widgets/quantity_stepper.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../auth/sign_in_sheet.dart';
import '../cart/cart_controller.dart';
import '../catalog/catalog_providers.dart';
import '../menu/product_card.dart';

const _variationOrder = [
  VariationType.size,
  VariationType.temperature,
  VariationType.milk,
  VariationType.cup,
  VariationType.unknown,
];

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
  final _notes = TextEditingController();
  int _quantity = 1;
  bool _initialised = false;
  bool _adding = false;
  bool _showNotes = false;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  void _initDefaults(ProductDetail product) {
    if (_initialised) return;
    _initialised = true;
    for (final type in _variationOrder) {
      final group = product.variations.where((v) => v.type == type).toList()
        ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      if (group.isEmpty) continue;
      _variations[type] = (group.firstWhere((v) => v.isDefault, orElse: () => group.first)).id;
    }
    for (final m in product.modifiers) {
      _modifiers[m.id] = m.minCount;
    }
  }

  int _unitPrice(ProductDetail product) {
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
    if (_adding) return;
    if (!await ensureSignedIn(context, ref)) return;
    setState(() => _adding = true);
    try {
      await ref
          .read(cartProvider(store.id).notifier)
          .add(
            productId: product.id,
            quantity: _quantity,
            variationIds: _variations.values.toList(),
            modifiers: _modifiers,
            notes: _notes.text,
          );
      unawaited(HapticFeedback.mediumImpact());
      // Back to the menu, where the cart bar acknowledges the add.
      if (mounted) context.pop();
    } on Object catch (error) {
      if (mounted) {
        setState(() => _adding = false);
        Snack.error(context, error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(productDetailProvider(widget.productId));
    final product = async.valueOrNull;
    if (product != null) _initDefaults(product);
    final preview = product ?? widget.preview;
    final brand = context.brand;
    final store = product == null ? null : _storeFor(product);

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: MediaQuery.sizeOf(context).width * 0.92,
            pinned: true,
            stretch: true,
            backgroundColor: brand.cream,
            leading: Padding(
              padding: const EdgeInsets.all(8),
              child: IconButton.filled(
                style: IconButton.styleFrom(
                  backgroundColor: brand.foam.withValues(alpha: 0.92),
                  foregroundColor: brand.textPrimary,
                ),
                icon: const Icon(Icons.close_rounded),
                onPressed: () => context.pop(),
              ),
            ),
            flexibleSpace: FlexibleSpaceBar(
              background: Hero(
                tag: productHeroTag(widget.productId),
                child: ProductImage(url: preview?.imageUrl, seed: widget.productId),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Container(
              decoration: BoxDecoration(
                color: brand.cream,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
              ),
              transform: Matrix4.translationValues(0, -24, 0),
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 0),
              child: async.hasError && preview == null
                  ? ErrorState(
                      error: async.error!,
                      onRetry: () => ref.invalidate(productDetailProvider(widget.productId)),
                    )
                  : _Details(
                      preview: preview,
                      product: product,
                      currency: store?.currency ?? ref.watch(activeStoreProvider)?.currency ?? 'USD',
                      variations: _variations,
                      modifiers: _modifiers,
                      onVariation: (type, id) {
                        HapticFeedback.selectionClick();
                        setState(() => _variations[type] = id);
                      },
                      onModifier: (id, count) => setState(() => _modifiers[id] = count),
                      notes: _notes,
                      showNotes: _showNotes,
                      onShowNotes: () => setState(() => _showNotes = true),
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
              adding: _adding,
              onQuantity: (q) => setState(() => _quantity = q),
              onAdd: store == null || product.onStopList ? null : () => _add(product, store),
            ),
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({
    required this.preview,
    required this.product,
    required this.currency,
    required this.variations,
    required this.modifiers,
    required this.onVariation,
    required this.onModifier,
    required this.notes,
    required this.showNotes,
    required this.onShowNotes,
  });

  final Product? preview;
  final ProductDetail? product;
  final String currency;
  final Map<VariationType, String> variations;
  final Map<String, int> modifiers;
  final void Function(VariationType type, String id) onVariation;
  final void Function(String id, int count) onModifier;
  final TextEditingController notes;
  final bool showNotes;
  final VoidCallback onShowNotes;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final p = product ?? preview;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (p == null) ...[
          const ShimmerScope(child: Skeleton(width: 220, height: 28)),
        ] else ...[
          Text(p.name, style: context.text.displaySmall),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (p.prepTimeSeconds > 0)
                _MetaChip(icon: Icons.timer_outlined, label: l10n.minutes(minutesCeil(p.prepTimeSeconds))),
              if (p.calories != null)
                _MetaChip(icon: Icons.local_fire_department_outlined, label: l10n.productCalories(p.calories!)),
              if (p.caffeineLevel != null && p.caffeineLevel! > 0) _CaffeineChip(level: p.caffeineLevel!),
              for (final tag in p.dietTags)
                _MetaChip(icon: Icons.eco_outlined, label: dietTagLabel(l10n, tag), tint: brand.mint),
            ],
          ),
          if (p.description != null && p.description!.trim().isNotEmpty) ...[
            const SizedBox(height: 14),
            Text(p.description!, style: context.text.bodyLarge?.copyWith(color: brand.textSecondary)),
          ],
          if (p.hasNutrition) ...[
            const SizedBox(height: 10),
            Text(
              l10n.productNutrition(_grams(p.proteinsGrams), _grams(p.fatsGrams), _grams(p.carbsGrams)),
              style: context.text.bodySmall,
            ),
          ],
          if (p.allergens.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('${l10n.productAllergens}: ${p.allergens.join(', ')}', style: context.text.bodySmall),
          ],
        ],
        const SizedBox(height: 8),
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
                  Skeleton(width: 100),
                  SizedBox(height: 12),
                  Skeleton(height: 56, radius: Radii.input),
                ],
              ),
            ),
          )
        else ...[
          for (final type in _variationOrder)
            if (product!.variations.any((v) => v.type == type))
              _VariationGroup(
                title: _variationTitle(l10n, type),
                options: product!.variations.where((v) => v.type == type).toList()
                  ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder)),
                selected: variations[type],
                currency: currency,
                segmented: type == VariationType.size,
                onSelect: (id) => onVariation(type, id),
              ),
          if (product!.modifiers.isNotEmpty) ...[
            _SectionTitle(l10n.productAddons),
            for (final m in [...product!.modifiers]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder)))
              _ModifierRow(
                modifier: m,
                count: modifiers[m.id] ?? m.minCount,
                currency: currency,
                onChanged: (count) => onModifier(m.id, count),
              ),
          ],
          const SizedBox(height: 16),
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
                    decoration: InputDecoration(labelText: l10n.productNote, hintText: l10n.productNoteHint),
                  )
                : Align(
                    key: const ValueKey('notes-button'),
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: onShowNotes,
                      icon: const Icon(Icons.edit_note_rounded),
                      label: Text(l10n.productNote),
                    ),
                  ),
          ),
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

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 22, bottom: 10),
    child: Text(text, style: context.text.titleMedium),
  );
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label, this.tint});

  final IconData icon;
  final String label;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final color = tint ?? brand.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: (tint ?? brand.latte).withValues(alpha: tint == null ? 0.6 : 0.16),
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 5),
          Text(label, style: context.text.labelMedium?.copyWith(color: brand.textPrimary)),
        ],
      ),
    );
  }
}

class _CaffeineChip extends StatelessWidget {
  const _CaffeineChip({required this.level});

  final int level;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Tooltip(
      message: AppLocalizations.of(context).productCaffeine,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: brand.latte.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(Radii.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < 4; i++)
              Icon(Icons.coffee_rounded, size: 15, color: i < level ? brand.caramel : brand.border),
          ],
        ),
      ),
    );
  }
}

class _VariationGroup extends StatelessWidget {
  const _VariationGroup({
    required this.title,
    required this.options,
    required this.selected,
    required this.currency,
    required this.segmented,
    required this.onSelect,
  });

  final String title;
  final List<Variation> options;
  final String? selected;
  final String currency;
  final bool segmented;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;

    Widget option(Variation v) {
      final active = v.id == selected;
      final delta = v.priceDeltaCents;
      return Pressable(
        onTap: () => onSelect(v.id),
        child: AnimatedContainer(
          duration: Motion.medium,
          curve: Motion.emphasized,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: active ? brand.caramel : brand.foam,
            borderRadius: BorderRadius.circular(segmented ? Radii.button : Radii.pill),
            border: Border.all(color: active ? brand.caramel : brand.border),
            boxShadow: active
                ? [BoxShadow(color: brand.caramel.withValues(alpha: 0.25), blurRadius: 12, offset: const Offset(0, 4))]
                : null,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                v.name,
                textAlign: TextAlign.center,
                style: context.text.labelLarge?.copyWith(color: active ? Colors.white : brand.textPrimary),
              ),
              if (delta != 0)
                Text(
                  '${delta > 0 ? '+' : '−'}${context.money(delta.abs(), currency)}',
                  style: context.text.labelSmall?.copyWith(
                    color: active ? Colors.white.withValues(alpha: 0.85) : brand.textTertiary,
                  ),
                ),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionTitle(title),
        if (segmented && options.length <= 4)
          Row(
            children: [
              for (var i = 0; i < options.length; i++) ...[
                if (i > 0) const SizedBox(width: 8),
                Expanded(child: option(options[i])),
              ],
            ],
          )
        else
          Wrap(spacing: 8, runSpacing: 8, children: [for (final v in options) option(v)]),
      ],
    );
  }
}

class _ModifierRow extends StatelessWidget {
  const _ModifierRow({required this.modifier, required this.count, required this.currency, required this.onChanged});

  final Modifier modifier;
  final int count;
  final String currency;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final l10n = AppLocalizations.of(context);
    final active = count > 0;
    final details = [
      if (modifier.priceDeltaCents > 0) '+${context.money(modifier.priceDeltaCents, currency)}',
      if (modifier.maxCount > 1) l10n.productAddonLimit(modifier.maxCount),
    ].join(' · ');

    return AnimatedContainer(
      duration: Motion.medium,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(
        color: active ? brand.caramelSoft : brand.foam,
        borderRadius: BorderRadius.circular(Radii.input),
        border: Border.all(color: active ? brand.caramel.withValues(alpha: 0.5) : brand.borderLight),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(modifier.name, style: context.text.bodyLarge),
                if (details.isNotEmpty) Text(details, style: context.text.bodySmall),
              ],
            ),
          ),
          if (modifier.maxCount <= 1)
            Switch(
              value: active,
              onChanged: modifier.minCount >= 1
                  ? null
                  : (on) {
                      HapticFeedback.selectionClick();
                      onChanged(on ? 1 : 0);
                    },
            )
          else
            QuantityStepper(
              value: count,
              min: modifier.minCount,
              max: modifier.maxCount,
              compact: true,
              onChanged: onChanged,
            ),
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
    required this.adding,
    required this.onQuantity,
    required this.onAdd,
  });

  final ProductDetail product;
  final Store? store;
  final int quantity;
  final int unitPrice;
  final bool adding;
  final ValueChanged<int> onQuantity;
  final VoidCallback? onAdd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final currency = store?.currency ?? 'USD';

    return Container(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.paddingOf(context).bottom),
      decoration: BoxDecoration(
        color: brand.foam,
        border: Border(top: BorderSide(color: brand.borderLight)),
        boxShadow: brand.liftedShadow,
      ),
      child: store == null
          ? Text(l10n.productNoStore, textAlign: TextAlign.center, style: context.text.bodyMedium)
          : Row(
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
                            style: context.text.labelLarge!.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
                          ),
                        ),
                ),
              ],
            ),
    );
  }
}
