import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../core/providers.dart';
import '../core/storage/app_prefs.dart';
import '../core/theme/tokens.dart';
import '../features/cart/cart_screen.dart';
import '../features/checkout/checkout_screen.dart';
import '../features/menu/menu_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/orders/order_status_screen.dart';
import '../features/orders/orders_screen.dart';
import '../features/product/product_screen.dart';
import '../features/profile/about_screen.dart';
import '../features/profile/gift_cards_screen.dart';
import '../features/profile/loyalty_screen.dart';
import '../features/profile/notifications_screen.dart';
import '../features/profile/payment_methods_screen.dart';
import '../features/profile/personal_info_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/profile/referrals_screen.dart';
import '../features/stores/stores_screen.dart';
import 'app_shell.dart';

final rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');

abstract final class Routes {
  static const welcome = '/welcome';
  static const menu = '/menu';
  static const stores = '/stores';
  static const orders = '/orders';
  static const profile = '/profile';
  static const cart = '/cart';
  static const checkout = '/checkout';

  static String product(String id) => '/product/$id';
  static String order(String id, {bool placed = false}) => placed ? '/order/$id?placed=1' : '/order/$id';
  static const personal = '/profile/personal';
  static const notifications = '/profile/notifications';
  static const loyalty = '/profile/loyalty';
  static const referrals = '/profile/referrals';
  static const giftCards = '/profile/gift-cards';
  static const paymentMethods = '/profile/payment-methods';
  static const about = '/profile/about';
}

/// Screens that only make sense with an account; signing out on one of
/// them lands on the profile tab, which offers to sign in again.
const _signedInOnly = [
  Routes.checkout,
  '/order/',
  Routes.personal,
  Routes.notifications,
  Routes.loyalty,
  Routes.referrals,
  Routes.giftCards,
  Routes.paymentMethods,
];

final routerProvider = Provider<GoRouter>((ref) {
  final sessions = ref.watch(sessionManagerProvider);
  final onboarded = ref.read(onboardingDoneProvider);

  final router = GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: onboarded ? Routes.menu : Routes.welcome,
    refreshListenable: sessions,
    redirect: (context, state) {
      final path = state.uri.path;
      if (!sessions.isSignedIn && _signedInOnly.any(path.startsWith)) return Routes.profile;
      if (!sessions.isSignedIn && path == Routes.cart) return Routes.menu;
      return null;
    },
    routes: [
      GoRoute(path: Routes.welcome, pageBuilder: (context, state) => _fade(state, const OnboardingScreen())),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.menu, builder: (context, state) => const MenuScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.stores, builder: (context, state) => const StoresScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: Routes.orders, builder: (context, state) => const OrdersScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: Routes.profile,
                builder: (context, state) => const ProfileScreen(),
                routes: [
                  GoRoute(path: 'personal', builder: (context, state) => const PersonalInfoScreen()),
                  GoRoute(path: 'notifications', builder: (context, state) => const NotificationsScreen()),
                  GoRoute(path: 'loyalty', builder: (context, state) => const LoyaltyScreen()),
                  GoRoute(path: 'referrals', builder: (context, state) => const ReferralsScreen()),
                  GoRoute(path: 'gift-cards', builder: (context, state) => const GiftCardsScreen()),
                  GoRoute(path: 'payment-methods', builder: (context, state) => const PaymentMethodsScreen()),
                  GoRoute(path: 'about', builder: (context, state) => const AboutScreen()),
                ],
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/product/:id',
        parentNavigatorKey: rootNavigatorKey,
        pageBuilder: (context, state) => _slideUp(
          state,
          ProductScreen(
            productId: state.pathParameters['id']!,
            preview: state.extra is Product ? state.extra! as Product : null,
          ),
        ),
      ),
      GoRoute(path: Routes.cart, parentNavigatorKey: rootNavigatorKey, builder: (context, state) => const CartScreen()),
      GoRoute(
        path: Routes.checkout,
        parentNavigatorKey: rootNavigatorKey,
        builder: (context, state) => const CheckoutScreen(),
      ),
      GoRoute(
        path: '/order/:id',
        parentNavigatorKey: rootNavigatorKey,
        pageBuilder: (context, state) => _fade(
          state,
          OrderStatusScreen(
            orderId: state.pathParameters['id']!,
            justPlaced: state.uri.queryParameters['placed'] == '1',
          ),
        ),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

CustomTransitionPage<void> _fade(GoRouterState state, Widget child) => CustomTransitionPage<void>(
  key: state.pageKey,
  child: child,
  transitionDuration: Motion.slow,
  reverseTransitionDuration: Motion.medium,
  transitionsBuilder: (context, animation, secondary, child) => FadeTransition(
    opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
    child: ScaleTransition(
      scale: Tween(begin: 0.98, end: 1.0).animate(CurvedAnimation(parent: animation, curve: Motion.emphasized)),
      child: child,
    ),
  ),
);

/// Product detail rises from the bottom like a sheet — it is a quick
/// detour from the menu, and swiping down (or back) returns there.
CustomTransitionPage<void> _slideUp(GoRouterState state, Widget child) => CustomTransitionPage<void>(
  key: state.pageKey,
  child: child,
  transitionDuration: const Duration(milliseconds: 380),
  reverseTransitionDuration: const Duration(milliseconds: 280),
  transitionsBuilder: (context, animation, secondary, child) {
    final curved = CurvedAnimation(parent: animation, curve: Motion.emphasized, reverseCurve: Curves.easeInCubic);
    return SlideTransition(
      position: Tween(begin: const Offset(0, 0.12), end: Offset.zero).animate(curved),
      child: FadeTransition(opacity: curved, child: child),
    );
  },
);
