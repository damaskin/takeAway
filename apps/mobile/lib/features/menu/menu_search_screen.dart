import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/product_image.dart';
import '../../shared/widgets/state_views.dart';

/// Instant, offline search over the loaded menu — names, descriptions and
/// category names, case- and accent-insensitive enough for RU and EN.
class MenuSearchScreen extends StatefulWidget {
  const MenuSearchScreen({required this.menu, required this.store, super.key});

  final Menu menu;
  final Store store;

  @override
  State<MenuSearchScreen> createState() => _MenuSearchScreenState();
}

class _MenuSearchScreenState extends State<MenuSearchScreen> {
  final _query = TextEditingController();
  List<(Product, String)> _all = const [];

  @override
  void initState() {
    super.initState();
    _all = [
      for (final category in widget.menu.visibleCategories)
        for (final product in category.products) (product, category.name),
    ];
    _query.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  static String _fold(String s) => s.toLowerCase().replaceAll('ё', 'е').trim();

  List<(Product, String)> get _results {
    final terms = _fold(_query.text).split(RegExp(r'\s+')).where((t) => t.isNotEmpty).toList();
    if (terms.isEmpty) return const [];
    return _all.where((entry) {
      final (product, category) = entry;
      final haystack = _fold('${product.name} ${product.description ?? ''} $category');
      return terms.every(haystack.contains);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final results = _results;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: TextField(
          controller: _query,
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: l10n.menuSearchHint,
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: _query.text.isEmpty
                ? null
                : IconButton(icon: const Icon(Icons.close_rounded), onPressed: _query.clear),
            contentPadding: const EdgeInsets.symmetric(vertical: 10),
          ),
        ),
        actions: const [SizedBox(width: 12)],
      ),
      body: _query.text.trim().isEmpty
          ? const SizedBox.shrink()
          : results.isEmpty
          ? EmptyState(icon: Icons.search_off_rounded, title: l10n.menuNoResults(_query.text.trim()), compact: true)
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              itemCount: results.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final (product, category) = results[index];
                return Pressable(
                  onTap: () {
                    Navigator.of(context).pop();
                    context.push(Routes.product(product.id), extra: product);
                  },
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: brand.foam,
                      borderRadius: BorderRadius.circular(Radii.card),
                      border: Border.all(color: brand.borderLight),
                    ),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 64,
                          height: 64,
                          child: ProductImage(
                            url: product.imageUrl,
                            seed: product.id,
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(product.name, style: context.text.titleSmall, maxLines: 2),
                              const SizedBox(height: 2),
                              Text(category, style: context.text.bodySmall),
                            ],
                          ),
                        ),
                        Text(
                          product.onStopList
                              ? l10n.soldOut
                              : context.money(product.basePriceCents, widget.store.currency),
                          style: context.text.titleSmall?.copyWith(
                            color: product.onStopList ? brand.textTertiary : brand.textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}
