// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Russian (`ru`).
class AppLocalizationsRu extends AppLocalizations {
  AppLocalizationsRu([String locale = 'ru']) : super(locale);

  @override
  String get appName => 'takeAway';

  @override
  String get tagline => 'Предзаказ. Без очередей. Заберите сами.';

  @override
  String get retry => 'Повторить';

  @override
  String get cancel => 'Отмена';

  @override
  String get confirm => 'Подтвердить';

  @override
  String get save => 'Сохранить';

  @override
  String get apply => 'Применить';

  @override
  String get remove => 'Удалить';

  @override
  String get close => 'Закрыть';

  @override
  String get done => 'Готово';

  @override
  String get continueLabel => 'Продолжить';

  @override
  String get undo => 'Вернуть';

  @override
  String get loading => 'Загрузка…';

  @override
  String get genericError => 'Что-то пошло не так. Попробуйте ещё раз.';

  @override
  String get networkError => 'Нет соединения. Проверьте интернет и попробуйте снова.';

  @override
  String get sessionExpired => 'Сессия истекла. Войдите снова.';

  @override
  String get subtotal => 'Сумма';

  @override
  String get total => 'Итого';

  @override
  String get tax => 'Налог';

  @override
  String get taxIncluded => 'В т. ч. налог';

  @override
  String get deliveryFee => 'Доставка';

  @override
  String get soldOut => 'Закончилось';

  @override
  String priceFrom(String price) {
    return 'от $price';
  }

  @override
  String minutes(int count) {
    return '$count мин';
  }

  @override
  String readyInMinutes(int count) {
    return 'Готово через ~$count мин';
  }

  @override
  String readyBy(String time) {
    return 'Готово к $time';
  }

