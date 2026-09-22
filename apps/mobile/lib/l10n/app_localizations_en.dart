// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'takeAway';

  @override
  String get tagline => 'Pre-order. Skip the queue. Pick it up.';

  @override
  String get retry => 'Try again';

  @override
  String get cancel => 'Cancel';

  @override
  String get confirm => 'Confirm';

  @override
  String get save => 'Save';

  @override
  String get apply => 'Apply';

  @override
  String get remove => 'Remove';

  @override
  String get close => 'Close';

  @override
  String get done => 'Done';

  @override
  String get continueLabel => 'Continue';

  @override
  String get undo => 'Undo';

  @override
  String get loading => 'Loading…';

  @override
  String get genericError => 'Something went wrong. Please try again.';

  @override
  String get networkError => 'No connection. Check your internet and try again.';

  @override
  String get sessionExpired => 'Your session has expired. Please sign in again.';

  @override
  String get subtotal => 'Subtotal';

  @override
  String get total => 'Total';

  @override
  String get tax => 'Tax';

  @override
  String get taxIncluded => 'Incl. tax';

  @override
  String get deliveryFee => 'Delivery';

  @override
  String get soldOut => 'Sold out';

  @override
  String priceFrom(String price) {
    return 'from $price';
  }

  @override
  String minutes(int count) {
    return '$count min';
  }

  @override
  String readyInMinutes(int count) {
    return 'Ready in ~$count min';
  }

  @override
  String readyBy(String time) {
    return 'Ready by $time';
  }

  @override
  String itemsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count items', one: '1 item');
    return '$_temp0';
  }

  @override
  String get navMenu => 'Menu';

  @override
  String get navStores => 'Stores';

  @override
  String get navOrders => 'Orders';

  @override
  String get navProfile => 'Profile';

  @override
  String get onboardingTitle1 => 'Order ahead';

  @override
  String get onboardingBody1 => 'Choose your coffee or lunch in a couple of taps, wherever you are.';

  @override
  String get onboardingTitle2 => 'Timed to your arrival';

  @override
  String get onboardingBody2 => 'Pick ASAP or a time slot. The kitchen starts so it is fresh when you walk in.';

  @override
  String get onboardingTitle3 => 'Skip the queue';

  @override
  String get onboardingBody3 => 'Show your 4-digit code at the counter and grab your order. No waiting.';

  @override
  String get onboardingNext => 'Next';

  @override
  String get onboardingStart => 'Get started';

  @override
  String get onboardingSkip => 'Skip';

  @override
  String get signInTitle => 'Sign in to order';

  @override
  String get signInSubtitle => 'Your orders, points and cards stay with you on every device.';

  @override
  String get continueWithTelegram => 'Continue with Telegram';

  @override
  String get continueWithGoogle => 'Continue with Google';

  @override
  String get continueWithApple => 'Continue with Apple';

  @override
  String get devSignIn => 'Developer sign-in';

  @override
  String get signingIn => 'Signing in…';

  @override
  String get signInAgreement => 'By continuing you agree to the Terms of Service and Privacy Policy.';

  @override
  String get signInUnavailable => 'No sign-in method is configured for this build.';

  @override
  String get signInFailed => 'Could not sign in. Please try again.';

  @override
  String get storesTitle => 'Stores';

  @override
  String get storesSearchHint => 'Search by name or address';

  @override
  String get storesFilterAll => 'All';

  @override
  String get storesFilterOpen => 'Open now';

  @override
  String get storesNearMe => 'Near me';

  @override
  String get storesEmpty => 'No stores match your search.';

  @override
  String get storesLoadFailed => 'Could not load stores.';

  @override
  String get storeStatusOpen => 'Open';

  @override
  String get storeStatusBusy => 'Busy';

  @override
  String get storeStatusClosed => 'Closed';

  @override
  String get orderHere => 'Order here';

  @override
  String distanceAway(String distance) {
    return '$distance away';
  }

  @override
  String etaChip(int count) {
    return '~$count min';
  }

  @override
  String get chooseStoreTitle => 'Where are you picking up?';

  @override
  String get chooseStoreSubtitle => 'Choose a store and we will show its menu and how soon your order can be ready.';

  @override
  String get storeClosedBanner => 'Closed right now — you can still schedule for later.';

  @override
  String get storeBusyBanner => 'The kitchen is busy — orders take a little longer.';

  @override
  String get openingHours => 'Opening hours';

  @override
  String get closedAllDay => 'Closed';

  @override
  String get buildRoute => 'Build route';

  @override
  String get callStore => 'Call';

  @override
  String get menuSearchHint => 'Search the menu';

  @override
  String get menuEmpty => 'The menu is empty for now.';

  @override
  String menuNoResults(String query) {
    return 'Nothing found for “$query”';
  }

  @override
  String get menuLoadFailed => 'Could not load the menu.';

  @override
  String get changeStore => 'Change';

  @override
  String addedToCart(String name) {
    return '$name added';
  }

  @override
  String get viewCart => 'View';

  @override
  String get offlineMenu => 'Offline — showing the last saved menu';

  @override
  String get variationSize => 'Size';

  @override
  String get variationTemperature => 'Temperature';

  @override
  String get variationMilk => 'Milk';

  @override
  String get variationCup => 'Cup';

  @override
  String get variationOther => 'Options';

  @override
  String get productAddons => 'Add-ons';

  @override
  String productAddonLimit(int max) {
    return 'up to $max';
  }

  @override
  String get productNote => 'Note for the barista';

  @override
  String get productNoteHint => 'Extra hot, less foam…';

  @override
  String productAdd(String price) {
    return 'Add · $price';
  }

  @override
  String productCalories(int kcal) {
    return '$kcal kcal';
  }

  @override
  String get productCaffeine => 'Caffeine';

  @override
  String get productAllergens => 'Allergens';

  @override
  String productNutrition(String p, String f, String c) {
    return 'Protein $p g · Fat $f g · Carbs $c g';
  }

  @override
  String get productNoStore => 'Choose a store to order this.';

  @override
  String get productLoadFailed => 'Could not load this item.';

  @override
  String get dietVegan => 'Vegan';

  @override
  String get dietVegetarian => 'Vegetarian';

  @override
  String get dietGlutenFree => 'Gluten-free';

  @override
  String get dietLactoseFree => 'Lactose-free';

  @override
  String get dietDecaf => 'Decaf';

  @override
  String get dietSugarFree => 'Sugar-free';

  @override
  String get cartTitle => 'Your order';

  @override
  String get cartEmptyTitle => 'Your cart is empty';

  @override
  String get cartEmptyBody => 'Add something tasty from the menu.';

  @override
  String get browseMenu => 'Browse the menu';

  @override
  String cartCheckout(String price) {
    return 'Checkout · $price';
  }

  @override
  String get cartClear => 'Clear cart';

  @override
  String get cartClearConfirm => 'Remove everything from your cart?';

  @override
  String cartItemRemoved(String name) {
    return '$name removed';
  }

  @override
  String get cartLoadFailed => 'Could not load your cart.';

  @override
  String get checkoutTitle => 'Checkout';

  @override
  String get checkoutWhen => 'When';

  @override
  String get pickupAsap => 'As soon as possible';

  @override
  String get pickupLater => 'Later';

  @override
  String get pickupLaterHint => 'Choose a time';

  @override
  String get noSlots => 'No free windows in the next few hours. Try ASAP.';

  @override
  String get slotsHint => 'Only windows this store can still keep up with.';

  @override
  String get fulfillmentPickup => 'Pickup';

  @override
  String get fulfillmentDelivery => 'Delivery';

  @override
  String get deliveryAddress => 'Address';

  @override
  String get deliveryAddressHint => 'Street, house, apartment';

  @override
  String get deliveryCity => 'City';

  @override
  String get deliveryNotes => 'Notes for the rider';

  @override
  String get deliveryNotesHint => 'Entrance, floor, door code';

  @override
  String get deliveryUseLocation => 'Use my location';

  @override
  String get deliveryOutside => 'This address is outside the delivery area.';

  @override
  String deliveryDistance(String distance) {
    return '≈ $distance from the store';
  }

  @override
  String get deliveryAddressRequired => 'Enter the delivery address and city.';

  @override
  String get contactTitle => 'Contact';

  @override
  String get contactName => 'Name on the order';

  @override
  String get contactPhone => 'Phone';

  @override
  String get orderNotes => 'Note for the barista';

  @override
  String get discountsTitle => 'Discounts';

  @override
  String get promoCode => 'Promo code';

  @override
  String promoApplied(String amount) {
    return 'Saving $amount';
  }

  @override
  String promoPoints(String multiplier) {
    return '$multiplier× points on this order';
  }

  @override
  String get promoInvalid => 'This code is not valid.';

  @override
  String get giftCard => 'Gift card';

  @override
  String giftCardApplied(String amount) {
    return '$amount covered by the gift card';
  }

  @override
  String get payWithPoints => 'Pay with points';

  @override
  String pointsAvailable(int points) {
    return '$points points available';
  }

  @override
  String pointsApplied(int points, String amount) {
    return '$points points · $amount off';
  }

  @override
  String pointsTooFew(int min) {
    return 'At least $min points, and no more than the order is worth.';
  }

  @override
  String get pointsDiscount => 'Points';

  @override
  String promoDiscount(String code) {
    return 'Promo $code';
  }

  @override
  String get paymentTitle => 'Payment';

  @override
  String get payAtCounter => 'Pay at the counter';

  @override
  String get payAtCounterHint => 'Cash or card when you pick up';

  @override
  String get addCard => 'Add a card';

  @override
  String get holdHint => 'We hold the amount now and charge it when the store accepts your order.';

  @override
  String get summaryTitle => 'Summary';

  @override
  String placeOrderPay(String total) {
    return 'Pay $total';
  }

  @override
  String placeOrder(String total) {
    return 'Place order · $total';
  }

  @override
  String minOrderNotice(String amount) {
    return 'Minimum order is $amount.';
  }

  @override
  String get retryPayment => 'Retry payment';

  @override
  String orderTitle(String code) {
    return 'Order #$code';
  }

  @override
  String get statusCreated => 'Order received';

  @override
  String get statusPaid => 'Payment confirmed';

  @override
  String get statusAccepted => 'Accepted by the kitchen';

  @override
  String get statusInProgress => 'Preparing your order';

  @override
  String get statusReady => 'Ready for pickup';

  @override
  String get statusReadyDelivery => 'Ready — waiting for the rider';

  @override
  String get statusPickedUp => 'Enjoy!';

  @override
  String get statusOutForDelivery => 'On the way';

  @override
  String get statusDelivered => 'Delivered';

  @override
  String get statusCancelled => 'Cancelled';

  @override
  String get statusExpired => 'Cancelled — payment did not arrive in time';

  @override
  String get statusUnknown => 'Updating…';

  @override
  String get stepReceived => 'Received';

  @override
  String get stepPreparing => 'Preparing';

  @override
  String get stepReady => 'Ready';

  @override
  String get stepPickedUp => 'Picked up';

  @override
  String get stepOnTheWay => 'On the way';

  @override
  String get stepDelivered => 'Delivered';

  @override
  String get paymentStatePaid => 'Payment went through';

  @override
  String get paymentStateHeld => 'Amount on hold';

  @override
  String get paymentStateHeldHint => 'It is charged when the store accepts your order.';

  @override
  String get paymentStatePending => 'Checking your payment';

  @override
  String get paymentStateFailed => 'Payment did not go through';

  @override
  String get paymentStateRefunded => 'Money returned';

  @override
  String get paymentStateAtCounter => 'Paying at the counter';

  @override
  String get pickupCode => 'Pickup code';

  @override
  String get showQr => 'Show QR';

  @override
  String get qrHint => 'Show this at the counter';

  @override
  String get iAmHere => 'I\'m here';

  @override
  String get iAmHereSent => 'The barista knows you are here';

  @override
  String get cancelOrder => 'Cancel order';

  @override
  String get cancelOrderTitle => 'Cancel this order?';

  @override
  String get cancelOrderBody => 'If your card was charged or held, the money goes back.';

  @override
  String get keepOrder => 'Keep it';

  @override
  String get reorder => 'Order again';

  @override
  String get reorderDone => 'Added to your cart';

  @override
  String get reorderPartial => 'Some items are no longer available';

  @override
  String get orderItems => 'Items';

  @override
  String pickupAt(String time) {
    return 'Pickup at $time';
  }

  @override
  String deliveryAt(String time) {
    return 'Delivery by $time';
  }

  @override
  String get untilReady => 'until ready';

  @override
  String get readyShort => 'Ready';

  @override
  String get liveUpdates => 'Live';

  @override
  String get reconnecting => 'Reconnecting…';

  @override
  String get orderLoadFailed => 'Could not load the order.';

  @override
  String get emailReceipt => 'Email me the receipt';

  @override
  String get receiptSent => 'Receipt sent to your email';

  @override
  String yourOrderAt(String store) {
    return 'Your order at $store';
  }

  @override
  String hiName(String name) {
    return 'Hi, $name!';
  }

  @override
  String get ordersTitle => 'My orders';

  @override
  String get ordersActive => 'Active';

  @override
  String get ordersHistory => 'History';

  @override
  String get ordersEmptyActive => 'No active orders';

  @override
  String get ordersEmptyHistory => 'No past orders yet';

  @override
  String get ordersEmptyBody => 'Place your first order and it will show up here.';

  @override
  String get ordersSignIn => 'Sign in to see your orders';

  @override
  String activeOrderBanner(String code, String status) {
    return 'Order #$code · $status';
  }

  @override
  String get profileTitle => 'Profile';

  @override
  String get profileGuestTitle => 'Sign in for the full experience';

  @override
  String get profileGuestBody => 'Save cards, collect points and follow your orders live.';

  @override
  String get signIn => 'Sign in';

  @override
  String get profilePersonal => 'Personal info';

  @override
  String get profilePayment => 'Payment methods';

  @override
  String get profileGiftCards => 'Gift cards';

  @override
  String get profileLoyalty => 'Loyalty';

  @override
  String get profileReferrals => 'Invite a friend';

  @override
  String get profileNotifications => 'Notifications';

  @override
  String get profileLanguage => 'Language';

  @override
  String get profileAbout => 'About the app';

  @override
  String get signOut => 'Sign out';

  @override
  String get signOutConfirm => 'Sign out of takeAway?';

  @override
  String appVersion(String version) {
    return 'Version $version';
  }

  @override
  String get tierSilver => 'Silver';

  @override
  String get tierGold => 'Gold';

  @override
  String get tierPlatinum => 'Platinum';

  @override
  String get tierSignature => 'Signature';

  @override
  String pointsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count points', one: '1 point');
    return '$_temp0';
  }

  @override
  String toNextTier(int points, String tier) {
    return '$points points to $tier';
  }

  @override
  String get topTier => 'Top tier — thank you for being a regular!';

  @override
  String get personalName => 'Name';

  @override
  String get personalEmail => 'Email';

  @override
  String get personalPhone => 'Phone';

  @override
  String get personalBirthday => 'Date of birth';

  @override
  String get personalSaved => 'Saved';

  @override
  String get nameRequired => 'Enter your name';

  @override
  String get emailInvalid => 'Enter a valid email';

  @override
  String get phoneInvalid => 'Use the international format, e.g. +37377712345';

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get notificationsSubtitle => 'Choose what we may tell you about. You can change it any time.';

  @override
  String get notifOrderUpdates => 'Order updates';

  @override
  String get notifOrderUpdatesHint => 'When your order is accepted, ready or on its way.';

  @override
  String get notifPromotions => 'Promotions';

  @override
  String get notifPromotionsHint => 'Discounts, new items and loyalty rewards.';

  @override
  String get pushBlocked => 'Notifications are turned off for takeAway in the system settings.';

  @override
  String get openSettings => 'Open settings';

  @override
  String get loyaltyTitle => 'Loyalty';

  @override
  String get loyaltyBalance => 'Points balance';

  @override
  String get loyaltyActivity => 'Recent activity';

  @override
  String get loyaltyEmpty => 'Points will appear here after your first order.';

  @override
  String get loyaltyHowTitle => 'How it works';

  @override
  String get loyaltyHowBody =>
      'Earn points on every paid order and spend them at checkout. The more you order, the higher your tier.';

  @override
  String get referralsTitle => 'Invite a friend';

  @override
  String get referralsBody =>
      'Share your code. Your friend gets bonus points on their first paid order — and so do you.';

  @override
  String get referralsYourCode => 'Your code';

  @override
  String get referralsCopied => 'Code copied';

  @override
  String get referralsShare => 'Share';

  @override
  String referralsShareText(String code, String url) {
    return 'Order coffee ahead with takeAway and skip the queue. Use my code $code on your first order and we both get bonus points. $url';
  }

  @override
  String get referralsSignups => 'Friends joined';

  @override
  String get referralsRewarded => 'First orders';

  @override
  String get referralsPoints => 'Points earned';

  @override
  String get referralsApplyTitle => 'Have a friend\'s code?';

  @override
  String get referralsApplyHint => 'One time only, before your first paid order.';

  @override
  String referralsApplied(String code) {
    return 'Bonus locked in with code $code';
  }

  @override
  String get referralsCodeHint => 'Friend\'s code';

  @override
  String get giftCardsTitle => 'Gift cards';

  @override
  String get giftCardsEmpty => 'No gift cards used yet. Enter a code at checkout and it will show up here.';

  @override
  String giftCardUsedOn(String code, String brand) {
    return 'Order #$code · $brand';
  }

  @override
  String get paymentMethodsTitle => 'Payment methods';

  @override
  String get paymentMethodsSubtitle =>
      'Add a card once and pay in one tap. We never see or store your full card number.';

  @override
  String get paymentMethodsUnavailable => 'Card payments are not available yet. You can pay at the counter.';

  @override
  String get paymentMethodsEmpty => 'No cards yet';

  @override
  String get cardDefault => 'Default';

  @override
  String get cardMakeDefault => 'Make default';

  @override
  String get cardRemoveTitle => 'Remove this card?';

  @override
  String get cardInactive => 'Blocked by the bank';

  @override
  String get cardFallbackTitle => 'Card';

  @override
  String get cardAddTitle => 'Add a card';

  @override
  String get cardIssuer => 'Issuing bank';

  @override
  String get cardLast4 => 'Last 4 digits of the card';

  @override
  String get cardPhone => 'Phone number linked to the card';

  @override
  String get cardPhoneHint => 'e.g. 77712345';

  @override
  String get cardLabel => 'Card name (optional)';

  @override
  String get cardPrivacy => 'Your full card number is never sent or stored. The bank will text you a one-time code.';

  @override
  String get cardSendCode => 'Send the code';

  @override
  String get cardCodeTitle => 'Enter the code';

  @override
  String cardCodeSent(String phone) {
    return 'We sent a one-time code to $phone.';
  }

  @override
  String get cardStartOver => 'Enter the details again';

  @override
  String get cardAdded => 'Card added';

  @override
  String get cardRefresh => 'Check with the bank';

  @override
  String get languageTitle => 'Language';

  @override
  String get languageSystem => 'Same as the device';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageRussian => 'Русский';

  @override
  String get aboutBody => 'takeAway — pre-order coffee and food. Choose, pay and pick it up without waiting in line.';

  @override
  String get locationDenied => 'Location access is off. Allow it in settings to see stores near you.';

  @override
  String get locationServiceOff => 'Location services are turned off.';

  @override
  String get greetingMorning => 'Good morning';

  @override
  String get greetingAfternoon => 'Good afternoon';

  @override
  String get greetingEvening => 'Good evening';

  @override
  String greetingWithName(String greeting, String name) {
    return '$greeting, $name';
  }

  @override
  String get pickupPoint => 'Pickup point';

  @override
  String get quickAdd => 'Add to cart';

  @override
  String cartBarLabel(int count, String time) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count items', one: '1 item');
    return '$_temp0 · ready by $time';
  }

  @override
  String get liveOrder => 'Live order';

  @override
  String get categoriesAll => 'All';

  @override
  String get copy => 'Copy';
}
