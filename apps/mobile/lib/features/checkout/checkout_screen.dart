import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/format/tax.dart';
import '../../core/format/time.dart';
import '../../core/providers.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/error_message.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/state_views.dart';
import '../cart/cart_controller.dart';
import '../catalog/catalog_providers.dart';
import '../profile/profile_providers.dart';
import '../stores/store_widgets.dart';
import 'checkout_controller.dart';
import 'checkout_sections.dart';

class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  late final TextEditingController _name;
  late final TextEditingController _phone;
  final _notes = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _deliveryNotes = TextEditingController();
  CheckoutProblem? _problem;

  /// The cart as it was before the order was placed. The server empties the
  /// cart the moment the order exists; if the card is then declined, the
  /// customer is still looking at the same order and retries from here.
  Cart? _snapshot;

  @override
  void initState() {
    super.initState();
    final user = ref.read(currentUserProvider);
    final remembered = ref.read(contactPrefsProvider);
    _name = TextEditingController(text: remembered.name ?? user?.name ?? '');
    _phone = TextEditingController(text: remembered.phone ?? user?.phone ?? '');
  }

  @override
  void dispose() {
    for (final c in [_name, _phone, _notes, _address, _city, _deliveryNotes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    setState(() => _problem = null);
    final controller = ref.read(checkoutProvider.notifier);
    final router = GoRouter.of(context);
    try {
      final orderId = await controller.placeOrder(
        CheckoutForm(
          name: _name.text,
          phone: _phone.text,
          notes: _notes.text,
          address: _address.text,
          city: _city.text,
          deliveryNotes: _deliveryNotes.text,
        ),
      );
      if (orderId == null) {
        unawaited(HapticFeedback.heavyImpact());
        return;
      }
      unawaited(HapticFeedback.heavyImpact());
      router.go(Routes.menu);
      unawaited(router.push(Routes.order(orderId, placed: true)));
    } on CheckoutValidation catch (problem) {
      unawaited(HapticFeedback.vibrate());
      setState(() => _problem = problem.reason);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final store = ref.watch(activeStoreProvider);
    final live = ref.watch(activeCartProvider).valueOrNull;
    final placed = ref.watch(checkoutProvider.select((s) => s.placedOrderId)) != null;
    if (live != null && !live.isEmpty && !placed) _snapshot = live;
    final cart = placed ? _snapshot : live;

    if (store == null || cart == null || cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.checkoutTitle)),
        body: EmptyState(
          icon: Icons.shopping_bag_outlined,
          title: l10n.cartEmptyTitle,
          actionLabel: l10n.browseMenu,
          onAction: () => context.go(Routes.menu),
        ),
      );
    }

    final state = ref.watch(checkoutProvider);
    final controller = ref.read(checkoutProvider.notifier);
    final flags = ref.watch(featureFlagsProvider).valueOrNull ?? FeatureFlags.off;
    final breakdown = controller.breakdown(cart, store);
    final minOrder = ref.watch(storeDetailProvider(store.id)).valueOrNull?.minOrderCents ?? 0;
    final belowMinimum = minOrder > 0 && cart.subtotalCents < minOrder;
    final readyAt = state.mode == PickupMode.scheduled && state.slot != null
        ? state.slot!
        : DateTime.now().add(Duration(seconds: cart.etaSeconds));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.checkoutTitle)),
      body: GestureDetector(
        onTap: () => FocusScope.of(context).unfocus(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            _WhenSection(store: store, cart: cart, state: state, flags: flags, readyAt: readyAt, problem: _problem),
            if (state.fulfillment == FulfillmentType.delivery)
              _DeliverySection(
                state: state,
                currency: store.currency,
                address: _address,
                city: _city,
                notes: _deliveryNotes,
                problem: _problem,
              ),
            CheckoutSection(
              title: l10n.contactTitle,
              icon: Icons.person_outline_rounded,
              child: Column(
                children: [
                  TextField(
                    controller: _name,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.name],
                    decoration: InputDecoration(labelText: l10n.contactName),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.telephoneNumber],
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9+()\s-]')),
                      LengthLimitingTextInputFormatter(20),
                    ],
                    decoration: InputDecoration(labelText: l10n.contactPhone),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _notes,
                    maxLength: 500,
                    minLines: 1,
                    maxLines: 3,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(labelText: l10n.orderNotes, counterText: ''),
                  ),
                ],
              ),
            ),
            _DiscountsSection(state: state, currency: store.currency),
            _PaymentSection(state: state, flags: flags),
            _SummarySection(cart: cart, store: store, state: state, breakdown: breakdown),
            if (belowMinimum)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  l10n.minOrderNotice(context.money(minOrder, store.currency)),
                  textAlign: TextAlign.center,
                  style: context.text.bodyMedium?.copyWith(color: context.brand.berry),
                ),
              ),
          ],
        ),
      ),
      // The failure sits right above the button that caused it: a declined
      // card must be impossible to miss, wherever the form is scrolled.
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AnimatedSize(
              duration: Motion.medium,
              curve: Motion.emphasized,
              child: state.error == null
                  ? const SizedBox(width: double.infinity)
                  : Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: context.brand.berry.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(Radii.button),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.error_outline_rounded, color: context.brand.berry),
                          const SizedBox(width: 10),
                          Expanded(child: Text(errorMessage(context, state.error!), style: context.text.bodyMedium)),
                        ],
                      ),
                    ),
            ),
            PrimaryButton(
              loading: state.submitting,
              onPressed: belowMinimum ? null : _submit,
              label: state.placedOrderId != null && controller.payingByCard
                  ? l10n.retryPayment
                  : controller.payingByCard
                  ? l10n.placeOrderPay(context.money(breakdown.totalCents, store.currency))
                  : l10n.placeOrder(context.money(breakdown.totalCents, store.currency)),
              trailing: Text(
                formatClock(context, readyAt),
                style: context.text.labelLarge?.copyWith(color: Colors.white.withValues(alpha: 0.85)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WhenSection extends ConsumerWidget {
  const _WhenSection({
    required this.store,
    required this.cart,
    required this.state,
    required this.flags,
    required this.readyAt,
    required this.problem,
  });

  final Store store;
  final Cart cart;
  final CheckoutState state;
  final FeatureFlags flags;
  final DateTime readyAt;
  final CheckoutProblem? problem;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final controller = ref.read(checkoutProvider.notifier);
    final deliveryOffered = flags.deliveryEnabled && store.supportsDelivery;
    final delivery = state.fulfillment == FulfillmentType.delivery;

    return CheckoutSection(
      title: l10n.checkoutWhen,
      icon: Icons.schedule_rounded,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.storefront_rounded, size: 18, color: brand.textTertiary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  [store.name, ?displayAddress(store)].join(' · '),
                  style: context.text.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (deliveryOffered) ...[
            SegmentToggle<FulfillmentType>(
              value: state.fulfillment,
              options: [
                (FulfillmentType.pickup, l10n.fulfillmentPickup, Icons.shopping_bag_outlined),
                (FulfillmentType.delivery, l10n.fulfillmentDelivery, Icons.delivery_dining_outlined),
              ],
              onChanged: controller.setFulfillment,
            ),
            const SizedBox(height: 10),
          ],
          SegmentToggle<PickupMode>(
            value: state.mode,
            options: [
              (PickupMode.asap, l10n.pickupAsap, Icons.bolt_rounded),
              (PickupMode.scheduled, l10n.pickupLater, Icons.event_rounded),
            ],
            disabled: {if (!store.isOpen) PickupMode.asap},
            onChanged: controller.setMode,
          ),
          if (!store.isOpen)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(
                children: [
                  Icon(Icons.nightlight_round, size: 16, color: brand.berry),
                  const SizedBox(width: 8),
                  Expanded(child: Text(l10n.storeClosedBanner, style: context.text.bodySmall)),
                ],
              ),
            ),
          AnimatedSize(
            duration: Motion.medium,
            curve: Motion.emphasized,
            child: state.mode == PickupMode.scheduled
                ? Padding(
                    padding: const EdgeInsets.only(top: 14),
                    child: SlotPicker(storeId: store.id, selected: state.slot, onSelect: controller.selectSlot),
                  )
                : const SizedBox(width: double.infinity),
          ),
          if (problem == CheckoutProblem.pickSlot)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(l10n.pickupLaterHint, style: context.text.bodySmall?.copyWith(color: brand.berry)),
            ),
          const SizedBox(height: 16),
          AnimatedSwitcher(
            duration: Motion.medium,
            child: Text(
              key: ValueKey('${state.mode}${state.slot}$delivery'),
              delivery ? l10n.deliveryAt(formatClock(context, readyAt)) : l10n.readyBy(formatClock(context, readyAt)),
              style: context.text.headlineMedium?.copyWith(color: brand.caramel),
            ),
          ),
          if (state.mode == PickupMode.asap)
            Text(l10n.readyInMinutes(minutesCeil(cart.etaSeconds)), style: context.text.bodySmall),
        ],
      ),
    );
  }
}

