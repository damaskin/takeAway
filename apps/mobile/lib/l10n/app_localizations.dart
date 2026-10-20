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

  /// No description provided for @timeJustNow.
  ///
  /// In en, this message translates to:
  /// **'Just now'**
  String get timeJustNow;

  /// No description provided for @timeMinutesAgo.
  ///
  /// In en, this message translates to:
  /// **'{count} min ago'**
  String timeMinutesAgo(int count);

  /// No description provided for @timeHoursAgo.
  ///
  /// In en, this message translates to:
  /// **'{count} h ago'**
  String timeHoursAgo(int count);

  /// No description provided for @timeYesterday.
  ///
  /// In en, this message translates to:
  /// **'Yesterday'**
  String get timeYesterday;

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

  /// The two placeholders become links, filled with signInAgreementTerms and signInAgreementPrivacy.
  ///
  /// In en, this message translates to:
  /// **'By continuing you agree to the {terms} and {privacy}.'**
  String signInAgreement(String terms, String privacy);

  /// No description provided for @signInAgreementTerms.
  ///
  /// In en, this message translates to:
  /// **'Terms of Service'**
  String get signInAgreementTerms;

  /// No description provided for @signInAgreementPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Privacy Policy'**
  String get signInAgreementPrivacy;

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

  /// No description provided for @emailSignIn.
  ///
  /// In en, this message translates to:
  /// **'Continue with email'**
  String get emailSignIn;

  /// No description provided for @emailSignInOtherMethods.
  ///
  /// In en, this message translates to:
  /// **'Other ways to sign in'**
  String get emailSignInOtherMethods;

  /// No description provided for @emailSignInEmailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get emailSignInEmailLabel;

  /// No description provided for @emailSignInEmailHint.
  ///
  /// In en, this message translates to:
  /// **'you@example.com'**
  String get emailSignInEmailHint;

  /// No description provided for @emailSignInGetCode.
  ///
  /// In en, this message translates to:
  /// **'Get a code'**
  String get emailSignInGetCode;

  /// No description provided for @emailSignInSentTo.
  ///
  /// In en, this message translates to:
  /// **'We sent a code to {email}. It is valid for 10 minutes.'**
  String emailSignInSentTo(String email);

  /// No description provided for @emailSignInAlreadySent.
  ///
  /// In en, this message translates to:
  /// **'A code was already sent to {email} — check your inbox.'**
  String emailSignInAlreadySent(String email);

  /// No description provided for @emailSignInCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Code from the email'**
  String get emailSignInCodeLabel;

  /// No description provided for @emailSignInResend.
  ///
  /// In en, this message translates to:
  /// **'Send the code again'**
  String get emailSignInResend;

  /// No description provided for @emailSignInResendIn.
  ///
  /// In en, this message translates to:
  /// **'Send again in {seconds} s'**
  String emailSignInResendIn(int seconds);

  /// No description provided for @emailSignInChangeEmail.
  ///
  /// In en, this message translates to:
  /// **'Change email'**
  String get emailSignInChangeEmail;

  /// No description provided for @emailSignInInvalidEmail.
  ///
  /// In en, this message translates to:
  /// **'Check the address — it needs an @ and a domain, like ivan@mail.ru.'**
  String get emailSignInInvalidEmail;

  /// No description provided for @emailCodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'Wrong code. Attempts left: {left}.'**
  String emailCodeInvalid(int left);

  /// No description provided for @emailCodeExpired.
  ///
  /// In en, this message translates to:
  /// **'The code has expired or was already used. Ask for a new one.'**
  String get emailCodeExpired;

  /// No description provided for @emailCodeTooManyAttempts.
  ///
  /// In en, this message translates to:
  /// **'Too many wrong attempts — this code no longer works. Ask for a new one.'**
  String get emailCodeTooManyAttempts;

  /// No description provided for @emailCodeLimit.
  ///
  /// In en, this message translates to:
  /// **'Too many codes were sent to this address. Try again in {minutes} min.'**
  String emailCodeLimit(int minutes);

  /// No description provided for @emailCodeNotSent.
  ///
  /// In en, this message translates to:
  /// **'We could not send the email. Try again in a few minutes.'**
  String get emailCodeNotSent;

  /// No description provided for @emailSignInUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Sign-in with email is unavailable right now. Choose another way.'**
  String get emailSignInUnavailable;

  /// No description provided for @emailSignInStaffAccount.
  ///
  /// In en, this message translates to:
  /// **'This address belongs to a staff account. Sign in with your password in the business cabinet.'**
  String get emailSignInStaffAccount;

  /// No description provided for @emailSignInTooManyRequests.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts in a row. Wait a minute and try again.'**
  String get emailSignInTooManyRequests;

  /// No description provided for @signInMethodsTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign-in methods'**
  String get signInMethodsTitle;

  /// No description provided for @signInMethodsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Connect Telegram, Google and Apple to one profile, and your orders and points stay with you whichever way you sign in.'**
  String get signInMethodsSubtitle;

  /// No description provided for @signInMethodLinked.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get signInMethodLinked;

  /// No description provided for @signInMethodNotLinked.
  ///
  /// In en, this message translates to:
  /// **'Not connected'**
  String get signInMethodNotLinked;

  /// No description provided for @signInMethodLink.
  ///
  /// In en, this message translates to:
  /// **'Connect'**
  String get signInMethodLink;

  /// No description provided for @signInMethodUnlink.
  ///
  /// In en, this message translates to:
  /// **'Disconnect'**
  String get signInMethodUnlink;

  /// No description provided for @signInMethodUnlinkConfirm.
  ///
  /// In en, this message translates to:
  /// **'Disconnect {provider}?'**
  String signInMethodUnlinkConfirm(String provider);

  /// No description provided for @signInMethodUnlinkHint.
  ///
  /// In en, this message translates to:
  /// **'You will no longer be able to sign in with {provider}.'**
  String signInMethodUnlinkHint(String provider);

  /// No description provided for @signInMethodSwitched.
  ///
  /// In en, this message translates to:
  /// **'That account already had orders, so you are now in that profile.'**
  String get signInMethodSwitched;

  /// No description provided for @signInMethodIosOnly.
  ///
  /// In en, this message translates to:
  /// **'On iPhone'**
  String get signInMethodIosOnly;

  /// No description provided for @signInMethodEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get signInMethodEmail;

  /// No description provided for @signInMethodEmailHint.
  ///
  /// In en, this message translates to:
  /// **'Sign-in codes go to {email}'**
  String signInMethodEmailHint(String email);

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

  /// No description provided for @storeStatusNotWorking.
  ///
  /// In en, this message translates to:
  /// **'Not working'**
  String get storeStatusNotWorking;

  /// Store card / menu header: closed for orders now, taking pre-orders.
  ///
  /// In en, this message translates to:
  /// **'Closed now · opens at {time} · order ahead'**
  String storeOpensAt(String time);

  /// No description provided for @storeOpensTomorrowAt.
  ///
  /// In en, this message translates to:
  /// **'Closed now · opens tomorrow at {time} · order ahead'**
  String storeOpensTomorrowAt(String time);

  /// No description provided for @storeOpensOnAt.
  ///
  /// In en, this message translates to:
  /// **'Closed now · opens {date} at {time} · order ahead'**
  String storeOpensOnAt(String date, String time);

  /// No description provided for @storeClosedPreorder.
  ///
  /// In en, this message translates to:
  /// **'Closed now · order ahead'**
  String get storeClosedPreorder;

  /// No description provided for @storeQueueFullPreorder.
  ///
  /// In en, this message translates to:
  /// **'Long queue — order ahead only'**
  String get storeQueueFullPreorder;

  /// Store card while the kitchen paused the store; pre-orders for later are taken.
  ///
  /// In en, this message translates to:
  /// **'Short break until {time} · order ahead'**
  String storePausedPreorder(String time);

  /// Store card when an order for now would not be ready before the store closes.
  ///
  /// In en, this message translates to:
  /// **'Closing soon — order ahead only'**
  String get storeClosingSoonPreorder;

  /// Beside the wait of an open store: when it closes.
  ///
  /// In en, this message translates to:
  /// **'until {time}'**
  String storeOpenUntil(String time);

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
  /// **'Choose a store that is taking orders now and we will show its menu and how soon your order can be ready.'**
  String get chooseStoreSubtitle;

  /// No description provided for @storesInactiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Not taking orders right now'**
  String get storesInactiveTitle;

  /// No description provided for @storesNoneActive.
  ///
  /// In en, this message translates to:
  /// **'No store is taking orders right now. Check back a little later.'**
  String get storesNoneActive;

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
  /// **'Call the store'**
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
  /// **'No free windows in the next 24 hours. Try ASAP.'**
  String get noSlots;

  /// No description provided for @noSlotsClosed.
  ///
  /// In en, this message translates to:
  /// **'No free windows in the next 24 hours.'**
  String get noSlotsClosed;

  /// No description provided for @slotsHint.
  ///
  /// In en, this message translates to:
  /// **'Only windows this store can still keep up with.'**
  String get slotsHint;

  /// Why ASAP is off at checkout.
  ///
  /// In en, this message translates to:
  /// **'The store opens at {time} — pick a time for your order.'**
  String asapBlockedOpensAt(String time);

  /// No description provided for @asapBlockedOpensTomorrowAt.
  ///
  /// In en, this message translates to:
  /// **'The store opens tomorrow at {time} — pick a time for your order.'**
  String asapBlockedOpensTomorrowAt(String time);

  /// No description provided for @asapBlockedOpensOnAt.
  ///
  /// In en, this message translates to:
  /// **'The store opens {date} at {time} — pick a time for your order.'**
  String asapBlockedOpensOnAt(String date, String time);

  /// No description provided for @asapBlockedShiftClosed.
  ///
  /// In en, this message translates to:
  /// **'The store has not started work yet — pick a time for your order.'**
  String get asapBlockedShiftClosed;

  /// No description provided for @asapBlockedQueueFull.
  ///
  /// In en, this message translates to:
  /// **'There is a long queue right now — pick a time for your order.'**
  String get asapBlockedQueueFull;

  /// No description provided for @asapBlockedPausedUntil.
  ///
  /// In en, this message translates to:
  /// **'The store is on a short break until {time} — pick a time for your order.'**
  String asapBlockedPausedUntil(String time);

  /// No description provided for @asapBlockedPaused.
  ///
  /// In en, this message translates to:
  /// **'The store is on a short break — pick a time for your order.'**
  String get asapBlockedPaused;

  /// No description provided for @asapBlockedClosingSoonAt.
  ///
  /// In en, this message translates to:
  /// **'The store closes at {time} — there is no time left to make an order for now. Pick a time.'**
  String asapBlockedClosingSoonAt(String time);

  /// No description provided for @asapBlockedClosingSoon.
  ///
  /// In en, this message translates to:
  /// **'The store closes soon — there is no time left to make an order for now. Pick a time.'**
  String get asapBlockedClosingSoon;

  /// No description provided for @asapBlockedClosed.
  ///
  /// In en, this message translates to:
  /// **'The store is closed right now — pick a time for your order.'**
  String get asapBlockedClosed;

  /// Heading over today's pickup windows.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get slotDayToday;

  /// No description provided for @slotDayTomorrow.
  ///
  /// In en, this message translates to:
  /// **'Tomorrow'**
  String get slotDayTomorrow;

  /// A pickup time on the next calendar day.
  ///
  /// In en, this message translates to:
  /// **'{time} tomorrow'**
  String timeTomorrow(String time);

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

  /// No description provided for @cardPaymentsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Card payments are unavailable right now, so the order can\'t be placed. Please try again a bit later.'**
  String get cardPaymentsUnavailable;

  /// No description provided for @addCardToOrder.
  ///
  /// In en, this message translates to:
  /// **'Orders are paid by card. Add a card to place your order.'**
  String get addCardToOrder;

  /// No description provided for @addCard.
  ///
  /// In en, this message translates to:
  /// **'Add a card'**
  String get addCard;

  /// No description provided for @holdHint.
  ///
  /// In en, this message translates to:
  /// **'Your card is charged only once the store accepts your order.'**
  String get holdHint;

  /// Checkout, web payment flow: the card is entered on the bank's hosted page.
  ///
  /// In en, this message translates to:
  /// **'You pay by card on the bank\'s secure page. The amount is held now and charged when the store accepts your order.'**
  String get webPaymentHint;

  /// Snack when no in-app browser could open the bank's payment page.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open the payment page. Tap \"Pay\" to try again.'**
  String get webPaymentNotOpened;

  /// Snack when the bank sends the customer back with a failed payment.
  ///
  /// In en, this message translates to:
  /// **'The payment did not go through. You can try again.'**
  String get webPaymentFailed;

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
  /// **'Order picked up'**
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
  /// **'Did not go through'**
  String get statusExpired;

  /// Order screen: on the kitchen board, not accepted yet.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the store to confirm'**
  String get orderAwaitingAcceptance;

  /// No description provided for @orderPreorderAwaitingOpening.
  ///
  /// In en, this message translates to:
  /// **'The store will confirm your pre-order when it opens'**
  String get orderPreorderAwaitingOpening;

  /// Accepted or being made, and past its due time (the kitchen's new estimate, else the pickup time).
  ///
  /// In en, this message translates to:
  /// **'Running a little late'**
  String get orderRunningLate;

  /// The kitchen accepted or started the order too late for its pickup time and gave a new estimate.
  ///
  /// In en, this message translates to:
  /// **'Cooking · ready in {minutes} min'**
  String orderNewEstimate(int minutes);

  /// No description provided for @orderExpiredNotAccepted.
  ///
  /// In en, this message translates to:
  /// **'The store did not confirm the order — you were not charged'**
  String get orderExpiredNotAccepted;

  /// No description provided for @orderExpiredNotAcceptedRefunded.
  ///
  /// In en, this message translates to:
  /// **'The store did not confirm the order — the money is on its way back'**
  String get orderExpiredNotAcceptedRefunded;

  /// No description provided for @orderExpiredPaymentNotCompleted.
  ///
  /// In en, this message translates to:
  /// **'The payment did not go through — the order is cancelled'**
  String get orderExpiredPaymentNotCompleted;

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
  /// **'Charged when the store accepts'**
  String get paymentStateHeld;

  /// No description provided for @paymentStateHeldHint.
  ///
  /// In en, this message translates to:
  /// **'If the store does not accept the order, your card is not charged.'**
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

  /// A cancelled or expired order whose card was never charged.
  ///
  /// In en, this message translates to:
  /// **'You were not charged'**
  String get paymentStateNotCharged;

  /// No description provided for @paymentStateAtCounter.
  ///
  /// In en, this message translates to:
  /// **'Paying at the counter'**
  String get paymentStateAtCounter;

  /// No description provided for @paymentStateAwaiting.
  ///
  /// In en, this message translates to:
  /// **'Awaiting payment'**
  String get paymentStateAwaiting;

  /// Over the order number on the order screen; the kitchen hands the order over by it.
  ///
  /// In en, this message translates to:
  /// **'Your code'**
  String get pickupCode;

  /// No description provided for @pickupCodeHint.
  ///
  /// In en, this message translates to:
  /// **'Show it at the counter'**
  String get pickupCodeHint;

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
  /// **'The store has not accepted it yet, so nothing was charged. If an amount is held on your card, the hold is released.'**
  String get cancelOrderBody;

  /// In place of «Cancel order» once the kitchen accepted the order or the money was taken; also the error when a cancel comes too late.
  ///
  /// In en, this message translates to:
  /// **'Your order is already being made — call the store to cancel it'**
  String get cancelByPhone;

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

  /// No description provided for @profileInbox.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get profileInbox;

  /// No description provided for @profileNotifications.
  ///
  /// In en, this message translates to:
  /// **'Notification settings'**
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

  /// No description provided for @profileFeedback.
  ///
  /// In en, this message translates to:
  /// **'Feedback'**
  String get profileFeedback;

  /// No description provided for @feedbackIntro.
  ///
  /// In en, this message translates to:
  /// **'Tell us what you liked, what we should improve or what went wrong. The takeAway team reads every message.'**
  String get feedbackIntro;

  /// No description provided for @feedbackKindReview.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get feedbackKindReview;

  /// No description provided for @feedbackKindSuggestion.
  ///
  /// In en, this message translates to:
  /// **'Suggestion'**
  String get feedbackKindSuggestion;

  /// No description provided for @feedbackKindProblem.
  ///
  /// In en, this message translates to:
  /// **'Problem'**
  String get feedbackKindProblem;

  /// No description provided for @feedbackMessageLabel.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get feedbackMessageLabel;

  /// No description provided for @feedbackHintReview.
  ///
  /// In en, this message translates to:
  /// **'What did you like, and what not so much?'**
  String get feedbackHintReview;

  /// No description provided for @feedbackHintSuggestion.
  ///
  /// In en, this message translates to:
  /// **'What should we add or improve?'**
  String get feedbackHintSuggestion;

  /// No description provided for @feedbackHintProblem.
  ///
  /// In en, this message translates to:
  /// **'What happened? If it\'s about an order, add its number.'**
  String get feedbackHintProblem;

  /// No description provided for @feedbackMessageRequired.
  ///
  /// In en, this message translates to:
  /// **'Write a few words'**
  String get feedbackMessageRequired;

  /// No description provided for @feedbackContactLabel.
  ///
  /// In en, this message translates to:
  /// **'How to reach you (optional)'**
  String get feedbackContactLabel;

  /// No description provided for @feedbackContactHint.
  ///
  /// In en, this message translates to:
  /// **'Telegram, phone or email'**
  String get feedbackContactHint;

  /// No description provided for @feedbackSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get feedbackSend;

  /// No description provided for @feedbackSentTitle.
  ///
  /// In en, this message translates to:
  /// **'Thank you!'**
  String get feedbackSentTitle;

  /// No description provided for @feedbackSentBody.
  ///
  /// In en, this message translates to:
  /// **'Your message is with the takeAway team. If you left a contact, we\'ll get back to you.'**
  String get feedbackSentBody;

  /// No description provided for @feedbackDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get feedbackDone;

  /// No description provided for @feedbackTooMany.
  ///
  /// In en, this message translates to:
  /// **'That\'s a lot of messages in a row. Please try again in an hour.'**
  String get feedbackTooMany;

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

  /// No description provided for @deleteAccount.
  ///
  /// In en, this message translates to:
  /// **'Delete account'**
  String get deleteAccount;

  /// No description provided for @deleteAccountTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete your account?'**
  String get deleteAccountTitle;

  /// No description provided for @deleteAccountBody.
  ///
  /// In en, this message translates to:
  /// **'Your profile, saved cards, loyalty points, sign-in methods and personal data will be deleted. Businesses keep your order history, but only in anonymised form. This cannot be undone.'**
  String get deleteAccountBody;

  /// No description provided for @deleteAccountApple.
  ///
  /// In en, this message translates to:
  /// **'Apple will ask you to confirm, and takeAway will stop using your Apple ID.'**
  String get deleteAccountApple;

  /// No description provided for @deleteAccountConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete for good'**
  String get deleteAccountConfirm;

  /// No description provided for @deleteAccountStaff.
  ///
  /// In en, this message translates to:
  /// **'Staff accounts are deleted by the business admin.'**
  String get deleteAccountStaff;

  /// No description provided for @deleteAccountAppleCancelled.
  ///
  /// In en, this message translates to:
  /// **'Deleting the account needs your confirmation with Apple.'**
  String get deleteAccountAppleCancelled;

  /// No description provided for @accountDeleted.
  ///
  /// In en, this message translates to:
  /// **'Your account has been deleted'**
  String get accountDeleted;

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

  /// No description provided for @emailIsSignInMethod.
  ///
  /// In en, this message translates to:
  /// **'You sign in with codes sent to this email. To change it, first connect Telegram, Google or Apple in Sign-in methods.'**
  String get emailIsSignInMethod;

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

  /// No description provided for @inboxTitle.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get inboxTitle;

  /// No description provided for @inboxReadAll.
  ///
  /// In en, this message translates to:
  /// **'Mark all read'**
  String get inboxReadAll;

  /// No description provided for @inboxEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet'**
  String get inboxEmptyTitle;

  /// No description provided for @inboxEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'News from cafés and takeAway will appear here.'**
  String get inboxEmptyBody;

  /// No description provided for @inboxUnread.
  ///
  /// In en, this message translates to:
  /// **'Unread'**
  String get inboxUnread;

  /// No description provided for @inboxOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get inboxOpen;

  /// No description provided for @inboxOpenMenu.
  ///
  /// In en, this message translates to:
  /// **'Open {name} menu'**
  String inboxOpenMenu(String name);

  /// No description provided for @inboxShowPlaces.
  ///
  /// In en, this message translates to:
  /// **'Show {name} places'**
  String inboxShowPlaces(String name);

  /// No description provided for @inboxGone.
  ///
  /// In en, this message translates to:
  /// **'This notification is no longer available.'**
  String get inboxGone;

  /// No description provided for @notificationsTitle.
  ///
  /// In en, this message translates to:
  /// **'Notification settings'**
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

  /// No description provided for @aboutPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Privacy Policy'**
  String get aboutPrivacy;

  /// No description provided for @aboutTerms.
  ///
  /// In en, this message translates to:
  /// **'Terms of Service'**
  String get aboutTerms;

  /// No description provided for @aboutSupport.
  ///
  /// In en, this message translates to:
  /// **'Support'**
  String get aboutSupport;

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

  /// No description provided for @menuNoStoreTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose a store first'**
  String get menuNoStoreTitle;

  /// No description provided for @menuNoStoreBody.
  ///
  /// In en, this message translates to:
  /// **'Pick where you\'ll collect your order — we\'ll show its menu and how soon it can be ready.'**
  String get menuNoStoreBody;

  /// No description provided for @pickStore.
  ///
  /// In en, this message translates to:
  /// **'Choose a store'**
  String get pickStore;

  /// No description provided for @storeClosedTitle.
  ///
  /// In en, this message translates to:
  /// **'This store is closed'**
  String get storeClosedTitle;

  /// No description provided for @storeClosedBody.
  ///
  /// In en, this message translates to:
  /// **'It isn\'t taking orders right now. Choose another store or check back later.'**
  String get storeClosedBody;

  /// No description provided for @hoursToday.
  ///
  /// In en, this message translates to:
  /// **'Today: {hours}'**
  String hoursToday(String hours);

  /// No description provided for @hoursTomorrow.
  ///
  /// In en, this message translates to:
  /// **'Tomorrow: {hours}'**
  String hoursTomorrow(String hours);

  /// No description provided for @pickAnotherStore.
  ///
  /// In en, this message translates to:
  /// **'Choose another store'**
  String get pickAnotherStore;

  /// No description provided for @storeClosedNow.
  ///
  /// In en, this message translates to:
  /// **'Closed now'**
  String get storeClosedNow;

  /// No description provided for @storeClosedNoOrders.
  ///
  /// In en, this message translates to:
  /// **'This store is closed and isn\'t taking orders right now.'**
  String get storeClosedNoOrders;

  /// No description provided for @storeClosedCheckout.
  ///
  /// In en, this message translates to:
  /// **'The store is closed right now, so the order can\'t be placed. Choose another store or check back later.'**
  String get storeClosedCheckout;

  /// No description provided for @orderReadyHeadline.
  ///
  /// In en, this message translates to:
  /// **'Your order is ready'**
  String get orderReadyHeadline;

  /// No description provided for @orderReadySlogan.
  ///
  /// In en, this message translates to:
  /// **'You spent 0 minutes in the queue. Enjoy!'**
  String get orderReadySlogan;

  /// No description provided for @orderPickedUpSlogan.
  ///
  /// In en, this message translates to:
  /// **'Not a minute in the queue — just as planned. Have a great day!'**
  String get orderPickedUpSlogan;

  /// No description provided for @notificationsDenied.
  ///
  /// In en, this message translates to:
  /// **'Notifications are turned off in your phone\'s settings.'**
  String get notificationsDenied;

  /// No description provided for @storesRadius500.
  ///
  /// In en, this message translates to:
  /// **'500 m'**
  String get storesRadius500;

  /// No description provided for @storesRadius1km.
  ///
  /// In en, this message translates to:
  /// **'1 km'**
  String get storesRadius1km;

  /// No description provided for @storesRadiusAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get storesRadiusAll;

  /// No description provided for @storesKindAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get storesKindAll;

  /// No description provided for @storesKindCoffee.
  ///
  /// In en, this message translates to:
  /// **'Coffee'**
  String get storesKindCoffee;

  /// No description provided for @storesKindFood.
  ///
  /// In en, this message translates to:
  /// **'Food'**
  String get storesKindFood;

  /// No description provided for @storesNearbyEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing within {radius}'**
  String storesNearbyEmpty(String radius);

  /// No description provided for @storesShowRadius.
  ///
  /// In en, this message translates to:
  /// **'Show {radius}'**
  String storesShowRadius(String radius);

  /// No description provided for @storesShowAll.
  ///
  /// In en, this message translates to:
  /// **'Show all stores'**
  String get storesShowAll;

  /// No description provided for @locationUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t tell where you are. Try again in a moment.'**
  String get locationUnavailable;

  /// No description provided for @productNoteFood.
  ///
  /// In en, this message translates to:
  /// **'Order comment'**
  String get productNoteFood;

  /// No description provided for @productNoteFoodHint.
  ///
  /// In en, this message translates to:
  /// **'E.g. warm it up, no sauce…'**
  String get productNoteFoodHint;

  /// No description provided for @productContains.
  ///
  /// In en, this message translates to:
  /// **'Contains: {list}'**
  String productContains(String list);

  /// No description provided for @productAddonsNone.
  ///
  /// In en, this message translates to:
  /// **'none'**
  String get productAddonsNone;

  /// No description provided for @productRequired.
  ///
  /// In en, this message translates to:
  /// **'required'**
  String get productRequired;

  /// No description provided for @productPairsWith.
  ///
  /// In en, this message translates to:
  /// **'Goes well with it'**
  String get productPairsWith;

  /// No description provided for @cartUpsellTitle.
  ///
  /// In en, this message translates to:
  /// **'Something to go with it?'**
  String get cartUpsellTitle;

  /// Title of a suggestions row, only over what the store's customers really bought together with these products.
  ///
  /// In en, this message translates to:
  /// **'Often bought together'**
  String get upsellTogether;

  /// No description provided for @allergenGluten.
  ///
  /// In en, this message translates to:
  /// **'gluten'**
  String get allergenGluten;

  /// No description provided for @allergenMilk.
  ///
  /// In en, this message translates to:
  /// **'milk'**
  String get allergenMilk;

  /// No description provided for @allergenLactose.
  ///
  /// In en, this message translates to:
  /// **'lactose'**
  String get allergenLactose;

  /// No description provided for @allergenEggs.
  ///
  /// In en, this message translates to:
  /// **'eggs'**
  String get allergenEggs;

  /// No description provided for @allergenNuts.
  ///
  /// In en, this message translates to:
  /// **'nuts'**
  String get allergenNuts;

  /// No description provided for @allergenPeanuts.
  ///
  /// In en, this message translates to:
  /// **'peanuts'**
  String get allergenPeanuts;

  /// No description provided for @allergenSoy.
  ///
  /// In en, this message translates to:
  /// **'soy'**
  String get allergenSoy;

  /// No description provided for @allergenFish.
  ///
  /// In en, this message translates to:
  /// **'fish'**
  String get allergenFish;

  /// No description provided for @allergenShellfish.
  ///
  /// In en, this message translates to:
  /// **'shellfish'**
  String get allergenShellfish;

  /// No description provided for @allergenSesame.
  ///
  /// In en, this message translates to:
  /// **'sesame'**
  String get allergenSesame;

  /// No description provided for @allergenCelery.
  ///
  /// In en, this message translates to:
  /// **'celery'**
  String get allergenCelery;

  /// No description provided for @allergenMustard.
  ///
  /// In en, this message translates to:
  /// **'mustard'**
  String get allergenMustard;

  /// No description provided for @allergenSulphites.
  ///
  /// In en, this message translates to:
  /// **'sulphites'**
  String get allergenSulphites;

  /// No description provided for @errCartEmpty.
  ///
  /// In en, this message translates to:
  /// **'Your cart is empty'**
  String get errCartEmpty;

  /// No description provided for @errStoreNotTakingOrders.
  ///
  /// In en, this message translates to:
  /// **'This store is not taking orders right now'**
  String get errStoreNotTakingOrders;

  /// No description provided for @errStoreClosedAtTime.
  ///
  /// In en, this message translates to:
  /// **'The store is closed at that time — pick another time'**
  String get errStoreClosedAtTime;

  /// No description provided for @errPickupSlotFull.
  ///
  /// In en, this message translates to:
  /// **'That time has just been taken — pick another one'**
  String get errPickupSlotFull;

  /// No description provided for @errAsapUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The store can no longer take an order for now — pick a time for it'**
  String get errAsapUnavailable;

  /// No description provided for @errPickupTimeOutOfRange.
  ///
  /// In en, this message translates to:
  /// **'A scheduled pickup must be {minMinutes} min to {maxHours} h from now'**
  String errPickupTimeOutOfRange(int minMinutes, int maxHours);

  /// No description provided for @errItemsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Not available right now: {items}'**
  String errItemsUnavailable(String items);

  /// No description provided for @errItemsUnavailableGeneric.
  ///
  /// In en, this message translates to:
  /// **'Some items are not available right now'**
  String get errItemsUnavailableGeneric;

  /// No description provided for @errBelowMinOrder.
  ///
  /// In en, this message translates to:
  /// **'The minimum order is {amount}'**
  String errBelowMinOrder(String amount);

  /// No description provided for @errBelowMinOrderGeneric.
  ///
  /// In en, this message translates to:
  /// **'The order is below the minimum'**
  String get errBelowMinOrderGeneric;

  /// No description provided for @errDeliveryUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Delivery is not available right now'**
  String get errDeliveryUnavailable;

  /// No description provided for @errDeliveryAddressRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a delivery address'**
  String get errDeliveryAddressRequired;

  /// No description provided for @errDeliveryOutOfRange.
  ///
  /// In en, this message translates to:
  /// **'That address is outside the delivery area'**
  String get errDeliveryOutOfRange;

  /// No description provided for @errPromoUnknown.
  ///
  /// In en, this message translates to:
  /// **'There is no such promo code'**
  String get errPromoUnknown;

  /// No description provided for @errPromoInactive.
  ///
  /// In en, this message translates to:
  /// **'This promo code is not active right now'**
  String get errPromoInactive;

  /// No description provided for @errPromoNotStarted.
  ///
  /// In en, this message translates to:
  /// **'This promo code has not started yet'**
  String get errPromoNotStarted;

  /// No description provided for @errPromoExpired.
  ///
  /// In en, this message translates to:
  /// **'This promo code has expired'**
  String get errPromoExpired;

  /// No description provided for @errPromoMinOrder.
  ///
  /// In en, this message translates to:
  /// **'This promo code needs an order of {amount} or more'**
  String errPromoMinOrder(String amount);

  /// No description provided for @errPromoMinOrderGeneric.
  ///
  /// In en, this message translates to:
  /// **'The order is too small for this promo code'**
  String get errPromoMinOrderGeneric;

  /// No description provided for @errPromoLimitReached.
  ///
  /// In en, this message translates to:
  /// **'This promo code has run out'**
  String get errPromoLimitReached;

  /// No description provided for @errPromoAlreadyUsed.
  ///
  /// In en, this message translates to:
  /// **'You have already used this promo code'**
  String get errPromoAlreadyUsed;

  /// No description provided for @errPromoNotEligible.
  ///
  /// In en, this message translates to:
  /// **'This code is for customers who haven\'t ordered in a while'**
  String get errPromoNotEligible;

  /// No description provided for @errGiftCardUnknown.
  ///
  /// In en, this message translates to:
  /// **'There is no such gift card'**
  String get errGiftCardUnknown;

  /// No description provided for @errGiftCardOtherBrand.
  ///
  /// In en, this message translates to:
  /// **'This gift card is not valid here'**
  String get errGiftCardOtherBrand;

  /// No description provided for @errGiftCardCurrency.
  ///
  /// In en, this message translates to:
  /// **'This gift card is in another currency'**
  String get errGiftCardCurrency;

  /// No description provided for @errGiftCardExpired.
  ///
  /// In en, this message translates to:
  /// **'This gift card has expired'**
  String get errGiftCardExpired;

  /// No description provided for @errGiftCardUsedUp.
  ///
  /// In en, this message translates to:
  /// **'This gift card has no balance left'**
  String get errGiftCardUsedUp;

  /// No description provided for @errGiftCardCancelled.
  ///
  /// In en, this message translates to:
  /// **'This gift card has been cancelled'**
  String get errGiftCardCancelled;

  /// Checkout refused: another order spent the gift card while this one was being placed (GIFT_CARD_BALANCE_CHANGED).
  ///
  /// In en, this message translates to:
  /// **'The gift card balance has just changed — check the card and try again'**
  String get errGiftCardBalanceChanged;

  /// Checkout refused: the customer already has the maximum number of unpaid orders (TOO_MANY_UNPAID_ORDERS).
  ///
  /// In en, this message translates to:
  /// **'You already have unpaid orders — pay for or cancel one before placing a new one'**
  String get errTooManyUnpaidOrders;
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
