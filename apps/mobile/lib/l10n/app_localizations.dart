import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_ru.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[Locale('en'), Locale('ru')];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'takeAway'**
  String get appName;

  /// No description provided for @tagline.
  ///
  /// In en, this message translates to:
  /// **'Pre-order. Skip the queue. Pick it up.'**
  String get tagline;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retry;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirm;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @apply.
  ///
  /// In en, this message translates to:
  /// **'Apply'**
  String get apply;

  /// No description provided for @remove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get remove;

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @done.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get done;

  /// No description provided for @continueLabel.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueLabel;

  /// No description provided for @undo.
  ///
  /// In en, this message translates to:
  /// **'Undo'**
  String get undo;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get loading;

  /// No description provided for @genericError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get genericError;

  /// No description provided for @networkError.
  ///
  /// In en, this message translates to:
  /// **'No connection. Check your internet and try again.'**
  String get networkError;

  /// No description provided for @sessionExpired.
  ///
  /// In en, this message translates to:
  /// **'Your session has expired. Please sign in again.'**
  String get sessionExpired;

  /// No description provided for @subtotal.
  ///
  /// In en, this message translates to:
  /// **'Subtotal'**
  String get subtotal;

  /// No description provided for @total.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get total;

  /// No description provided for @tax.
  ///
  /// In en, this message translates to:
  /// **'Tax'**
  String get tax;

  /// No description provided for @taxIncluded.
  ///
  /// In en, this message translates to:
  /// **'Incl. tax'**
  String get taxIncluded;

  /// No description provided for @deliveryFee.
  ///
  /// In en, this message translates to:
  /// **'Delivery'**
  String get deliveryFee;

  /// No description provided for @soldOut.
  ///
  /// In en, this message translates to:
  /// **'Sold out'**
  String get soldOut;

  /// No description provided for @priceFrom.
  ///
  /// In en, this message translates to:
  /// **'from {price}'**
  String priceFrom(String price);

  /// No description provided for @minutes.
  ///
  /// In en, this message translates to:
  /// **'{count} min'**
  String minutes(int count);

  /// No description provided for @readyInMinutes.
  ///
  /// In en, this message translates to:
  /// **'Ready in ~{count} min'**
  String readyInMinutes(int count);

  /// No description provided for @readyBy.
  ///
  /// In en, this message translates to:
  /// **'Ready by {time}'**
  String readyBy(String time);

  /// No description provided for @itemsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item} other{{count} items}}'**
  String itemsCount(int count);

  /// No description provided for @navMenu.
  ///
  /// In en, this message translates to:
  /// **'Menu'**
  String get navMenu;

  /// No description provided for @navStores.
  ///
  /// In en, this message translates to:
  /// **'Stores'**
  String get navStores;

  /// No description provided for @navOrders.
  ///
  /// In en, this message translates to:
  /// **'Orders'**
  String get navOrders;

  /// No description provided for @navProfile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get navProfile;

  /// No description provided for @onboardingTitle1.
  ///
  /// In en, this message translates to:
  /// **'Order ahead'**
  String get onboardingTitle1;

  /// No description provided for @onboardingBody1.
  ///
  /// In en, this message translates to:
  /// **'Choose your coffee or lunch in a couple of taps, wherever you are.'**
  String get onboardingBody1;

  /// No description provided for @onboardingTitle2.
  ///
  /// In en, this message translates to:
  /// **'Timed to your arrival'**
  String get onboardingTitle2;

  /// No description provided for @onboardingBody2.
  ///
  /// In en, this message translates to:
  /// **'Pick ASAP or a time slot. The kitchen starts so it is fresh when you walk in.'**
  String get onboardingBody2;

  /// No description provided for @onboardingTitle3.
  ///
  /// In en, this message translates to:
  /// **'Skip the queue'**
  String get onboardingTitle3;

  /// No description provided for @onboardingBody3.
  ///
  /// In en, this message translates to:
  /// **'Show your 4-digit code at the counter and grab your order. No waiting.'**
  String get onboardingBody3;

  /// No description provided for @onboardingNext.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get onboardingNext;

  /// No description provided for @onboardingStart.
  ///
  /// In en, this message translates to:
  /// **'Get started'**
  String get onboardingStart;

  /// No description provided for @onboardingSkip.
  ///
  /// In en, this message translates to:
  /// **'Skip'**
  String get onboardingSkip;

  /// No description provided for @signInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to order'**
  String get signInTitle;

  /// No description provided for @signInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your orders, points and cards stay with you on every device.'**
  String get signInSubtitle;

  /// No description provided for @continueWithTelegram.
  ///
  /// In en, this message translates to:
  /// **'Continue with Telegram'**
  String get continueWithTelegram;

  /// No description provided for @continueWithGoogle.
  ///
  /// In en, this message translates to:
  /// **'Continue with Google'**
  String get continueWithGoogle;

  /// No description provided for @continueWithApple.
  ///
  /// In en, this message translates to:
  /// **'Continue with Apple'**
  String get continueWithApple;

  /// No description provided for @devSignIn.
  ///
  /// In en, this message translates to:
  /// **'Developer sign-in'**
  String get devSignIn;

  /// No description provided for @signingIn.
  ///
  /// In en, this message translates to:
  /// **'Signing in…'**
  String get signingIn;

  /// No description provided for @signInAgreement.
  ///
  /// In en, this message translates to:
  /// **'By continuing you agree to the Terms of Service and Privacy Policy.'**
  String get signInAgreement;

  /// No description provided for @signInUnavailable.
  ///
  /// In en, this message translates to:
  /// **'No sign-in method is configured for this build.'**
  String get signInUnavailable;

  /// No description provided for @signInFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not sign in. Please try again.'**
  String get signInFailed;

  /// No description provided for @telegramSignInFailed.
  ///
  /// In en, this message translates to:
  /// **'Telegram didn\'t confirm the sign-in. Please try again.'**
  String get telegramSignInFailed;

  /// No description provided for @storesTitle.
  ///
  /// In en, this message translates to:
  /// **'Stores'**
  String get storesTitle;

  /// No description provided for @storesSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search by name or address'**
  String get storesSearchHint;

  /// No description provided for @storesFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get storesFilterAll;

  /// No description provided for @storesFilterOpen.
  ///
  /// In en, this message translates to:
  /// **'Open now'**
  String get storesFilterOpen;

  /// No description provided for @storesNearMe.
  ///
  /// In en, this message translates to:
  /// **'Near me'**
  String get storesNearMe;

  /// No description provided for @storesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No stores match your search.'**
  String get storesEmpty;

  /// No description provided for @storesLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load stores.'**
  String get storesLoadFailed;

  /// No description provided for @storeStatusOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get storeStatusOpen;

  /// No description provided for @storeStatusBusy.
  ///
  /// In en, this message translates to:
  /// **'Busy'**
  String get storeStatusBusy;

  /// No description provided for @storeStatusClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get storeStatusClosed;

  /// No description provided for @orderHere.
  ///
  /// In en, this message translates to:
  /// **'Order here'**
  String get orderHere;

  /// No description provided for @distanceAway.
  ///
  /// In en, this message translates to:
  /// **'{distance} away'**
  String distanceAway(String distance);

  /// No description provided for @etaChip.
  ///
  /// In en, this message translates to:
  /// **'~{count} min'**
  String etaChip(int count);

  /// No description provided for @chooseStoreTitle.
  ///
  /// In en, this message translates to:
  /// **'Where are you picking up?'**
  String get chooseStoreTitle;

  /// No description provided for @chooseStoreSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Choose a store and we will show its menu and how soon your order can be ready.'**
  String get chooseStoreSubtitle;

  /// No description provided for @storeClosedBanner.
  ///
  /// In en, this message translates to:
  /// **'Closed right now — you can still schedule for later.'**
  String get storeClosedBanner;

  /// No description provided for @storeBusyBanner.
  ///
  /// In en, this message translates to:
  /// **'The kitchen is busy — orders take a little longer.'**
  String get storeBusyBanner;

  /// No description provided for @openingHours.
  ///
  /// In en, this message translates to:
  /// **'Opening hours'**
  String get openingHours;

  /// No description provided for @closedAllDay.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get closedAllDay;

  /// No description provided for @buildRoute.
  ///
  /// In en, this message translates to:
  /// **'Build route'**
  String get buildRoute;

  /// No description provided for @callStore.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get callStore;

  /// No description provided for @menuSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search the menu'**
  String get menuSearchHint;

  /// No description provided for @menuEmpty.
  ///
  /// In en, this message translates to:
  /// **'The menu is empty for now.'**
  String get menuEmpty;

  /// No description provided for @menuNoResults.
  ///
  /// In en, this message translates to:
  /// **'Nothing found for “{query}”'**
  String menuNoResults(String query);

  /// No description provided for @menuLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load the menu.'**
  String get menuLoadFailed;

  /// No description provided for @changeStore.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get changeStore;

  /// No description provided for @addedToCart.
  ///
  /// In en, this message translates to:
  /// **'{name} added'**
  String addedToCart(String name);

  /// No description provided for @viewCart.
  ///
  /// In en, this message translates to:
  /// **'View'**
  String get viewCart;

  /// No description provided for @offlineMenu.
  ///
  /// In en, this message translates to:
  /// **'Offline — showing the last saved menu'**
  String get offlineMenu;

  /// No description provided for @variationSize.
  ///
  /// In en, this message translates to:
  /// **'Size'**
  String get variationSize;

  /// No description provided for @variationTemperature.
  ///
  /// In en, this message translates to:
  /// **'Temperature'**
  String get variationTemperature;

  /// No description provided for @variationMilk.
  ///
  /// In en, this message translates to:
  /// **'Milk'**
  String get variationMilk;

  /// No description provided for @variationCup.
  ///
  /// In en, this message translates to:
  /// **'Cup'**
  String get variationCup;

  /// No description provided for @variationOther.
  ///
  /// In en, this message translates to:
  /// **'Options'**
  String get variationOther;

  /// No description provided for @productAddons.
  ///
  /// In en, this message translates to:
  /// **'Add-ons'**
  String get productAddons;

  /// No description provided for @productAddonLimit.
  ///
  /// In en, this message translates to:
  /// **'up to {max}'**
  String productAddonLimit(int max);

  /// No description provided for @productNote.
  ///
  /// In en, this message translates to:
  /// **'Note for the barista'**
  String get productNote;

  /// No description provided for @productNoteHint.
  ///
  /// In en, this message translates to:
  /// **'Extra hot, less foam…'**
  String get productNoteHint;

  /// No description provided for @productAdd.
  ///
  /// In en, this message translates to:
  /// **'Add · {price}'**
  String productAdd(String price);

  /// No description provided for @productCalories.
  ///
  /// In en, this message translates to:
  /// **'{kcal} kcal'**
  String productCalories(int kcal);

  /// No description provided for @productCaffeine.
  ///
  /// In en, this message translates to:
  /// **'Caffeine'**
  String get productCaffeine;

  /// No description provided for @productAllergens.
  ///
  /// In en, this message translates to:
  /// **'Allergens'**
  String get productAllergens;

  /// No description provided for @productNutrition.
  ///
  /// In en, this message translates to:
  /// **'Protein {p} g · Fat {f} g · Carbs {c} g'**
  String productNutrition(String p, String f, String c);

  /// No description provided for @productNoStore.
  ///
  /// In en, this message translates to:
  /// **'Choose a store to order this.'**
  String get productNoStore;

  /// No description provided for @productLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load this item.'**
  String get productLoadFailed;

  /// No description provided for @dietVegan.
  ///
  /// In en, this message translates to:
  /// **'Vegan'**
  String get dietVegan;

  /// No description provided for @dietVegetarian.
  ///
  /// In en, this message translates to:
  /// **'Vegetarian'**
  String get dietVegetarian;

  /// No description provided for @dietGlutenFree.
  ///
  /// In en, this message translates to:
  /// **'Gluten-free'**
  String get dietGlutenFree;

  /// No description provided for @dietLactoseFree.
  ///
  /// In en, this message translates to:
  /// **'Lactose-free'**
  String get dietLactoseFree;

  /// No description provided for @dietDecaf.
  ///
  /// In en, this message translates to:
  /// **'Decaf'**
  String get dietDecaf;

  /// No description provided for @dietSugarFree.
  ///
  /// In en, this message translates to:
  /// **'Sugar-free'**
  String get dietSugarFree;

  /// No description provided for @cartTitle.
  ///
  /// In en, this message translates to:
  /// **'Your order'**
  String get cartTitle;

  /// No description provided for @cartEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Your cart is empty'**
  String get cartEmptyTitle;

  /// No description provided for @cartEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Add something tasty from the menu.'**
  String get cartEmptyBody;

  /// No description provided for @browseMenu.
  ///
  /// In en, this message translates to:
  /// **'Browse the menu'**
  String get browseMenu;

  /// No description provided for @cartCheckout.
  ///
  /// In en, this message translates to:
  /// **'Checkout · {price}'**
  String cartCheckout(String price);

  /// No description provided for @cartClear.
  ///
  /// In en, this message translates to:
  /// **'Clear cart'**
  String get cartClear;

  /// No description provided for @cartClearConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove everything from your cart?'**
  String get cartClearConfirm;

  /// No description provided for @cartItemRemoved.
  ///
  /// In en, this message translates to:
  /// **'{name} removed'**
  String cartItemRemoved(String name);

  /// No description provided for @cartLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load your cart.'**
  String get cartLoadFailed;

  /// No description provided for @checkoutTitle.
  ///
  /// In en, this message translates to:
  /// **'Checkout'**
  String get checkoutTitle;

  /// No description provided for @checkoutWhen.
  ///
  /// In en, this message translates to:
  /// **'When'**
  String get checkoutWhen;

  /// No description provided for @pickupAsap.
  ///
  /// In en, this message translates to:
  /// **'As soon as possible'**
  String get pickupAsap;

  /// No description provided for @pickupLater.
  ///
  /// In en, this message translates to:
  /// **'Later'**
  String get pickupLater;

  /// No description provided for @pickupLaterHint.
  ///
  /// In en, this message translates to:
  /// **'Choose a time'**
  String get pickupLaterHint;

  /// No description provided for @noSlots.
  ///
  /// In en, this message translates to:
  /// **'No free windows in the next few hours. Try ASAP.'**
  String get noSlots;

  /// No description provided for @slotsHint.
  ///
  /// In en, this message translates to:
  /// **'Only windows this store can still keep up with.'**
  String get slotsHint;

  /// No description provided for @fulfillmentPickup.
  ///
  /// In en, this message translates to:
  /// **'Pickup'**
  String get fulfillmentPickup;

  /// No description provided for @fulfillmentDelivery.
  ///
  /// In en, this message translates to:
  /// **'Delivery'**
  String get fulfillmentDelivery;

  /// No description provided for @deliveryAddress.
  ///
  /// In en, this message translates to:
  /// **'Address'**
  String get deliveryAddress;

  /// No description provided for @deliveryAddressHint.
  ///
  /// In en, this message translates to:
  /// **'Street, house, apartment'**
  String get deliveryAddressHint;

  /// No description provided for @deliveryCity.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get deliveryCity;

  /// No description provided for @deliveryNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes for the rider'**
  String get deliveryNotes;

  /// No description provided for @deliveryNotesHint.
  ///
  /// In en, this message translates to:
  /// **'Entrance, floor, door code'**
  String get deliveryNotesHint;

  /// No description provided for @deliveryUseLocation.
  ///
  /// In en, this message translates to:
  /// **'Use my location'**
  String get deliveryUseLocation;

  /// No description provided for @deliveryOutside.
  ///
  /// In en, this message translates to:
  /// **'This address is outside the delivery area.'**
  String get deliveryOutside;

  /// No description provided for @deliveryDistance.
  ///
  /// In en, this message translates to:
  /// **'≈ {distance} from the store'**
  String deliveryDistance(String distance);

  /// No description provided for @deliveryAddressRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter the delivery address and city.'**
  String get deliveryAddressRequired;

  /// No description provided for @contactTitle.
  ///
  /// In en, this message translates to:
  /// **'Contact'**
  String get contactTitle;

  /// No description provided for @contactName.
  ///
  /// In en, this message translates to:
  /// **'Name on the order'**
  String get contactName;

  /// No description provided for @contactPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get contactPhone;

  /// No description provided for @orderNotes.
  ///
  /// In en, this message translates to:
  /// **'Note for the barista'**
  String get orderNotes;

  /// No description provided for @discountsTitle.
  ///
  /// In en, this message translates to:
  /// **'Discounts'**
  String get discountsTitle;

  /// No description provided for @promoCode.
  ///
  /// In en, this message translates to:
  /// **'Promo code'**
  String get promoCode;

  /// No description provided for @promoApplied.
  ///
  /// In en, this message translates to:
  /// **'Saving {amount}'**
  String promoApplied(String amount);

  /// No description provided for @promoPoints.
  ///
  /// In en, this message translates to:
  /// **'{multiplier}× points on this order'**
  String promoPoints(String multiplier);

  /// No description provided for @promoInvalid.
  ///
  /// In en, this message translates to:
  /// **'This code is not valid.'**
  String get promoInvalid;

  /// No description provided for @giftCard.
  ///
  /// In en, this message translates to:
  /// **'Gift card'**
  String get giftCard;

  /// No description provided for @giftCardApplied.
  ///
  /// In en, this message translates to:
  /// **'{amount} covered by the gift card'**
  String giftCardApplied(String amount);

  /// No description provided for @payWithPoints.
  ///
  /// In en, this message translates to:
  /// **'Pay with points'**
  String get payWithPoints;

  /// No description provided for @pointsAvailable.
  ///
  /// In en, this message translates to:
  /// **'{points} points available'**
  String pointsAvailable(int points);

  /// No description provided for @pointsApplied.
  ///
  /// In en, this message translates to:
  /// **'{points} points · {amount} off'**
  String pointsApplied(int points, String amount);

  /// No description provided for @pointsTooFew.
  ///
  /// In en, this message translates to:
  /// **'At least {min} points, and no more than the order is worth.'**
  String pointsTooFew(int min);

  /// No description provided for @pointsDiscount.
  ///
  /// In en, this message translates to:
  /// **'Points'**
  String get pointsDiscount;

  /// No description provided for @promoDiscount.
  ///
  /// In en, this message translates to:
  /// **'Promo {code}'**
  String promoDiscount(String code);

  /// No description provided for @paymentTitle.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get paymentTitle;

  /// No description provided for @payAtCounter.
  ///
  /// In en, this message translates to:
  /// **'Pay at the counter'**
  String get payAtCounter;

  /// No description provided for @payAtCounterHint.
  ///
  /// In en, this message translates to:
  /// **'Cash or card when you pick up'**
  String get payAtCounterHint;

  /// No description provided for @addCard.
  ///
  /// In en, this message translates to:
  /// **'Add a card'**
  String get addCard;

  /// No description provided for @holdHint.
  ///
  /// In en, this message translates to:
  /// **'We hold the amount now and charge it when the store accepts your order.'**
  String get holdHint;

  /// No description provided for @summaryTitle.
  ///
  /// In en, this message translates to:
  /// **'Summary'**
  String get summaryTitle;

  /// No description provided for @placeOrderPay.
  ///
  /// In en, this message translates to:
  /// **'Pay {total}'**
  String placeOrderPay(String total);

  /// No description provided for @placeOrder.
  ///
  /// In en, this message translates to:
  /// **'Place order · {total}'**
  String placeOrder(String total);

  /// No description provided for @minOrderNotice.
  ///
  /// In en, this message translates to:
  /// **'Minimum order is {amount}.'**
  String minOrderNotice(String amount);

  /// No description provided for @retryPayment.
  ///
  /// In en, this message translates to:
  /// **'Retry payment'**
  String get retryPayment;

  /// No description provided for @orderTitle.
  ///
  /// In en, this message translates to:
  /// **'Order #{code}'**
  String orderTitle(String code);

  /// No description provided for @statusCreated.
  ///
  /// In en, this message translates to:
  /// **'Order received'**
  String get statusCreated;

  /// No description provided for @statusPaid.
  ///
  /// In en, this message translates to:
  /// **'Payment confirmed'**
  String get statusPaid;

  /// No description provided for @statusAccepted.
  ///
  /// In en, this message translates to:
  /// **'Accepted by the kitchen'**
  String get statusAccepted;

  /// No description provided for @statusInProgress.
  ///
  /// In en, this message translates to:
  /// **'Preparing your order'**
  String get statusInProgress;

  /// No description provided for @statusReady.
  ///
  /// In en, this message translates to:
  /// **'Ready for pickup'**
  String get statusReady;

  /// No description provided for @statusReadyDelivery.
  ///
  /// In en, this message translates to:
  /// **'Ready — waiting for the rider'**
  String get statusReadyDelivery;

  /// No description provided for @statusPickedUp.
  ///
  /// In en, this message translates to:
  /// **'Enjoy!'**
  String get statusPickedUp;

  /// No description provided for @statusOutForDelivery.
  ///
  /// In en, this message translates to:
  /// **'On the way'**
  String get statusOutForDelivery;

  /// No description provided for @statusDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get statusDelivered;

  /// No description provided for @statusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get statusCancelled;

  /// No description provided for @statusExpired.
  ///
  /// In en, this message translates to:
  /// **'Cancelled — payment did not arrive in time'**
  String get statusExpired;

  /// No description provided for @statusUnknown.
  ///
  /// In en, this message translates to:
  /// **'Updating…'**
  String get statusUnknown;

  /// No description provided for @stepReceived.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get stepReceived;

  /// No description provided for @stepPreparing.
  ///
  /// In en, this message translates to:
  /// **'Preparing'**
  String get stepPreparing;

  /// No description provided for @stepReady.
  ///
  /// In en, this message translates to:
  /// **'Ready'**
  String get stepReady;

  /// No description provided for @stepPickedUp.
  ///
  /// In en, this message translates to:
  /// **'Picked up'**
  String get stepPickedUp;

  /// No description provided for @stepOnTheWay.
  ///
  /// In en, this message translates to:
  /// **'On the way'**
  String get stepOnTheWay;

  /// No description provided for @stepDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get stepDelivered;

  /// No description provided for @paymentStatePaid.
  ///
  /// In en, this message translates to:
  /// **'Payment went through'**
  String get paymentStatePaid;

  /// No description provided for @paymentStateHeld.
  ///
  /// In en, this message translates to:
  /// **'Amount on hold'**
  String get paymentStateHeld;

  /// No description provided for @paymentStateHeldHint.
  ///
  /// In en, this message translates to:
  /// **'It is charged when the store accepts your order.'**
  String get paymentStateHeldHint;

  /// No description provided for @paymentStatePending.
  ///
  /// In en, this message translates to:
  /// **'Checking your payment'**
  String get paymentStatePending;

  /// No description provided for @paymentStateFailed.
  ///
  /// In en, this message translates to:
  /// **'Payment did not go through'**
  String get paymentStateFailed;

  /// No description provided for @paymentStateRefunded.
  ///
  /// In en, this message translates to:
  /// **'Money returned'**
  String get paymentStateRefunded;

  /// No description provided for @paymentStateAtCounter.
  ///
  /// In en, this message translates to:
  /// **'Paying at the counter'**
  String get paymentStateAtCounter;

  /// No description provided for @pickupCode.
  ///
  /// In en, this message translates to:
  /// **'Pickup code'**
  String get pickupCode;

  /// No description provided for @showQr.
  ///
  /// In en, this message translates to:
  /// **'Show QR'**
  String get showQr;

  /// No description provided for @qrHint.
  ///
  /// In en, this message translates to:
  /// **'Show this at the counter'**
  String get qrHint;

  /// No description provided for @iAmHere.
  ///
  /// In en, this message translates to:
  /// **'I\'m here'**
  String get iAmHere;

  /// No description provided for @iAmHereSent.
  ///
  /// In en, this message translates to:
  /// **'The barista knows you are here'**
  String get iAmHereSent;

  /// No description provided for @cancelOrder.
  ///
  /// In en, this message translates to:
  /// **'Cancel order'**
  String get cancelOrder;

  /// No description provided for @cancelOrderTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this order?'**
  String get cancelOrderTitle;

  /// No description provided for @cancelOrderBody.
  ///
  /// In en, this message translates to:
  /// **'If your card was charged or held, the money goes back.'**
  String get cancelOrderBody;

  /// No description provided for @keepOrder.
  ///
  /// In en, this message translates to:
  /// **'Keep it'**
  String get keepOrder;

  /// No description provided for @reorder.
  ///
  /// In en, this message translates to:
  /// **'Order again'**
  String get reorder;

  /// No description provided for @reorderDone.
  ///
  /// In en, this message translates to:
  /// **'Added to your cart'**
  String get reorderDone;

  /// No description provided for @reorderPartial.
  ///
  /// In en, this message translates to:
  /// **'Some items are no longer available'**
  String get reorderPartial;

  /// No description provided for @orderItems.
  ///
  /// In en, this message translates to:
  /// **'Items'**
  String get orderItems;

  /// No description provided for @pickupAt.
  ///
  /// In en, this message translates to:
  /// **'Pickup at {time}'**
  String pickupAt(String time);

  /// No description provided for @deliveryAt.
  ///
  /// In en, this message translates to:
  /// **'Delivery by {time}'**
  String deliveryAt(String time);

  /// No description provided for @untilReady.
  ///
  /// In en, this message translates to:
  /// **'until ready'**
  String get untilReady;

  /// No description provided for @readyShort.
  ///
  /// In en, this message translates to:
  /// **'Ready'**
  String get readyShort;

  /// No description provided for @liveUpdates.
  ///
  /// In en, this message translates to:
  /// **'Live'**
  String get liveUpdates;

  /// No description provided for @reconnecting.
  ///
  /// In en, this message translates to:
  /// **'Reconnecting…'**
  String get reconnecting;

  /// No description provided for @orderLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load the order.'**
  String get orderLoadFailed;

  /// No description provided for @emailReceipt.
  ///
  /// In en, this message translates to:
  /// **'Email me the receipt'**
  String get emailReceipt;

  /// No description provided for @receiptSent.
  ///
  /// In en, this message translates to:
  /// **'Receipt sent to your email'**
  String get receiptSent;

  /// No description provided for @yourOrderAt.
  ///
  /// In en, this message translates to:
  /// **'Your order at {store}'**
  String yourOrderAt(String store);

  /// No description provided for @hiName.
  ///
  /// In en, this message translates to:
  /// **'Hi, {name}!'**
  String hiName(String name);

  /// No description provided for @ordersTitle.
  ///
  /// In en, this message translates to:
  /// **'My orders'**
  String get ordersTitle;

  /// No description provided for @ordersActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get ordersActive;

  /// No description provided for @ordersHistory.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get ordersHistory;

  /// No description provided for @ordersEmptyActive.
  ///
  /// In en, this message translates to:
  /// **'No active orders'**
  String get ordersEmptyActive;

  /// No description provided for @ordersEmptyHistory.
  ///
  /// In en, this message translates to:
  /// **'No past orders yet'**
  String get ordersEmptyHistory;

  /// No description provided for @ordersEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Place your first order and it will show up here.'**
  String get ordersEmptyBody;

  /// No description provided for @ordersSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in to see your orders'**
  String get ordersSignIn;

  /// No description provided for @activeOrderBanner.
  ///
  /// In en, this message translates to:
  /// **'Order #{code} · {status}'**
  String activeOrderBanner(String code, String status);

  /// No description provided for @profileTitle.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profileTitle;

  /// No description provided for @profileGuestTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in for the full experience'**
  String get profileGuestTitle;

  /// No description provided for @profileGuestBody.
  ///
  /// In en, this message translates to:
  /// **'Save cards, collect points and follow your orders live.'**
  String get profileGuestBody;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// No description provided for @profilePersonal.
  ///
  /// In en, this message translates to:
  /// **'Personal info'**
  String get profilePersonal;

  /// No description provided for @profilePayment.
  ///
  /// In en, this message translates to:
  /// **'Payment methods'**
  String get profilePayment;

  /// No description provided for @profileGiftCards.
  ///
  /// In en, this message translates to:
  /// **'Gift cards'**
  String get profileGiftCards;

  /// No description provided for @profileLoyalty.
  ///
  /// In en, this message translates to:
  /// **'Loyalty'**
  String get profileLoyalty;

  /// No description provided for @profileReferrals.
  ///
  /// In en, this message translates to:
  /// **'Invite a friend'**
  String get profileReferrals;

  /// No description provided for @profileNotifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get profileNotifications;

  /// No description provided for @profileLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get profileLanguage;

  /// No description provided for @profileAbout.
  ///
  /// In en, this message translates to:
  /// **'About the app'**
  String get profileAbout;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @signOutConfirm.
  ///
  /// In en, this message translates to:
  /// **'Sign out of takeAway?'**
  String get signOutConfirm;

  /// No description provided for @appVersion.
  ///
  /// In en, this message translates to:
  /// **'Version {version}'**
  String appVersion(String version);

  /// No description provided for @tierSilver.
  ///
  /// In en, this message translates to:
  /// **'Silver'**
  String get tierSilver;

  /// No description provided for @tierGold.
  ///
  /// In en, this message translates to:
  /// **'Gold'**
  String get tierGold;

  /// No description provided for @tierPlatinum.
  ///
  /// In en, this message translates to:
  /// **'Platinum'**
  String get tierPlatinum;

  /// No description provided for @tierSignature.
  ///
  /// In en, this message translates to:
  /// **'Signature'**
  String get tierSignature;

  /// No description provided for @pointsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 point} other{{count} points}}'**
  String pointsCount(int count);

  /// No description provided for @toNextTier.
  ///
  /// In en, this message translates to:
  /// **'{points} points to {tier}'**
  String toNextTier(int points, String tier);

  /// No description provided for @topTier.
  ///
  /// In en, this message translates to:
  /// **'Top tier — thank you for being a regular!'**
  String get topTier;

  /// No description provided for @personalName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get personalName;

  /// No description provided for @personalEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get personalEmail;

  /// No description provided for @personalPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get personalPhone;

  /// No description provided for @personalBirthday.
  ///
  /// In en, this message translates to:
  /// **'Date of birth'**
  String get personalBirthday;

  /// No description provided for @personalSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get personalSaved;

  /// No description provided for @nameRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your name'**
  String get nameRequired;

  /// No description provided for @emailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email'**
  String get emailInvalid;

  /// No description provided for @phoneInvalid.
  ///
  /// In en, this message translates to:
  /// **'Use the international format, e.g. +37377712345'**
  String get phoneInvalid;

  /// No description provided for @notificationsTitle.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notificationsTitle;

  /// No description provided for @notificationsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Choose what we may tell you about. You can change it any time.'**
  String get notificationsSubtitle;

  /// No description provided for @notifOrderUpdates.
  ///
  /// In en, this message translates to:
  /// **'Order updates'**
  String get notifOrderUpdates;

  /// No description provided for @notifOrderUpdatesHint.
  ///
  /// In en, this message translates to:
  /// **'When your order is accepted, ready or on its way.'**
  String get notifOrderUpdatesHint;

  /// No description provided for @notifPromotions.
  ///
  /// In en, this message translates to:
  /// **'Promotions'**
  String get notifPromotions;

  /// No description provided for @notifPromotionsHint.
  ///
  /// In en, this message translates to:
  /// **'Discounts, new items and loyalty rewards.'**
  String get notifPromotionsHint;

  /// No description provided for @pushBlocked.
  ///
  /// In en, this message translates to:
  /// **'Notifications are turned off for takeAway in the system settings.'**
  String get pushBlocked;

  /// No description provided for @openSettings.
  ///
  /// In en, this message translates to:
  /// **'Open settings'**
  String get openSettings;

  /// No description provided for @loyaltyTitle.
  ///
  /// In en, this message translates to:
  /// **'Loyalty'**
  String get loyaltyTitle;

  /// No description provided for @loyaltyBalance.
  ///
  /// In en, this message translates to:
  /// **'Points balance'**
  String get loyaltyBalance;

  /// No description provided for @loyaltyActivity.
  ///
  /// In en, this message translates to:
  /// **'Recent activity'**
  String get loyaltyActivity;

  /// No description provided for @loyaltyEmpty.
  ///
  /// In en, this message translates to:
  /// **'Points will appear here after your first order.'**
  String get loyaltyEmpty;

  /// No description provided for @loyaltyHowTitle.
  ///
  /// In en, this message translates to:
  /// **'How it works'**
  String get loyaltyHowTitle;

  /// No description provided for @loyaltyHowBody.
  ///
  /// In en, this message translates to:
  /// **'Earn points on every paid order and spend them at checkout. The more you order, the higher your tier.'**
  String get loyaltyHowBody;

  /// No description provided for @referralsTitle.
  ///
  /// In en, this message translates to:
  /// **'Invite a friend'**
  String get referralsTitle;

  /// No description provided for @referralsBody.
  ///
  /// In en, this message translates to:
  /// **'Share your code. Your friend gets bonus points on their first paid order — and so do you.'**
  String get referralsBody;

  /// No description provided for @referralsYourCode.
  ///
  /// In en, this message translates to:
  /// **'Your code'**
  String get referralsYourCode;

  /// No description provided for @referralsCopied.
  ///
  /// In en, this message translates to:
  /// **'Code copied'**
  String get referralsCopied;

  /// No description provided for @referralsShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get referralsShare;

  /// No description provided for @referralsShareText.
  ///
  /// In en, this message translates to:
  /// **'Order coffee ahead with takeAway and skip the queue. Use my code {code} on your first order and we both get bonus points. {url}'**
  String referralsShareText(String code, String url);

  /// No description provided for @referralsSignups.
  ///
  /// In en, this message translates to:
  /// **'Friends joined'**
  String get referralsSignups;

  /// No description provided for @referralsRewarded.
  ///
  /// In en, this message translates to:
  /// **'First orders'**
  String get referralsRewarded;

  /// No description provided for @referralsPoints.
  ///
  /// In en, this message translates to:
  /// **'Points earned'**
  String get referralsPoints;

  /// No description provided for @referralsApplyTitle.
  ///
  /// In en, this message translates to:
  /// **'Have a friend\'s code?'**
  String get referralsApplyTitle;

  /// No description provided for @referralsApplyHint.
  ///
  /// In en, this message translates to:
  /// **'One time only, before your first paid order.'**
  String get referralsApplyHint;

  /// No description provided for @referralsApplied.
  ///
  /// In en, this message translates to:
  /// **'Bonus locked in with code {code}'**
  String referralsApplied(String code);

  /// No description provided for @referralsCodeHint.
  ///
  /// In en, this message translates to:
  /// **'Friend\'s code'**
  String get referralsCodeHint;

  /// No description provided for @giftCardsTitle.
  ///
  /// In en, this message translates to:
  /// **'Gift cards'**
  String get giftCardsTitle;

  /// No description provided for @giftCardsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No gift cards used yet. Enter a code at checkout and it will show up here.'**
  String get giftCardsEmpty;

  /// No description provided for @giftCardUsedOn.
  ///
  /// In en, this message translates to:
  /// **'Order #{code} · {brand}'**
  String giftCardUsedOn(String code, String brand);

  /// No description provided for @paymentMethodsTitle.
  ///
  /// In en, this message translates to:
  /// **'Payment methods'**
  String get paymentMethodsTitle;

  /// No description provided for @paymentMethodsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Add a card once and pay in one tap. We never see or store your full card number.'**
  String get paymentMethodsSubtitle;

  /// No description provided for @paymentMethodsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Card payments are not available yet. You can pay at the counter.'**
  String get paymentMethodsUnavailable;

  /// No description provided for @paymentMethodsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No cards yet'**
  String get paymentMethodsEmpty;

  /// No description provided for @cardDefault.
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get cardDefault;

  /// No description provided for @cardMakeDefault.
  ///
  /// In en, this message translates to:
  /// **'Make default'**
  String get cardMakeDefault;

  /// No description provided for @cardRemoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this card?'**
  String get cardRemoveTitle;

  /// No description provided for @cardInactive.
  ///
  /// In en, this message translates to:
  /// **'Blocked by the bank'**
  String get cardInactive;

  /// No description provided for @cardFallbackTitle.
  ///
  /// In en, this message translates to:
  /// **'Card'**
  String get cardFallbackTitle;

  /// No description provided for @cardAddTitle.
  ///
  /// In en, this message translates to:
  /// **'Add a card'**
  String get cardAddTitle;

  /// No description provided for @cardIssuer.
  ///
  /// In en, this message translates to:
  /// **'Issuing bank'**
  String get cardIssuer;

  /// No description provided for @cardLast4.
  ///
  /// In en, this message translates to:
  /// **'Last 4 digits of the card'**
  String get cardLast4;

  /// No description provided for @cardPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone number linked to the card'**
  String get cardPhone;

  /// No description provided for @cardPhoneHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 77712345'**
  String get cardPhoneHint;

  /// No description provided for @cardLabel.
  ///
  /// In en, this message translates to:
  /// **'Card name (optional)'**
  String get cardLabel;

  /// No description provided for @cardPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Your full card number is never sent or stored. The bank will text you a one-time code.'**
  String get cardPrivacy;

  /// No description provided for @cardSendCode.
  ///
  /// In en, this message translates to:
  /// **'Send the code'**
  String get cardSendCode;

  /// No description provided for @cardCodeTitle.
  ///
  /// In en, this message translates to:
  /// **'Enter the code'**
  String get cardCodeTitle;

  /// No description provided for @cardCodeSent.
  ///
  /// In en, this message translates to:
  /// **'We sent a one-time code to {phone}.'**
  String cardCodeSent(String phone);

  /// No description provided for @cardStartOver.
  ///
  /// In en, this message translates to:
  /// **'Enter the details again'**
  String get cardStartOver;

  /// No description provided for @cardAdded.
  ///
  /// In en, this message translates to:
  /// **'Card added'**
  String get cardAdded;

  /// No description provided for @cardRefresh.
  ///
  /// In en, this message translates to:
  /// **'Check with the bank'**
  String get cardRefresh;

  /// No description provided for @languageTitle.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get languageTitle;

  /// No description provided for @languageSystem.
  ///
  /// In en, this message translates to:
  /// **'Same as the device'**
  String get languageSystem;

  /// No description provided for @languageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// No description provided for @languageRussian.
  ///
  /// In en, this message translates to:
  /// **'Русский'**
  String get languageRussian;

  /// No description provided for @aboutBody.
  ///
  /// In en, this message translates to:
  /// **'takeAway — pre-order coffee and food. Choose, pay and pick it up without waiting in line.'**
  String get aboutBody;

  /// No description provided for @locationDenied.
  ///
  /// In en, this message translates to:
  /// **'Location access is off. Allow it in settings to see stores near you.'**
  String get locationDenied;

  /// No description provided for @locationServiceOff.
  ///
  /// In en, this message translates to:
  /// **'Location services are turned off.'**
  String get locationServiceOff;

  /// No description provided for @greetingMorning.
  ///
  /// In en, this message translates to:
  /// **'Good morning'**
  String get greetingMorning;

  /// No description provided for @greetingAfternoon.
  ///
  /// In en, this message translates to:
  /// **'Good afternoon'**
  String get greetingAfternoon;

  /// No description provided for @greetingEvening.
  ///
  /// In en, this message translates to:
  /// **'Good evening'**
  String get greetingEvening;

  /// No description provided for @greetingWithName.
  ///
  /// In en, this message translates to:
  /// **'{greeting}, {name}'**
  String greetingWithName(String greeting, String name);

  /// No description provided for @pickupPoint.
  ///
  /// In en, this message translates to:
  /// **'Pickup point'**
  String get pickupPoint;

  /// No description provided for @quickAdd.
  ///
  /// In en, this message translates to:
  /// **'Add to cart'**
  String get quickAdd;

  /// No description provided for @cartBarLabel.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item} other{{count} items}} · ready by {time}'**
  String cartBarLabel(int count, String time);

  /// No description provided for @liveOrder.
  ///
  /// In en, this message translates to:
  /// **'Live order'**
  String get liveOrder;

  /// No description provided for @categoriesAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get categoriesAll;

  /// No description provided for @copy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get copy;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['en', 'ru'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'ru':
      return AppLocalizationsRu();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