class _DeliverySection extends ConsumerWidget {
  const _DeliverySection({
    required this.state,
    required this.currency,
    required this.address,
    required this.city,
    required this.notes,
    required this.problem,
  });

  final CheckoutState state;
  final String currency;
  final TextEditingController address;
  final TextEditingController city;
  final TextEditingController notes;
  final CheckoutProblem? problem;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final d = state.delivery;
    final locale = Localizations.localeOf(context).languageCode;

    return CheckoutSection(
      title: l10n.fulfillmentDelivery,
      icon: Icons.delivery_dining_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: address,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.streetAddressLine1],
            decoration: InputDecoration(
              labelText: l10n.deliveryAddress,
              hintText: l10n.deliveryAddressHint,
              errorText: problem == CheckoutProblem.deliveryAddress && address.text.trim().isEmpty
                  ? l10n.deliveryAddressRequired
                  : null,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: city,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.addressCity],
            decoration: InputDecoration(labelText: l10n.deliveryCity),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: notes,
            decoration: InputDecoration(labelText: l10n.deliveryNotes, hintText: l10n.deliveryNotesHint),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              TextButton.icon(
                onPressed: d.locating
                    ? null
                    : () async {
                        final problem = await ref.read(checkoutProvider.notifier).locateForDelivery();
                        if (problem != null && context.mounted) showLocationProblem(context, ref, problem);
                      },
                icon: d.locating
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.my_location_rounded),
                label: Text(l10n.deliveryUseLocation),
              ),
              const Spacer(),
              if (d.distanceM != null)
                Text(
                  l10n.deliveryDistance(formatDistance(d.distanceM!, locale: locale)),
                  style: context.text.bodySmall,
                ),
            ],
          ),
          if (d.outside)
            Text(l10n.deliveryOutside, style: context.text.bodySmall?.copyWith(color: brand.berry))
          else
            Text('${l10n.deliveryFee}: ${context.money(d.feeCents, currency)}', style: context.text.bodySmall),
        ],
      ),
    );
  }
}

