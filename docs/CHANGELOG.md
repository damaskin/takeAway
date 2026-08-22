# Changelog

Все значимые изменения takeAway фиксируются в этом файле.

Формат — [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), версионирование — [SemVer](https://semver.org/) с pre-`1.0` соглашением: minor — milestone-фичи и крупные треки, patch — bugfix и доработки.

## Процесс

- При мерже PR с пользовательским эффектом — добавлять строку в `[Unreleased]` под нужной категорией (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` / `Infra` / `Docs`).
- При выпуске релиза (тег `vX.Y.Z`) — переименовывать `[Unreleased]` в `[X.Y.Z] — YYYY-MM-DD` и заводить новый пустой `[Unreleased]`.
- Краткие, ориентированные на пользователя/оператора формулировки, без ссылок на внутренние модули. Ссылку на PR в скобках в конце строки: `(#NNN)`.
- При значимом изменении модели данных, API или стека — параллельно обновлять `01_TECHNICAL_SPEC.md` (правило в `CLAUDE.md` и в auto-memory).

## [Unreleased]

### Added

- **Часы работы точки теперь применяются, а не только редактируются.** `StoreWorkingHour` лежал в базе с самого начала и не проверялся нигде: заказ на 3 часа ночи спокойно уходил на кухонный экран. Проверка идёт в таймзоне точки через `Intl` — не через фиксированный сдвиг, который ломается дважды в год, — и понимает ночные смены (22:00–02:00 покрывает и пятницу 23:30, и субботу 01:00). Точка без заполненного расписания считается работающей круглосуточно: это состояние, в котором точка заводится, и отказывать в заказах из-за незаполненной формы было бы хуже. Закрытые окна выдачи просто не предлагаются на чекауте — вычеркнутое 03:00 это шум, а вот занятое 08:15 это информация.
- **Стоп-лист блокирует заказ, а не только подсвечивает карточку.** Раньше `onStopList` был подсказкой для витрины, и ничто не мешало устаревшему экрану, диплинку или прямому вызову API отправить снятую с продажи позицию на кухню. Теперь проверка стоит на добавлении в корзину, на изменении позиции и ещё раз при создании заказа — товар может попасть в стоп-лист между наполнением корзины и оплатой. Записи с истёкшим `expiresAt` не блокируют: они уже автоматически вернулись в продажу.

- **ETA считается от фактической очереди кухни, а не от статичного поля.** Раньше `Store.currentEtaSeconds` никто не пересчитывал: двадцать заказов в 8:40 получали то же обещание, что один заказ в 15:00. Теперь `eta = базовая накладная точки + невыполненная работа / параллелизм кухни + время своей позиции`. Поле переименовано в `baseEtaSeconds` — это честно описывает, чем оно было. У заказа появились два разных числа: `prepSeconds` (сколько ждёт клиент — самая долгая позиция, бариста тянет шот пока взбивается молоко) и `workSeconds` (сколько заказ занимает кухню — сумма по позициям); заказ из четырёх напитков грузит бар вчетверо сильнее, чем заставляет ждать своего клиента. Заказ в работе считается наполовину сделанным. Витрина и карточка точки отдают живое `currentEtaSeconds`, список точек — одним групповым запросом, а не запросом на пин.
- **Слоты выдачи по 15 минут.** У точки есть `slotCapacity` — сколько выдач она готова пообещать в одном окне. Переполненное окно перестаёт предлагаться. Новый публичный `GET /stores/:id/pickup-slots` отдаёт двенадцать часов вперёд, занятые окна приходят помеченными, а не пропадают: вычеркнутое 08:15 читается как «загруженное утро», исчезнувшее — как баг. Чекаут в web и TMA больше не показывает свободное поле времени — только окна, которые точка успевает обслужить. Вместимость проверяется и на создании заказа, включая ASAP: без этого час пик просто растягивал бы всем ETA, ради чего вся модель и делалась. Настройки `baseEtaSeconds` / `kitchenParallelism` / `slotCapacity` доступны в админке.

- **Вход через Google и Apple** для клиентов, рядом с Telegram. На экране входа web три провайдера: Google (официальная кнопка Google Identity Services), Apple (кнопка по Apple HIG) и Telegram-виджет под разделителем. Любой можно не включать — пустой client id в `index.html` прячет кнопку, при пустых всех трёх показывается явное «способ входа не настроен». Сервер проверяет ID-токен по JWKS провайдера: RS256 с зафиксированным алгоритмом (заголовку `alg` не доверяем), `iss`, `aud` против собственных client id, `exp`; ключи кешируются на час и переживают ротацию. Аккаунт с **подтверждённым** email привязывается к существующему клиенту, так что человек, начавший в Telegram, попадает в тот же профиль с той же историей заказов; staff-аккаунты для такой привязки закрыты. Новые переменные окружения: `GOOGLE_OAUTH_CLIENT_IDS`, `APPLE_OAUTH_CLIENT_IDS` (списки через запятую — по одному client id на платформу, с прицелом на Flutter).
- **Telegram Mini App: вход убран полностью.** Сессия выпускается из `initData` в app-initializer, до первого рендера, поэтому ни один экран не успевает уйти в запрос без токена. На 401 интерсептор молча ротирует refresh-токен, а если тот недействителен — пересоздаёт сессию из того же `initData` и повторяет запрос: чекаут, открытый через полчаса после запуска бота, просто работает. Route guard даёт повторную попытку, если API был недоступен на старте. Экраны «войдите, чтобы увидеть заказы» и «войдите, чтобы добавить в корзину» заменены на честное «нет связи с сервером» — внутри Telegram неавторизованность может быть только технической.
- **Build version visibility** во всех артефактах. `deploy.sh` вычисляет триплет `version` (`git describe --tags --always --dirty`) / `commit` (full SHA) / `builtAt` (UTC ISO) на каждом деплое. API возвращает их в `GET /api/health`. Каждая SPA получает `/version.json` от `extract-spa.sh` и показывает короткий бейдж в правом нижнем углу через `lib-version-badge` (`libs/ui-kit`); по клику триплет копируется в clipboard. Скрытие через `?no-version` в URL — для скриншотов.
- **iiko Cloud sync (M5)**: parity with Poster. `/api/1/nomenclature` для menu import, `/api/1/stop_lists` для periodic poller (30 мин cron), `/api/1/order/create` для outgoing orders. Provider требует pinned `settings.organizationId` для menu и orders. Inline product modifiers переносятся как `Modifier` rows. См. обновлённый `docs/integrations.md`.
- **Stripe refund flow в admin**: `POST /admin/orders/:id/refund` — full или partial возврат. Optimistically обновляет `Payment.refundedCents`/`PaymentStatus`, эмитит `REFUND_ISSUED` event с `actorId`. RBAC: SUPER_ADMIN видит всё, BRAND_ADMIN — только свои бренды, STORE_MANAGER — только свои store-scope.
- **Analytics на materialized view**: миграция создаёт `mv_orders_daily` (per-(brand, store, day) роллап с `orderCount`, `revenueCents`, `slaHits/Total`, `pickupSecSum/Count`). `AnalyticsRefreshService` каждые 5 минут делает `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Endpoints `dashboardSummary`, `revenueSeries`, `storePerformance` теперь читают MV вместо raw `Order` сканов; `topProducts`/`cohort` пока остались на live tables и помечены как кандидаты на следующий MV.
- **PDF receipt**: чек прикладывается PDF-аттачментом к welcome/receipt письму через `pdfkit` (built-in Helvetica). Для receipt с non-ASCII (Cyrillic и др.) PDF не генерируется — идёт только HTML, чтобы не плодить broken glyphs. Customer может повторно запросить чек: `POST /me/orders/:id/resend-receipt`. Зависимости: `pdfkit` ^0.15, `@types/pdfkit`. Только в API контейнере (Angular bundles не задеты).
- **KDS PIN auth (API)**: 4–6 цифр на staff-юзера, scoped to one store. Endpoints — `POST /auth/kds/pin` (login), `PUT/DELETE /admin/stores/:id/staff/:userId/kds-pin` (admin set/clear). PIN хранится как `HMAC-SHA256(storeId|pin)` с key `KDS_PIN_SECRET` — O(1) lookup без bcrypt. Per-store unique enforced partial index. UI lockscreen в `apps/kds` — отдельный заход.
- **M6 Flutter kickoff**: scaffold `apps/mobile/` с `pubspec.yaml` (Riverpod, go_router, Dio + Retrofit, Hive, flutter_secure_storage, socket_io_client, firebase_messaging, sign_in_with_apple, google_sign_in, flutter_stripe, mapbox_gl, qr_flutter), минимальный `lib/main.dart`, README с PR-разбивкой M6 PR1–PR8. До `flutter create` собирать нечем — это первый шаг по PR1.

### Docs

- Раздел 0 ТЗ: добавлено «Текущее состояние реализации» — таблица milestones M0–M7, треки за пределами roadmap (POS, multi-brand, delivery, storage, notify-prefs), реальные версии стека, статус БД (16 миграций).
- Разделы 5 и 6 ТЗ переписаны под фактическую модель данных (`prisma/schema.prisma`) и контроллеры (`apps/api`).
- Разделы 2 и 3 ТЗ синхронизированы со стеком и фактическими функциональными требованиями: customer-Telegram + staff-password auth (OTP/SMS не подключён), VAPID web push вместо FCM, SMTP nodemailer вместо Mailgun, MinIO+CDN вместо Cloudflare R2, добавлены 3.11 Delivery и 3.12 POS integrations.
- Введён `docs/CHANGELOG.md` (этот файл) с процессом ведения.

### Fixed

- Poster: host вычисляется из subdomain, `testConnection` использует `settings.getAllSettings` (#124).

### Added

- App-level Poster webhook + accountNumber на connect (#123).
- Гайдрейл деплоя + закрытие фронтенд-гэпов в admin/web (#122).
- **Marketing campaigns**: push/Telegram/email broadcast от бренда с audience (ALL / HAS_ORDERED / INACTIVE_30D), счётчики target/sent/failed (#121).
- **Referrals**: уникальный код на пользователя, бонус обеим сторонам с первого PAID-заказа реферала (#120).
- **Gift cards**: схема, redemption на чекауте (рядом с промо), admin issue UI (#119).
- **Welcome + receipt emails** на переходе в PAID через nodemailer/SMTP (#118).
- **Web push (VAPID)** + регистрация устройств через `/devices` (#117).
- **Customer geofencing «I'm here»**: эндпоинт + кнопка в TMA/web (#116).

### Infra

- Preflight в CI больше не требует `DATABASE_URL`/`REDIS_URL` — выводятся из docker-compose.

## [0.5.0] — 2026-05-01 — POS integrations release

Веха: pluggable POS-провайдеры (iiko + Poster), self-serve onboarding брендов и расширенный multi-brand SaaS-слой.

### Added

- **POS integrations skeleton**: pluggable `IPosProvider`, провайдеры iiko Cloud и Poster. Шифрование credentials AES-256-GCM (`POS_CREDENTIALS_KEY`). Sync stores/menu/stop-list. См. `docs/integrations.md`.
- **Self-serve business registration + brand moderation**: `/business/register`, статусы `PENDING/APPROVED/REJECTED`, баннеры в admin до approval, SUPER_ADMIN UI для модерации.
- **Multi-brand scope**: `BrandScopeService`, scope-фильтрация catalog-эндпоинтов для `BRAND_ADMIN`, storefront показывает только `APPROVED` бренды.
- **Brand customisation**: страница настроек бренда, logo uploader → S3/MinIO, `themeOverrides` JSON для CSS-переменных в TMA.
- **Staff roster**: invite managers + kitchen staff, force password rotation на первом логине.
- **Email + password auth для staff** (admin / kds), отказ от OTP на этих экранах. Customer — только Telegram (Login Widget на web, initData в TMA).
- **Per-user notification prefs**: order updates / promotions toggle, customer push на CREATED и PAID, Telegram push на rider при назначении и на brand staff при новом PAID.
- **Inline store editor** в admin (details + working hours).
- **Single-VPS production infra**: docker-compose, off-server backups, MinIO + CDN, auto-deploy на push в main.

## [0.4.0] — Delivery v1 + analytics

Не выпущен отдельным тегом, но трек закрыт серией PR (#44–#65) в апреле 2026.

### Added

- **Delivery module**: `FulfillmentType.DELIVERY`, статусы `OUT_FOR_DELIVERY` / `DELIVERED`, address и fee snapshot на Order, dispatch UI для менеджера, rider workflow (`/delivery/my`, self-assign, status), per-store fee overrides (`Store.deliveryFee*`).
- **TMA delivery UX**: PICKUP/DELIVERY toggle на чекауте, address form, geolocation-based fee, scheduled delivery.
- **Web delivery UX**: scheduled delivery на чекауте.
- **Analytics**: `/admin/analytics` (summary, revenue, top-products, cohort, stores), KDS realtime channel, тесты Stripe webhook.
- **Push providers**: Telegram-провайдер для уведомлений, заглушки FCM/APNS под M6.
- **Feature flag** `DELIVERY_ENABLED` для отключения модуля на бренд-уровне.

## [0.3.0] — i18n + design sync

### Added

- Russian-default i18n покрытие для web / TMA / admin / KDS (`@ngx-translate/core`).
- Sync всех экранов в pencil-дизайн: Home, Menu, Product, Checkout, Order Status, Profile, Orders, KDS board, admin (Dashboard/Menu/Stores/Orders/Promo/Analytics).
- Mobile-responsive overhaul.

### Fixed

- Tailwind 4 wiring + design tokens на `:root`.
- Swagger UI blank page (`/api/docs/*` без zstd encoding).

## [0.2.0] — M3 loyalty + Stripe-tested core

### Added

- **M3 Loyalty + Promo**: LoyaltyAccount + PointsLedger, промокоды с типами PERCENT/FIXED/BOGO/POINTS_MULTIPLIER.
- **M4 Orders history** в web/tma/admin.
- WS `KDS realtime channel` для статусов в реальном времени.
- Smoke-тесты Playwright для home / login / stores.

## [0.1.0] — M0–M2 foundation

Начальная реализация — фундамент и pre-order core.

### Added

- **M0**: Nx + pnpm 10 монорепо, Node 22, Angular 21, NestJS 11, libs (api-client, ui-kit, shared-types, i18n, utils), eslint/jest/commitlint, docker-compose (pg/redis/minio).
- **M1 Auth**: первая итерация — OTP + JWT + refresh в Redis (позже заменено на email+password для staff и Telegram для customer).
- **M1 Catalog**: Prisma schema (Brand/Store/Category/Product/Variation/Modifier), публичный API каталога, admin CRUD с RBAC.
- **M1 UI**: admin (login + dashboard + menu management), web (landing/stores/menu/product/auth), TMA (auto-auth + catalog).
- **M2 Pre-order core**: cart + live ETA, order creation/cancel/history, Stripe Payment Intents + webhook, WebSocket gateway, order code + QR.
- **M2 UX**: web/TMA cart/checkout/order-status с live WS; KDS board с dual-timer и status transitions.
- Документация: brief, ТЗ M0–M7, Claude prompt, Pencil brief + post-pivot patch.