  @override
  String itemsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count позиции',
      many: '$count позиций',
      few: '$count позиции',
      one: '$count позиция',
    );
    return '$_temp0';
  }

  @override
  String get navMenu => 'Меню';

  @override
  String get navStores => 'Точки';

  @override
  String get navOrders => 'Заказы';

  @override
  String get navProfile => 'Профиль';

  @override
  String get onboardingTitle1 => 'Заказывайте заранее';

  @override
  String get onboardingBody1 => 'Кофе или обед — в пару касаний, откуда угодно.';

  @override
  String get onboardingTitle2 => 'Готово к вашему приходу';

  @override
  String get onboardingBody2 => 'Выберите «сейчас» или удобное время. Кухня начнёт так, чтобы всё было свежим.';

  @override
  String get onboardingTitle3 => 'Без очереди';

  @override
  String get onboardingBody3 => 'Назовите 4-значный код на выдаче и заберите заказ. Никакого ожидания.';

  @override
  String get onboardingNext => 'Дальше';

  @override
  String get onboardingStart => 'Начать';

  @override
  String get onboardingSkip => 'Пропустить';

  @override
  String get signInTitle => 'Войдите, чтобы заказать';

  @override
  String get signInSubtitle => 'Заказы, баллы и карты сохранятся на всех ваших устройствах.';

  @override
  String get continueWithTelegram => 'Войти через Telegram';

  @override
  String get continueWithGoogle => 'Войти через Google';

  @override
  String get continueWithApple => 'Войти через Apple';

  @override
  String get devSignIn => 'Вход для разработки';

  @override
  String get signingIn => 'Входим…';

  @override
  String get signInAgreement => 'Продолжая, вы принимаете Условия использования и Политику конфиденциальности.';

  @override
  String get signInUnavailable => 'В этой сборке не настроен ни один способ входа.';

  @override
  String get signInFailed => 'Не удалось войти. Попробуйте ещё раз.';

  @override
  String get storesTitle => 'Точки';

  @override
  String get storesSearchHint => 'Название или адрес';

  @override
  String get storesFilterAll => 'Все';

  @override
  String get storesFilterOpen => 'Открыты';

  @override
  String get storesNearMe => 'Рядом';

  @override
  String get storesEmpty => 'Точек по запросу не нашлось.';

  @override
  String get storesLoadFailed => 'Не удалось загрузить точки.';

  @override
  String get storeStatusOpen => 'Открыто';

  @override
  String get storeStatusBusy => 'Загружено';

  @override
  String get storeStatusClosed => 'Закрыто';

  @override
  String get orderHere => 'Заказать здесь';

  @override
  String distanceAway(String distance) {
    return '$distance от вас';
  }

  @override
  String etaChip(int count) {
    return '~$count мин';
  }

  @override
  String get chooseStoreTitle => 'Где заберёте заказ?';

  @override
  String get chooseStoreSubtitle => 'Выберите точку — покажем её меню и через сколько будет готово.';

  @override
  String get storeClosedBanner => 'Сейчас закрыто — можно оформить заказ на более позднее время.';

  @override
  String get storeBusyBanner => 'Кухня загружена — заказы готовятся чуть дольше.';

  @override
  String get openingHours => 'Часы работы';

  @override
  String get closedAllDay => 'Выходной';

  @override
  String get buildRoute => 'Построить маршрут';

  @override
  String get callStore => 'Позвонить';

  @override
  String get menuSearchHint => 'Поиск по меню';

  @override
  String get menuEmpty => 'Меню пока пустое.';

  @override
  String menuNoResults(String query) {
    return 'По запросу «$query» ничего нет';
  }

  @override
  String get menuLoadFailed => 'Не удалось загрузить меню.';

  @override
  String get changeStore => 'Сменить';

  @override
  String addedToCart(String name) {
    return '$name в корзине';
  }

  @override
  String get viewCart => 'Открыть';

  @override
  String get offlineMenu => 'Нет сети — показываем сохранённое меню';

  @override
  String get variationSize => 'Размер';

  @override
  String get variationTemperature => 'Температура';

  @override
  String get variationMilk => 'Молоко';

  @override
  String get variationCup => 'Стакан';

  @override
  String get variationOther => 'Параметры';

  @override
  String get productAddons => 'Добавки';

  @override
  String productAddonLimit(int max) {
    return 'до $max';
  }

  @override
  String get productNote => 'Пожелание бариста';

  @override
  String get productNoteHint => 'Погорячее, меньше пены…';

  @override
  String productAdd(String price) {
    return 'Добавить · $price';
  }

  @override
  String productCalories(int kcal) {
    return '$kcal ккал';
  }

  @override
  String get productCaffeine => 'Кофеин';

  @override
  String get productAllergens => 'Аллергены';

  @override
  String productNutrition(String p, String f, String c) {
    return 'Белки $p г · Жиры $f г · Углеводы $c г';
  }

  @override
  String get productNoStore => 'Выберите точку, чтобы заказать.';

  @override
  String get productLoadFailed => 'Не удалось загрузить позицию.';

  @override
  String get dietVegan => 'Веган';

  @override
  String get dietVegetarian => 'Вегетарианское';

  @override
  String get dietGlutenFree => 'Без глютена';

  @override
  String get dietLactoseFree => 'Без лактозы';

  @override
  String get dietDecaf => 'Без кофеина';

  @override
  String get dietSugarFree => 'Без сахара';

  @override
  String get cartTitle => 'Ваш заказ';

  @override
  String get cartEmptyTitle => 'Корзина пуста';

  @override
  String get cartEmptyBody => 'Добавьте что-нибудь вкусное из меню.';

  @override
  String get browseMenu => 'Открыть меню';

  @override
  String cartCheckout(String price) {
    return 'К оформлению · $price';
  }

  @override
  String get cartClear => 'Очистить корзину';

  @override
  String get cartClearConfirm => 'Убрать всё из корзины?';

  @override
  String cartItemRemoved(String name) {
    return '$name удалено';
  }

  @override
  String get cartLoadFailed => 'Не удалось загрузить корзину.';

  @override
  String get checkoutTitle => 'Оформление';

  @override
  String get checkoutWhen => 'Когда';

  @override
  String get pickupAsap => 'Как можно скорее';

  @override
  String get pickupLater => 'Позже';

  @override
  String get pickupLaterHint => 'Выберите время';

  @override
  String get noSlots => 'На ближайшие часы свободных окон нет. Попробуйте «как можно скорее».';

  @override
  String get slotsHint => 'Показаны окна, которые точка успевает обслужить.';

  @override
  String get fulfillmentPickup => 'Самовывоз';

  @override
  String get fulfillmentDelivery => 'Доставка';

  @override
  String get deliveryAddress => 'Адрес';

  @override
  String get deliveryAddressHint => 'Улица, дом, квартира';

  @override
  String get deliveryCity => 'Город';

  @override
  String get deliveryNotes => 'Для курьера';

  @override
  String get deliveryNotesHint => 'Подъезд, этаж, код домофона';

  @override
  String get deliveryUseLocation => 'Моё местоположение';

  @override
  String get deliveryOutside => 'Адрес вне зоны доставки.';

  @override
  String deliveryDistance(String distance) {
    return '≈ $distance до точки';
  }

  @override
  String get deliveryAddressRequired => 'Укажите адрес и город доставки.';

  @override
  String get contactTitle => 'Контакт';

  @override
  String get contactName => 'Имя на заказе';

  @override
  String get contactPhone => 'Телефон';

  @override
  String get orderNotes => 'Пожелание бариста';

  @override
  String get discountsTitle => 'Скидки';

  @override
  String get promoCode => 'Промокод';

  @override
  String promoApplied(String amount) {
    return 'Скидка $amount';
  }

  @override
  String promoPoints(String multiplier) {
    return '$multiplier× баллов за заказ';
  }

  @override
  String get promoInvalid => 'Промокод недействителен.';

  @override
  String get giftCard => 'Подарочная карта';

  @override
  String giftCardApplied(String amount) {
    return '$amount оплатит подарочная карта';
  }

  @override
  String get payWithPoints => 'Оплатить баллами';

  @override
  String pointsAvailable(int points) {
    return 'Доступно $points баллов';
  }

  @override
  String pointsApplied(int points, String amount) {
    return '$points баллов · минус $amount';
  }

  @override
  String pointsTooFew(int min) {
    return 'Минимум $min баллов и не больше суммы заказа.';
  }

  @override
  String get pointsDiscount => 'Баллы';

  @override
  String promoDiscount(String code) {
    return 'Промокод $code';
  }

  @override
  String get paymentTitle => 'Оплата';

  @override
  String get payAtCounter => 'Оплата на месте';

  @override
  String get payAtCounterHint => 'Наличными или картой при получении';

  @override
  String get addCard => 'Привязать карту';

  @override
  String get holdHint => 'Сумму забронируем сейчас, а спишем, когда точка примет заказ.';

  @override
  String get summaryTitle => 'Итог';

  @override
  String placeOrderPay(String total) {
    return 'Оплатить $total';
  }

  @override
  String placeOrder(String total) {
    return 'Заказать · $total';
  }

  @override
  String minOrderNotice(String amount) {
    return 'Минимальная сумма заказа — $amount.';
  }

  @override
  String get retryPayment => 'Оплатить снова';

  @override
  String orderTitle(String code) {
    return 'Заказ #$code';
  }

  @override
  String get statusCreated => 'Заказ получен';

  @override
  String get statusPaid => 'Оплата подтверждена';

  @override
  String get statusAccepted => 'Принят кухней';

  @override
  String get statusInProgress => 'Готовим ваш заказ';

  @override
  String get statusReady => 'Готов к выдаче';

  @override
  String get statusReadyDelivery => 'Готов — ждём курьера';

  @override
  String get statusPickedUp => 'Приятного аппетита!';

  @override
  String get statusOutForDelivery => 'Курьер в пути';

  @override
  String get statusDelivered => 'Доставлен';

  @override
  String get statusCancelled => 'Отменён';

  @override
  String get statusExpired => 'Отменён — оплата не поступила вовремя';

  @override
  String get statusUnknown => 'Обновляем…';

  @override
  String get stepReceived => 'Принят';

  @override
  String get stepPreparing => 'Готовим';

  @override
  String get stepReady => 'Готов';

  @override
  String get stepPickedUp => 'Выдан';

  @override
  String get stepOnTheWay => 'В пути';

  @override
  String get stepDelivered => 'Доставлен';

  @override
  String get paymentStatePaid => 'Оплата прошла';

  @override
  String get paymentStateHeld => 'Сумма забронирована';

  @override
  String get paymentStateHeldHint => 'Спишем, когда точка примет заказ.';

  @override
  String get paymentStatePending => 'Проверяем оплату';

  @override
  String get paymentStateFailed => 'Оплата не прошла';

  @override
  String get paymentStateRefunded => 'Деньги возвращены';

  @override
  String get paymentStateAtCounter => 'Оплата на месте';

  @override
  String get pickupCode => 'Код получения';

  @override
  String get showQr => 'Показать QR';

  @override
  String get qrHint => 'Покажите на выдаче';

  @override
  String get iAmHere => 'Я на месте';

  @override
  String get iAmHereSent => 'Бариста знает, что вы пришли';

  @override
  String get cancelOrder => 'Отменить заказ';

  @override
  String get cancelOrderTitle => 'Отменить заказ?';

  @override
  String get cancelOrderBody => 'Если деньги были списаны или забронированы, они вернутся.';

  @override
  String get keepOrder => 'Оставить';

  @override
  String get reorder => 'Повторить заказ';

  @override
  String get reorderDone => 'Добавили в корзину';

  @override
  String get reorderPartial => 'Часть позиций сейчас недоступна';

  @override
  String get orderItems => 'Состав';

  @override
  String pickupAt(String time) {
    return 'Забрать в $time';
  }

  @override
  String deliveryAt(String time) {
    return 'Доставим к $time';
  }

  @override
  String get untilReady => 'до готовности';

  @override
  String get readyShort => 'Готово';

  @override
  String get liveUpdates => 'Онлайн';

  @override
  String get reconnecting => 'Переподключаемся…';

  @override
  String get orderLoadFailed => 'Не удалось загрузить заказ.';

  @override
  String get emailReceipt => 'Прислать чек на почту';

  @override
  String get receiptSent => 'Чек отправлен на почту';

  @override
  String yourOrderAt(String store) {
    return 'Ваш заказ в $store';
  }

  @override
  String hiName(String name) {
    return 'Привет, $name!';
  }

  @override
  String get ordersTitle => 'Мои заказы';

  @override
  String get ordersActive => 'Активные';

  @override
  String get ordersHistory => 'История';

  @override
  String get ordersEmptyActive => 'Нет активных заказов';

  @override
  String get ordersEmptyHistory => 'Заказов пока не было';

  @override
  String get ordersEmptyBody => 'Сделайте первый заказ — он появится здесь.';

  @override
  String get ordersSignIn => 'Войдите, чтобы видеть заказы';

  @override
  String activeOrderBanner(String code, String status) {
    return 'Заказ #$code · $status';
  }

  @override
  String get profileTitle => 'Профиль';

  @override
  String get profileGuestTitle => 'Войдите, чтобы получить всё';

  @override
  String get profileGuestBody => 'Сохраняйте карты, копите баллы и следите за заказом в реальном времени.';

  @override
  String get signIn => 'Войти';

  @override
  String get profilePersonal => 'Личные данные';

  @override
  String get profilePayment => 'Способы оплаты';

  @override
  String get profileGiftCards => 'Подарочные карты';

  @override
  String get profileLoyalty => 'Программа лояльности';

  @override
  String get profileReferrals => 'Пригласить друга';

  @override
  String get profileNotifications => 'Уведомления';

  @override
  String get profileLanguage => 'Язык';

  @override
  String get profileAbout => 'О приложении';

  @override
  String get signOut => 'Выйти';

  @override
  String get signOutConfirm => 'Выйти из takeAway?';

  @override
  String appVersion(String version) {
    return 'Версия $version';
  }

  @override
  String get tierSilver => 'Серебро';

  @override
  String get tierGold => 'Золото';

  @override
  String get tierPlatinum => 'Платина';

  @override
  String get tierSignature => 'Сигнатур';

  @override
  String pointsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count балла',
      many: '$count баллов',
      few: '$count балла',
      one: '$count балл',
    );
    return '$_temp0';
  }

  @override
  String toNextTier(int points, String tier) {
    return '$points баллов до уровня «$tier»';
  }

  @override
  String get topTier => 'Максимальный уровень — спасибо, что вы с нами!';

  @override
  String get personalName => 'Имя';

  @override
  String get personalEmail => 'Email';

  @override
  String get personalPhone => 'Телефон';

  @override
  String get personalBirthday => 'Дата рождения';

  @override
  String get personalSaved => 'Сохранено';

  @override
  String get nameRequired => 'Укажите имя';

  @override
  String get emailInvalid => 'Проверьте email';

  @override
  String get phoneInvalid => 'В международном формате, например +37377712345';

  @override
  String get notificationsTitle => 'Уведомления';

  @override
  String get notificationsSubtitle => 'Выберите, о чём сообщать. Настройки можно менять в любой момент.';

  @override
  String get notifOrderUpdates => 'Статусы заказов';

  @override
  String get notifOrderUpdatesHint => 'Когда заказ принят, готов или в пути.';

  @override
  String get notifPromotions => 'Акции';

  @override
  String get notifPromotionsHint => 'Скидки, новинки и бонусы программы лояльности.';

  @override
  String get pushBlocked => 'Уведомления для takeAway выключены в настройках системы.';

  @override
  String get openSettings => 'Открыть настройки';

  @override
  String get loyaltyTitle => 'Программа лояльности';

  @override
  String get loyaltyBalance => 'Баланс баллов';

  @override
  String get loyaltyActivity => 'Последние операции';

  @override
  String get loyaltyEmpty => 'Баллы появятся здесь после первого заказа.';

  @override
  String get loyaltyHowTitle => 'Как это работает';

  @override
  String get loyaltyHowBody =>
      'Баллы начисляются за каждый оплаченный заказ и списываются при оформлении. Чем больше заказов, тем выше уровень.';

  @override
  String get referralsTitle => 'Пригласить друга';

  @override
  String get referralsBody => 'Поделитесь кодом. Друг получит баллы за первый оплаченный заказ — и вы тоже.';

  @override
  String get referralsYourCode => 'Ваш код';

  @override
  String get referralsCopied => 'Код скопирован';

  @override
  String get referralsShare => 'Поделиться';

  @override
  String referralsShareText(String code, String url) {
    return 'Заказывай кофе заранее в takeAway и забирай без очереди. Введи мой код $code в первом заказе — и мы оба получим баллы. $url';
  }

  @override
  String get referralsSignups => 'Друзей пришло';

  @override
  String get referralsRewarded => 'Первых заказов';

  @override
  String get referralsPoints => 'Баллов получено';

  @override
  String get referralsApplyTitle => 'Есть код друга?';

  @override
  String get referralsApplyHint => 'Можно ввести один раз, до первого оплаченного заказа.';

  @override
  String referralsApplied(String code) {
    return 'Бонус активирован по коду $code';
  }

  @override
  String get referralsCodeHint => 'Код друга';

  @override
  String get giftCardsTitle => 'Подарочные карты';

  @override
  String get giftCardsEmpty => 'Вы ещё не применяли подарочные карты. Введите код при оформлении — он появится здесь.';

  @override
  String giftCardUsedOn(String code, String brand) {
    return 'Заказ #$code · $brand';
  }

  @override
  String get paymentMethodsTitle => 'Способы оплаты';

  @override
  String get paymentMethodsSubtitle =>
      'Привяжите карту один раз и платите в одно касание. Полный номер карты мы не видим и не храним.';

  @override
  String get paymentMethodsUnavailable => 'Оплата картой пока не подключена. Заказ можно оплатить на месте.';

  @override
  String get paymentMethodsEmpty => 'Карт пока нет';

  @override
  String get cardDefault => 'Основная';

  @override
  String get cardMakeDefault => 'Сделать основной';

  @override
  String get cardRemoveTitle => 'Удалить карту?';

  @override
  String get cardInactive => 'Заблокирована банком';

  @override
  String get cardFallbackTitle => 'Карта';

  @override
  String get cardAddTitle => 'Привязать карту';

  @override
  String get cardIssuer => 'Банк-эмитент';

  @override
  String get cardLast4 => 'Последние 4 цифры карты';

  @override
  String get cardPhone => 'Телефон, привязанный к карте';

  @override
  String get cardPhoneHint => 'например, 77712345';

  @override
  String get cardLabel => 'Название карты (необязательно)';

  @override
  String get cardPrivacy => 'Полный номер карты не передаётся и не хранится. Банк пришлёт одноразовый код по SMS.';

  @override
  String get cardSendCode => 'Получить код';

  @override
  String get cardCodeTitle => 'Введите код';

  @override
  String cardCodeSent(String phone) {
    return 'Мы отправили одноразовый код на номер $phone.';
  }

  @override
  String get cardStartOver => 'Ввести данные заново';

  @override
  String get cardAdded => 'Карта привязана';

  @override
  String get cardRefresh => 'Проверить в банке';

  @override
  String get languageTitle => 'Язык';

  @override
  String get languageSystem => 'Как в системе';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageRussian => 'Русский';

  @override
  String get aboutBody => 'takeAway — предзаказ кофе и еды. Выбирайте, оплачивайте и забирайте без очереди.';

  @override
  String get locationDenied => 'Доступ к геолокации выключен. Разрешите его в настройках, чтобы видеть точки рядом.';

  @override
  String get locationServiceOff => 'Службы геолокации выключены.';

  @override
  String get greetingMorning => 'Доброе утро';

  @override
  String get greetingAfternoon => 'Добрый день';

  @override
  String get greetingEvening => 'Добрый вечер';

  @override
  String greetingWithName(String greeting, String name) {
    return '$greeting, $name';
  }

  @override
  String get pickupPoint => 'Точка самовывоза';

  @override
  String get quickAdd => 'В корзину';

  @override
  String cartBarLabel(int count, String time) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count позиции',
      many: '$count позиций',
      few: '$count позиции',
      one: '$count позиция',
    );
    return '$_temp0 · готово к $time';
  }

  @override
  String get liveOrder => 'Текущий заказ';

  @override
  String get categoriesAll => 'Все';

  @override
  String get copy => 'Копировать';
}