class _DiscountsSection extends ConsumerWidget {
  const _DiscountsSection({required this.state, required this.currency});

  final CheckoutState state;
  final String currency;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final controller = ref.read(checkoutProvider.notifier);
    final balance = ref.watch(loyaltyProvider).valueOrNull?.pointsBalance ?? 0;
    final points = state.points;

    return CheckoutSection(
      title: l10n.discountsTitle,
      icon: Icons.local_offer_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CodeField(
            label: l10n.promoCode,
            icon: Icons.confirmation_number_outlined,
            state: state.promo,
            successText: state.promo.cents > 0
                ? l10n.promoApplied(context.money(state.promo.cents, currency))
                : state.promoMultiplier > 1
                ? l10n.promoPoints(state.promoMultiplier.toStringAsFixed(state.promoMultiplier % 1 == 0 ? 0 : 1))
                : null,
            onApply: controller.applyPromo,
            onClear: controller.clearPromo,
          ),
          const SizedBox(height: 12),
          CodeField(
            label: l10n.giftCard,
            icon: Icons.card_giftcard_rounded,
            state: state.giftCard,
            successText: l10n.giftCardApplied(context.money(state.giftCard.cents, currency)),
            onApply: controller.applyGiftCard,
            onClear: controller.clearGiftCard,
          ),
          if (balance > 0) ...[
            const SizedBox(height: 6),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: points.spent > 0,
              onChanged: points.busy ? null : (on) => on ? controller.applyPoints(balance) : controller.clearPoints(),
              title: Text(l10n.payWithPoints, style: context.text.titleSmall),
              subtitle: Text(
                points.spent > 0
                    ? l10n.pointsApplied(points.spent, context.money(points.cents, currency))
                    : points.message != null && points.message!.startsWith('min:')
                    ? l10n.pointsTooFew(points.min)
                    : points.message ?? l10n.pointsAvailable(balance),
                style: context.text.bodySmall?.copyWith(
                  color: points.spent > 0
                      ? brand.mint
                      : points.message != null
                      ? brand.berry
                      : brand.textSecondary,
                ),
              ),
              secondary: points.busy
                  ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                  : Icon(Icons.stars_rounded, color: brand.amber),
            ),
          ],
        ],
      ),
    );
  }
}

class _PaymentSection extends ConsumerWidget {
  const _PaymentSection({required this.state, required this.flags});

  final CheckoutState state;
  final FeatureFlags flags;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final controller = ref.read(checkoutProvider.notifier);
    final cards = flags.agroprombankEnabled
        ? (ref.watch(cardsProvider).valueOrNull ?? const <BoundCard>[])
        : const <BoundCard>[];
    final locked = state.placedOrderId != null;

    Widget option({
      required String? id,
      required IconData icon,
      required String title,
      String? subtitle,
      bool enabled = true,
    }) {
      final selected = state.cardId == id;
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Material(
          color: selected ? brand.caramelSoft : brand.cream,
          borderRadius: BorderRadius.circular(Radii.button),
          child: InkWell(
            borderRadius: BorderRadius.circular(Radii.button),
            onTap: enabled
                ? () {
                    HapticFeedback.selectionClick();
                    controller.selectCard(id);
                  }
                : null,
            child: AnimatedContainer(
              duration: Motion.medium,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(Radii.button),
                border: Border.all(color: selected ? brand.caramel : Colors.transparent, width: 1.4),
              ),
              child: Row(
                children: [
                  Icon(icon, color: enabled ? brand.textPrimary : brand.textTertiary),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: context.text.titleSmall?.copyWith(color: enabled ? null : brand.textTertiary),
                        ),
                        if (subtitle != null) Text(subtitle, style: context.text.bodySmall),
                      ],
                    ),
                  ),
                  AnimatedScale(
                    scale: selected ? 1 : 0,
                    duration: Motion.fast,
                    child: Icon(Icons.check_circle_rounded, color: brand.caramel),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return CheckoutSection(
      title: l10n.paymentTitle,
      icon: Icons.account_balance_wallet_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final card in cards)
            option(
              id: card.id,
              icon: Icons.credit_card_rounded,
              title: card.label ?? card.maskedPan ?? l10n.cardFallbackTitle,
              subtitle: card.isInactive
                  ? l10n.cardInactive
                  : [if (card.label != null) card.maskedPan, card.instituteName].whereType<String>().join(' · '),
              enabled: !card.isInactive,
            ),
          option(id: null, icon: Icons.storefront_outlined, title: l10n.payAtCounter, subtitle: l10n.payAtCounterHint),
          if (flags.agroprombankEnabled && !locked)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => context.push(Routes.paymentMethods),
                icon: const Icon(Icons.add_card_rounded),
                label: Text(l10n.addCard),
              ),
            ),
          if (flags.agroprombankEnabled && state.cardId != null) Text(l10n.holdHint, style: context.text.bodySmall),
        ],
      ),
    );
  }
}

class _SummarySection extends StatelessWidget {
  const _SummarySection({required this.cart, required this.store, required this.state, required this.breakdown});

  final Cart cart;
  final Store store;
  final CheckoutState state;
  final TaxBreakdown breakdown;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final currency = store.currency;
    final taxCents = breakdown.taxCents;
    final totalCents = breakdown.totalCents;

    return CheckoutSection(
      title: l10n.summaryTitle,
      icon: Icons.receipt_long_outlined,
      child: Column(
        children: [
          for (final item in cart.items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  Expanded(child: Text('${item.quantity} × ${item.productName}', style: context.text.bodyMedium)),
                  Text(context.money(item.lineTotalCents, currency), style: context.text.bodyMedium),
                ],
              ),
            ),
          const Divider(height: 20),
          SummaryLine(label: l10n.subtotal, cents: cart.subtotalCents, currency: currency),
          if (state.promo.ok && state.promo.cents > 0)
            SummaryLine(
              label: l10n.promoDiscount(state.promo.code!),
              cents: state.promo.cents,
              currency: currency,
              negative: true,
            ),
          if (state.points.cents > 0)
            SummaryLine(label: l10n.pointsDiscount, cents: state.points.cents, currency: currency, negative: true),
          if (state.fulfillment == FulfillmentType.delivery)
            SummaryLine(label: l10n.deliveryFee, cents: state.delivery.feeCents, currency: currency),
          if (state.giftCard.ok && state.giftCard.cents > 0)
            SummaryLine(label: l10n.giftCard, cents: state.giftCard.cents, currency: currency, negative: true),
          if (taxCents > 0)
            SummaryLine(
              label: store.taxIncludedInPrice ? l10n.taxIncluded : l10n.tax,
              cents: taxCents,
              currency: currency,
            ),
          const SizedBox(height: 6),
          SummaryLine(label: l10n.total, cents: totalCents, currency: currency, emphasized: true),
        ],
      ),
    );
  }
}
