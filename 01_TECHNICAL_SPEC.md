# takeAway — Technical Specification (MVP)

> **Ключевая механика продукта — pre-order first.** Клиент делает предзаказ, следит за ETA и статусом, приходит к готовому заказу и забирает без очереди. Все архитектурные и UX-решения подчинены этой механике. Курьерская доставка добавлена как полноценный второй канал получения (см. секцию 7 и 0.2).

## 0. Текущее состояние реализации

> Синхронизируется при каждом значимом изменении кода/инфры/roadmap. Источник истины — `git log` + структура `apps/`/`libs/` + `docs/`.

**Стадия:** подготовка к пилоту. Закрыты треки авторизации, честного ETA, слотов, налогов, наблюдаемости, PWA, списания баллов и e2e. Единственный незакрытый блокер — приём платежей: провайдер меняется на банковский эквайринг, ждём документацию.

### 0.1. Прогресс по milestones

| Milestone                      | Статус | Комментарий                                                                                                                                                                                                                                         |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** Фундамент               | ✅     | Nx + pnpm 10, Node 22+, docker-compose (pg, redis, MinIO, mailhog), NestJS 11 + Prisma 6, Angular 21 (web/tma/admin/kds), CI                                                                                                                        |
| **M1** Auth + Catalog          | ✅     | OTP + password + OAuth (Google/Apple/Telegram), JWT + refresh, CRUD меню, публичный каталог, web/TMA-экраны                                                                                                                                         |
| **M2** Pre-order core          | ✅     | Cart sync, чекаут с ASAP/scheduled, Stripe Payment Intents + webhook, order code + QR, live-status (Socket.io), KDS dual-timer, geofencing «I'm here»                                                                                               |
| **M3** Лояльность              | ✅     | LoyaltyAccount + txn, промокоды, gift cards, рефералы (бонус с первого оплаченного заказа обеим сторонам)                                                                                                                                           |
| **M4** Push / Email / Telegram | ✅     | Web push (VAPID) + `/devices`, transactional email через nodemailer/SMTP (welcome, receipt), Telegram push на rider/brand staff, операционные алерты в Telegram                                                                                     |
| **M5** Admin расширенный       | 🟡     | Аналитика, marketing campaigns broadcast, multi-store fee overrides, staff roster + invites, password rotation. Materialized view `mv_orders_daily` (refresh каждые 5 мин) питает summary/revenue/stores; top-products и cohort пока на raw queries |
| **M6** Mobile (Flutter)        | 🟡     | Приложение iOS/Android в `apps/mobile` (Flutter 3.38): весь путь клиента, live-статус, карты, лояльность, оплата Агропромбанком, RU/EN. FCM-пуши на сервере. Не выпущено: ключи Firebase/Google/Apple, аккаунты сторов, сборка iOS на Mac           |
| **M7** Scale & polish          | 🟡     | Sentry на API и всех четырёх SPA, readiness-проба с Postgres + Redis (деплой-гейт смотрит на неё), операционные алерты. Нагрузочное тестирование и A/B — не начаты                                                                                  |

### 0.1a. Что осталось до пилота

| Блок                           | Статус | Комментарий                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Приём платежей**             | 🟡     | Эквайринг Агропромбанка написан и работает в TMA и в вебе (привязка карты, оплата, статус платежа у клиента). Ждёт включения на проде: `AGROPROMBANK_ENABLED`. Вторая схема — Web-платёж (страница банка, бронь до принятия кухней) — написана и ждёт регистрации у банка: `AGROPROMBANK_WEB_ENABLED` + `CARD_PAYMENT_FLOW=web`. Stripe остаётся запасным путём |
| Гейт «не готовим неоплаченное» | ✅     | `CREATED` остаётся на KDS намеренно: принять заказ и есть момент списания брони. Отказ банка не даёт принять, так что неоплаченный тикет в работу не уходит                                                                                                                                                                                                     |
| Нагрузочный прогон часа пик    | ❌     | 60 заказов в час на точку                                                                                                                                                                                                                                                                                                                                       |
| Пилот в одной локации          | ❌     | Две недели с ручным откатом                                                                                                                                                                                                                                                                                                                                     |

### 0.2. Треки за пределами оригинального ТЗ

| Трек                            | Статус | Комментарий                                                                                                                                                                                                                                 |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **POS integrations**            | ✅     | iiko Cloud + Poster, pluggable через `IPosProvider`. Poster: import + stop-list (M2), outgoing orders (M3), webhooks (M4). iiko: import + stop-list (cron) + outgoing orders (M5). AES-256-GCM для credentials. См. `docs/integrations.md`. |
| **Multi-brand SaaS**            | ✅     | Brand registration + moderation (banners, rejection notes), `BrandScopeService` для scope-проверок, brand-themed UI overrides, BRAND_ADMIN роль с ограничением catalog-эндпоинтов                                                           |
| **Delivery (расширена с v1.5)** | 🟡     | TMA geolocation для доставки, scheduled delivery, riders + dispatch admin UI, per-store fee overrides, Telegram push rider при назначении. Не курьерская сеть — модель «бренд организует своего курьера».                                   |
| **Storage / CDN**               | ✅     | MinIO (S3-compatible) bundled в инфре + `cdn.takeaway.md`, brand logo uploader                                                                                                                                                              |
| **Notifications prefs**         | ✅     | Per-user prefs: order updates / promotions, force password rotation для invited staff                                                                                                                                                       |

### 0.3. Реальный стек (расхождения с разделом 2)

- **Node 22+**, **pnpm 10.33+** (раздел 2 называл общее, тут зафиксировано конкретно)
- **Nx 22.6.5** (Turborepo не используется)
- **Angular 21.2** (раздел 2 говорит «19+» исторически — следует читать как «21+»)
- **NestJS 11** + Prisma **6.19**, BullMQ **5.74**, Stripe SDK **22**, Socket.io **4.8**, nodemailer **8**
- **Email:** SMTP через nodemailer (Mailgun/Postmark из ТЗ — не подключены)
- **Storage:** MinIO + Cloudflare-style CDN (Cloudflare R2 из ТЗ — не подключен)
- **Mobile:** Flutter **3.38** / Dart **3.10**, Riverpod **2.6** (не 3 — конфликтует с пинами `flutter_test`), go_router, Dio + Retrofit; карты — `flutter_map` + OSM, а не Google/Mapbox; платежи — Агропромбанк через API, а не `flutter_stripe`; кеш каталога — JSON-файлы, а не Isar/Hive (см. 2.3)

### 0.4. База данных

22 миграции, последняя `20260822020000_points_redemption`. Ключевые домены реализованы: User/Auth, Brand+Store+scope, Catalog, Cart, Order+Events, Payment, Loyalty/Promo/GiftCard/Referral, Device+Notification, POS credentials, Delivery (rider/dispatch), Campaign.

### 0.5. Как проект реально задеплоен

Раздел существует потому, что `deploy/README.md` долго описывал отдельный
VPS под takeAway, а фактическая инсталляция другая, и расхождение стоило
времени при каждом инциденте.

**Хост.** Не выделенный сервер, а общая машина (алиас `shmidt01`), где рядом
живёт чужой проект. Диск ~15 GiB на всех — поэтому `deploy.sh` в конце
подрезает build-cache: полный диск уже ронял прод. IP и пользователь
деплоя — в секретах GitHub Actions (`DEPLOY_HOST`, `DEPLOY_USER`), не в
репозитории.

**Маршрут запроса.** Cloudflare → `edge-nginx` чужого проекта, который
владеет 80/443 и раздаёт трафик по SNI (`ssl_preread`, TCP-проксирование
без терминации TLS) → `takeaway-nginx-1:443`, где TLS уже наш → статика SPA
и `/api` на `takeaway-api-1:3000`. Из этого следует два неочевидных факта:

- Сертификаты выпускает и хранит наш nginx, а не edge; edge только
  доставляет байты.
- После пересоздания контейнера `takeaway-nginx-1` нужен
  `docker exec edge-nginx nginx -s reload` — иначе edge держит старый
  upstream и отдаёт 502. `deploy/scripts/deploy.sh` делает это сам, когда
  на хосте лежит `docker-compose.shared-edge.override.yml`.

**Что нельзя делать.** Контейнеры takeAway не подключать к сети
`rayn-prod_default`: там резолвится чужой `postgres`, и Prisma падает с
P1000 на чужих учётных данных. По этой же причине
`deploy/scripts/integrate-rayn-nginx.sh` — легаси и не запускается на
текущем хосте. `init-env-production.sh` не гонять на живом проде: он
перезаписывает пароль Postgres, после чего контейнер не поднимется к
существующему volume.

**Ветка.** Прод собирается с `main`. Чекаут — `/opt/takeaway/repo`; деплой
сам переводит его на нужную ветку. До сентября 2026 прод ехал с
`infra/migrate-takeaway-md` — она осталась только как история.

## 1. Архитектура верхнего уровня

```
                    ┌───────────────────────────────────┐
                    │         Cloudflare CDN            │
                    └───────────────────────────────────┘
                                     │
     ┌───────────────────────────────┼───────────────────────────────┐
     │                               │                               │
┌────────────┐              ┌────────────────┐            ┌──────────────────┐
│  Web /PWA  │              │ Telegram Mini  │            │  iOS / Android   │
│ (Angular)  │              │ App (Angular)  │            │    (Flutter v2)  │
└────────────┘              └────────────────┘            └──────────────────┘
     │                               │                               │
     └───────────────────────────────┼───────────────────────────────┘
                                     │ HTTPS / WSS
                            ┌──────────────────┐
                            │   API Gateway    │
                            │   (NestJS)       │
                            └──────────────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
   ┌─────────────┐          ┌────────────────┐        ┌──────────────────┐
   │ PostgreSQL  │          │     Redis      │        │   BullMQ jobs    │
   │  (primary)  │          │ cache/session  │        │  (notify, email) │
   └─────────────┘          └────────────────┘        └──────────────────┘
          │                          │                          │
          └──────────────────────────┴──────────────────────────┘
                                     │
                           ┌─────────────────────┐
                           │  3rd-party services │
                           │ Stripe · Twilio ·   │
                           │ Firebase · Mapbox · │
                           │ Telegram · Mailgun  │
                           └─────────────────────┘

   ┌──────────────┐     ┌─────────────────┐     ┌───────────────────┐
   │  Admin Panel │     │    KDS screen   │     │  Analytics (v2)   │
   │  (Angular)   │     │    (Angular)    │     │  Metabase/Grafana │
   └──────────────┘     └─────────────────┘     └───────────────────┘
```

Монорепо на pnpm + Nx (или Turborepo):

```
takeaway/
├── apps/
│   ├── api/              # NestJS backend
│   ├── web/              # Angular web + PWA
│   ├── tma/              # Angular Telegram Mini App
│   ├── admin/            # Angular кабинет бизнеса + суперадмин (кухонная доска внутри)
│   └── mobile/           # Flutter (v2)
├── libs/
│   ├── shared-types/     # DTO, интерфейсы
│   ├── ui-kit/           # Общие Angular-компоненты
│   ├── api-client/       # Типизированный API клиент
│   └── utils/
├── infra/                # Docker, k8s, terraform
├── docs/
└── package.json
```

## 2. Технологический стек

### 2.1. Frontend (Angular) — фактически

- **Angular 21.2** со standalone components и signals
- **State**: native Angular signals (без отдельного store-фреймворка). NgRx Signal Store / Akita из исходного ТЗ не подключены — просто не понадобились. Возвращаемся к этому, если разрастётся cross-feature state.
- **UI Kit**: Tailwind CSS **4.2** + `@tailwindcss/postcss`, общие компоненты в `libs/ui-kit` (включая `telegram-login-button`)
- **Forms**: Reactive Forms + `class-validator`-DTO с бэкенда (zod пока не подключён)
- **HTTP**: HttpClient + interceptors (auth, refresh, error)
- **Router**: Angular Router с lazy loading на каждой feature-папке
- **i18n**: `@ngx-translate/core` 17 — словари в `libs/i18n`
- **PWA**: Angular Service Worker (web), offline catalog cache
- **Telegram Mini App**: нативный `window.Telegram.WebApp` + `auth/telegram` initData flow
- **Realtime**: Socket.io client для статусов заказов
- **Analytics**: Mixpanel/Sentry — пока не подключены (плановое M7)
- **Build**: Angular ESBuild (`@angular/build`)

### 2.2. Backend (NestJS) — фактически

- **NestJS 11** на **FastifyAdapter** (`@nestjs/platform-fastify`, `trustProxy` = один хоп — наш nginx, `TRUST_PROXY`; nginx ставит `X-Forwarded-For` из `CF-Connecting-IP`, см. `docs/security-hardening.md`)
- **Database**: PostgreSQL 16 + **Prisma 6.19** (16 миграций, см. 5.x)
- **Cache / session / rate limit**: Redis 7 через **ioredis 5**, `@nestjs/throttler` (ключ — аккаунт для вошедших, адрес клиента для анонимов; поверх — лимиты nginx `limit_req`/`limit_conn`)
- **Queue**: **BullMQ 5.74** (`@nestjs/bullmq`) для push/email/Telegram broadcast и POS sync
- **Realtime**: `@nestjs/websockets` + Socket.io 4.8 (`@nestjs/platform-socket.io`)
- **Auth**:
  - JWT через `@nestjs/jwt` + `passport-jwt` + `@nestjs/passport`
  - **Password (bcrypt 6)** для staff/RIDER + **Telegram initData** для customer + OAuth (Google/Apple через `OAuthAccount`)
  - Refresh tokens, force-rotate при инвайте (`passwordMustChange`); сброс пароля отзывает все сессии, смена — все, кроме текущей
  - JWT-секреты без фолбэка в production: без `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` API не стартует
  - Telegram initData старше `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (сутки) не принимается
  - **OTP / SMS** — не подключено (Twilio/MessageBird из ТЗ резерв на будущее)
- **Validation**: `class-validator` + `class-transformer` + DTO
- **OpenAPI**: `@nestjs/swagger` 11 — источник для `libs/api-client`
- **Scheduling**: `@nestjs/schedule` для периодических джобов (POS pull, истечение gift-cards и т.п.)
- **Payments**: **Stripe SDK 22** (Payment Intents + webhook)
- **Storage**: `@aws-sdk/client-s3` 3.x — реально пишем в **MinIO** (dev/prod), CDN `cdn.takeaway.md`. Cloudflare R2 — потенциальная замена.
- **Email**: **nodemailer 8** через SMTP (welcome, receipt, password reset). Mailgun/Postmark — резерв.
- **Push**: **web-push 3.6** (VAPID) для web/PWA + **TMA**; **APNs напрямую** для iOS (встроенный `node:http2`, ES256-токен через `node:crypto`, ключ `APNS_*` или `APPLE_*`); **FCM HTTP v1** для Android и iOS старых версий приложения, сервис-аккаунт в `FIREBASE_*`. Без SDK — JWT подписываются сами.
- **Telegram**: бот через прямые вызовы Telegram Bot API (push на rider, brand staff, customer)
- **Logs**: Pino 10 structured logs
- **Monitoring**: Sentry/Prometheus/Grafana — плановое M7

### 2.3. Mobile — фактически

- **Flutter 3.38** (Dart 3.10), iOS 15+, Android 7+ (minSdk 24). Android application id — `md.takeaway.app`, iOS bundle id — `md.takeaway.ios` (команда Apple `FGN8R2D6QW`)
- **State**: Riverpod 2.6 (`flutter_riverpod`), навигация — go_router (`StatefulShellRoute`: меню, точки, заказы, профиль)
- **Networking**: Dio + Retrofit; модели и клиент — отдельный чистый Dart-пакет `libs/api-client-dart` (json_serializable). В Flutter-приложении `build_runner` не работает из-за нативных хуков зависимостей, поэтому кодоген живёт в пакете, а сгенерированный код закоммичен
- **Auth**: Telegram Login (OIDC + PKCE, своя реализация по образцу официальных SDK: `oauth.telegram.org/crossapp` → приложение Telegram, иначе страница в системном браузере; возврат `takeaway://tglogin` через `app_links`), `google_sign_in` 7, `sign_in_with_apple` (iOS). Сессия — `flutter_secure_storage`, single-flight refresh
- **Realtime**: `socket_io_client` к `/ws` на API-хосте; без сокета — опрос раз в 5 с
- **Storage**: `shared_preferences` для настроек, JSON-файлы в кеше для меню и точек (офлайн-открытие)
- **Push**: `firebase_messaging` (включается dart-define'ами Firebase), регистрация в `/devices`: FCM-токен, на iOS ещё сырой APNs-токен и шлюз (release-сборка — `PRODUCTION`, debug — `SANDBOX`). Устройство регистрируется только при разрешённых уведомлениях и снимается, когда их выключили в настройках телефона (проверка при возврате в приложение). Разрешение спрашивается один раз сразу после входа, после первого заказа или с экрана уведомлений — не при запуске. Android-каналы: `orders` (баннер, по умолчанию) и `promotions` (тихо)
- **Maps**: `flutter_map` + OpenStreetMap через наш кеширующий прокси `takeaway.md/tiles` (nginx + Cloudflare, запасной путь — сам OSM; см. `docs/map-tiles.md`), маршрут — deep link в Apple/Google Maps
- **Payments**: привязанные карты Агропромбанка через API (как web/TMA); Stripe в регионе не работает
- **Images**: фото товаров — `cached_network_image`, пока грузится или если не загрузилось — однотонный тёплый фон. Товар без фото — без картинки вовсе, никаких заглушек (App Review отклонил иллюстрации-заглушки по Guideline 2.1(a)): в меню такие товары идут текстовыми строками под сеткой карточек с фото, экран товара начинается с названия, в поиске, корзине, «К заказу» и заказе — без миниатюры
- **Тесты**: unit + widget (`flutter test`, stateful fake API), интеграционный прогон на устройстве против живого API с KDS-переходами (`integration_test/`)

### 2.4. Инфраструктура — фактически

- **Runtime**: Docker контейнеры (Dockerfile.api для NestJS, Dockerfile.spa для Angular bundles)
- **Dev**: `docker compose -f infra/docker-compose.yml up` — Postgres 16 (host port 55432), Redis 7, MinIO. Mailhog не подключён (тестовая почта пишется на реальный SMTP).
- **Prod**: docker-compose на общем хосте, за чужим edge-nginx. Подробности топологии — 0.5. Kubernetes — будущий M7.
- **CI/CD**: GitHub Actions, preflight без `DATABASE_URL`/`REDIS_URL` (выводятся из compose), deploy guardrail
- **CDN**: `cdn.takeaway.md` (через MinIO)
- **Secrets**: env-файлы в SSH-deploy. Doppler/Vault — потенциально M7.
- **Backup**: pg_dump в S3-compatible — план

### 2.5. Third-party — фактическое состояние

| Сервис            | Назначение                 | Статус                                                           |
| ----------------- | -------------------------- | ---------------------------------------------------------------- |
| Stripe            | Платежи                    | ✅ Payment Intents + webhook                                     |
| SMTP (nodemailer) | Транзакционный email       | ✅ welcome, receipt, password reset                              |
| Web Push (VAPID)  | Push для web/PWA + TMA     | ✅ через `web-push`                                              |
| Telegram Bot API  | Уведомления rider/staff/cu | ✅ TG push + TMA initData auth + Telegram Login (OIDC)           |
| MinIO + CDN       | Object storage             | ✅ brand logo, product images через `@aws-sdk/client-s3`         |
| iiko Cloud        | POS меню/stop-list/orders  | ✅ menu + stop-list (cron) + outgoing orders                     |
| Poster            | POS + outgoing orders      | ✅ menu/stop-list/orders/webhooks                                |
| Twilio (SMS OTP)  | SMS OTP                    | ❌ не подключено (customer auth идёт через Telegram)             |
| Firebase FCM      | Mobile push                | ✅ HTTP v1, `FIREBASE_*`; Android и iOS старых версий приложения |
| Apple APNs        | iOS push                   | ✅ напрямую по HTTP/2, ключ `APNS_*` (или `APPLE_*`)             |
| Mapbox            | Карты / геокодинг          | ❌ не подключено (используем нативные браузерные карты пока)     |
| OSM Nominatim     | Геокодинг адреса точки     | ✅ через прокси API `/admin/geocode`, `GEOCODER_URL`, без ключа  |
| Sentry            | Errors + performance       | ✅ API + все четыре SPA, release = build-версия                  |
| Mixpanel          | Product analytics          | ❌ запланировано на M7                                           |

## 3. Функциональные требования

### 3.1. Модуль авторизации — фактически

Реализовано не так, как в исходном ТЗ — заходов несколько, под разные роли:

- **Customer на web**: три провайдера на выбор — **Google**, **Apple** и **Telegram Login**. Пароля нет ни у одного. Каждый провайдер включается независимо: пустой client id в `index.html` просто прячет кнопку.
- **Customer в мобильном приложении**: Telegram, Google и Apple (только iOS). Telegram — Telegram Login (OpenID Connect): подтверждение в приложении Telegram или на странице `oauth.telegram.org`, обмен кода на ID-токен по PKCE прямо на устройстве (публичный клиент, без секрета), затем `POST /auth/telegram/oidc`. Client id (= id бота) приложение берёт из `GET /auth/telegram/config`, а не из сборки.
- **Telegram Login на вебе и в админке**: новая библиотека `oauth.telegram.org/js/telegram-login.js` (попап → ID-токен) включается, когда в `index.html` задан `__TELEGRAM_CLIENT_ID`; без него работает прежний Login Widget с HMAC по токену бота. На проде включено 23.09.2026: бот @takaway_tgbot переключён в BotFather на OpenID Connect, старый виджет у него отключён навсегда. Redirect URI Telegram сверяет посимвольно, а библиотека передаёт адрес страницы с кнопкой, поэтому у бота перечислены `https://takeaway.md/login`, `https://www.takeaway.md/login`, `https://admin.takeaway.md/telegram-link` и `takeaway://tglogin` для приложения; Trusted Origins — три домена, Native Login — Android `md.takeaway.app` с отпечатками ключей подписи. ID-токены Telegram проверяются тем же `OAuthIdentityService`, что Google и Apple: JWKS `oauth.telegram.org/.well-known/jwks.json`, алгоритмы RS256/ES256, `iss = https://oauth.telegram.org`, `aud = client id`. Аккаунт ищется по `telegramUserId` (claim `id`, scope `profile`).
- **Customer в TMA**: **экрана входа нет вообще**. `initData` меняется на сессию в app-initializer до первого рендера; на 401 интерсептор молча ротирует refresh или пересоздаёт сессию из того же `initData`. Пользователь ни разу не видит слова «войти».
- **Staff** (`SUPER_ADMIN` / `BRAND_ADMIN` / `STORE_MANAGER` / `STAFF` / `RIDER`): **email + bcrypt password**. При инвайте админ выдаёт временный пароль, флаг `passwordMustChange = true` → forced /change-password при первом логине.
- **Password reset**: email-based one-shot токен (SHA-256 hash в `PasswordResetToken`).
- **Google / Apple**: ID-токен проверяется на сервере по JWKS провайдера — подпись RS256 (алгоритм зафиксирован, `alg` из заголовка не используется), `iss`, `aud` против собственных client id, `exp`. Ключи кешируются на час с обработкой ротации. Учётка привязывается через `OAuthAccount`; при совпадении **подтверждённого** email со существующим `CUSTOMER` аккаунт связывается (один профиль на все каналы), staff-аккаунты для такой привязки закрыты. Клиент без email (пришёл из Telegram) привязывает Google, Apple и Telegram явно в «Профиль → Способы входа» (`/auth/me/sign-in-methods`): если у способа уже есть профиль без заказов, способ переезжает к текущему; если без заказов текущий, клиент переходит в профиль с историей и получает новую сессию; два профиля с заказами не объединяются. Telegram не отвязывается, последний способ входа не удаляется. Настройка ключей — `docs/social-sign-in.md`.
- **JWT + refresh tokens**, logout invalidates refresh.
- **Brand link**: `auth/telegram/link` — привязка TG к уже существующему staff-юзеру.
- Профиль: имя, email, телефон, дата рождения, фото, язык, валюта, notify-prefs (`notifyOrderUpdates`, `notifyPromotions`)
- Мультидевайсность через таблицу `Device` (push token, APNs-токен для iOS, locale, lastSeenAt)
- **OTP / SMS**: не реализовано. Раньше это был единственный запасной путь для рынков без Telegram — Google и Apple его закрывают.

### 3.1a. PWA (web)

- Манифест + иконки 192/512 (обычные и maskable) + apple-touch-icon и iOS-мета-теги. Ярлыки на «Мои заказы» и «Точки рядом»
- Service worker регистрируется при старте приложения, не при включении пушей
- Офлайн: кэшируется только оболочка и иконки. Ответы `/api/*` не кэшируются никогда — устаревший ETA хуже честной ошибки
- nginx: `sw.js` отдаётся с `no-store` (иначе годовой `immutable`-кэш заморозил бы воркер навсегда), `.webmanifest` — с `application/manifest+json`
- **`takeaway.md/app`** — одна ссылка на приложение: телефон при загрузке страницы уходит в свой магазин (`location.replace`; iPhone/iPad — App Store, Android — Google Play), компьютер видит кнопки магазинов и QR-код этой ссылки (`public/app-qr.svg`, сгенерирован заранее). Сайт без SSR, поэтому редирект клиентский. Адреса — `SITE_LINKS.apps` в `apps/web/src/app/core/config/site-links.ts` (Google Play `md.takeaway.app`; id App Store пока пуст — у айфона нет редиректа и кнопки). Smart App Banner (`apple-itunes-app`) добавляется в `index.html` вместе с id, тест держит их вместе. Подробно — `docs/site-links.md`
- **Соцсети в подвале** — `SITE_LINKS.social` (instagram, telegram, tiktok, facebook, vk), иконки только у заполненных `https://`-адресов, `target=_blank rel=noopener`; сейчас все пустые

### 3.1b. PWA (admin)

- Каркас-приложение: высота ровно в экран, прокручивается только `<main>`; шапка и меню на всю высоту закреплены. На ≤900px меню — выезжающая панель по кнопке, аккаунт и выход — внизу панели
- Манифест (`standalone`, любая ориентация — кухонные планшеты), свои иконки на тёмном фоне, ярлыки «Кухня» и «Заказы»; кнопка «Установить приложение» в меню по `beforeinstallprompt`
- Service worker кэширует только манифест и иконки; упавшая навигация отдаёт встроенную офлайн-страницу. `/api/*` и сокет идут мимо

### 3.2. Каталог / меню

- Структура: **Категория → Подкатегория → Продукт → Вариации + Модификаторы**
- Категории: Coffee / Tea / Signature / Breakfast / Lunch / Desserts / Extras
- Карточка продукта:
  - Фото (несколько), описание, состав
  - Калории, БЖУ, аллергены
  - Базовая цена + диапазон цен с модификаторами
- **Вариации** (size, temperature, milk, cup): влияют на цену, могут быть связаны
- **Модификаторы** (shots, syrups, toppings): add-on с плюсом к цене, min/max count; у добавки есть группа (`Modifier.group`: «Сиропы», «Соусы», «Убрать»; пусто — общая «Добавки»), клиенты показывают добавки по группам
- **Вид категории** (`Category.kind`: горячие напитки, холодные напитки, еда, выпечка, другое): по нему кабинет показывает поля товара (кофеин, «без кофеина», молоко и стакан — только напиткам; чек-лист аллергенов — всем), предлагает готовый набор опций и время приготовления по умолчанию (`Category.defaultPrepTimeSeconds`: кофе 3 мин, шаурма 15), а сайт и Mini App выбирают заглушку товара без фото (`libs/ui-kit/src/assets/product-placeholders`; в мобильном приложении заглушек нет)
- **Набор опций категории** (`CategoryOption`): варианты и добавки, которые получает каждый товар категории — новый сразу при создании, существующие по кнопке «Применить к товарам категории». Обычно собирается из платформенного пресета вида (`OPTION_PRESETS` в shared-types). Подробнее — 5.3
- **Меню по точкам**: меню общее для бренда, но каждый товар продаётся только в отмеченных точках (`ProductStore`) — бургерная и пиццерия одного бренда показывают разное; цена везде одна. Категория без товаров этой точки в её меню не показывается
- **Стоп-лист**: скрываем товар или добавку на конкретной точке в реальном времени (до отмены или до конца дня в часовом поясе точки); ведут сотрудники кухни
- **Сезонные спецпозиции** с датой начала/окончания
- **Доступность по времени**: завтраки до 12:00, например
- Фильтры: vegan, gluten-free, decaf, без сахара
- Поиск по меню

### 3.3. Точки продаж (stores)

- Список с картой (Mapbox)
- Адрес, координаты, часы работы (per weekday)
- Тип: takeaway / dine-in / drive-thru
- Текущий статус: открыта/закрыта/перегружена (переключается вручную) и вычисляемый `openNow`. **Источник правды — смена** (решение владельца 2026-10-04): `openNow = acceptingOrders` = статус не `CLOSED` и открыта смена; часы работы на «открыто сейчас» не влияют — они показываются клиентам и задают слоты заказа ко времени. ASAP-заказ во время смены принимается и вне часов работы; заказ ко времени по-прежнему должен попадать в часы. Правило — одна функция в `apps/api/src/app/catalog/store-availability.ts`
- **Live-ETA**: для каждой точки рассчитывается «готово через X мин для ASAP-заказа» — видно в store locator ещё до открытия меню
- **Строка часов у точки** в клиентах (карточки точек, выбор точки, шапка меню; web, TMA, mobile): точка, закрытая для заказа «сейчас», но принимающая предзаказ (`openNow=false`, `acceptingOrders=true`), вместо ожидания пишет «Сейчас закрыто · откроется в 9:00 · можно заказать ко времени» (`opensAt` на следующий день — «откроется завтра в 9:00»; `asapBlockedReason=QUEUE_FULL` — «Большая очередь — только ко времени»; без `opensAt` — «Сейчас закрыто · можно заказать ко времени»), её меню, корзина и чекаут работают. Открытая точка с `closesAt` — «до 21:00». Точка с `acceptingOrders=false` показывается закрытой, как раньше. Время — по часам точки в вебе и TMA (`storeHoursNote` в `@takeaway/utils`, тексты — `storeHoursText` в `@takeaway/i18n`), по часам устройства в мобильном приложении (`shared/store_hours.dart`). API без этих полей: поведение прежнее
- **Busy meter** (0–100%) — индикатор загрузки кухни, визуализируется цветом (зелёный / жёлтый / красный)
- **Pickup point type** для UI: counter / locker / shelf — определяет инструкции на экране готовности
- Привязка меню (не все точки имеют одинаковый ассортимент)
- Фото интерьера / витрины / pickup-зоны. **Обложка (`heroImageUrl`) — картинка самой точки** в клиентских приложениях; бренд — это юрлицо, его логотип (`logoUrl`) показывается только у точки без своего фото: `heroImageUrl ?? logoUrl`. Правила загрузки — `libs/shared-types/src/lib/images.ts`, их же проверяют API и админка: фото точки — JPG/PNG/WebP до 5 МБ, рекомендуется 1200×800 (3:2); логотип бренда — JPG/PNG/WebP до 2 МБ, квадрат 512×512. AVIF для них не принимается (Flutter его не рисует); ошибки — 413 `IMAGE_TOO_LARGE` (`maxBytes`, `maxMb`) и 415 `IMAGE_TYPE`
- **Что продаёт точка** (`kinds`: `COFFEE`, `FOOD`, можно оба; не пусто) — от этого зависит маркер на карте и фильтр `GET /stores?kind=`. Пустой или отсутствующий список читается как кофе
- **Адрес → карта** в форме точки: адрес, город и страна геокодируются через `GET /admin/geocode` (OSM Nominatim за прокси API) с паузой после ввода и при уходе из поля, метка ставится сама и остаётся перетаскиваемой; поставленную вручную метку ввод адреса больше не двигает — только «Найти по адресу». Метка, поставленная до адреса, подставляет адрес (`GET /admin/geocode/reverse`)

### 3.4. Pre-order и чекаут (core flow)

**Главный механизм продукта. Вся UX-энергия направлена в этот флоу.**

- Корзина привязана к выбранной точке
- Один и тот же товар с теми же вариациями, добавками и комментарием — одна строка корзины: повторное добавление увеличивает её количество (не больше 99)
- При смене точки — предупреждение, если товара нет
- Корзина синкается между устройствами через user_id (Redis)
- **Расчёт времени готовности на лету** (`KitchenLoadService`). ETA пересчитывается при каждом изменении корзины и ещё раз при чтении — очередь движется без нас:

  ```
  eta = Store.baseEtaSeconds + невыполненная работа точки / Store.kitchenParallelism + prepSeconds заказа
        (+ BUSY_EXTRA_WAIT_SECONDS, пока точка «Загружена»)
  ```

  - `baseEtaSeconds` — постоянная накладная точки: пробить, собрать, выдать
  - невыполненная работа — сумма `Order.workSeconds` по статусам `CREATED / PAID / ACCEPTED / IN_PROGRESS`; заказ `IN_PROGRESS` считается наполовину сделанным
  - `prepSeconds` — самая долгая позиция в заказе (не сумма): бариста тянет шот, пока взбивается молоко
  - `workSeconds` — сумма по позициям с учётом количества: сколько заказ стоит кухне. Заказ из четырёх напитков грузит бар вчетверо сильнее, чем заставляет ждать своего клиента, поэтому это два разных числа
  - Оба снимаются на заказ в момент создания — правка меню задним числом не переписывает историю
  - «Загружены» с кухни (`Store.status = OVERLOADED`): к очереди добавляется фиксированное ожидание `BUSY_EXTRA_WAIT_SECONDS` (по умолчанию 300 с, `0` выключает) — очередь у стойки, большой заказ, неполная смена, которых доска не видит. Одинаково в списке точек, на странице точки, в ETA корзины/чекаута, во времени выдачи ASAP-заказа и в `store.loadChanged`. Окна заказа ко времени (`pickup-slots`) не сдвигаются — их ограничивает вместимость окна

- **Pickup time picker** — ключевой элемент чекаута:
  - `ASAP` (готово через ~X мин, таймер показывается крупно)
  - `Scheduled` — выбор из 15-минутных окон, которые точка успевает обслужить (`GET /stores/:id/pickup-slots`, 12 часов вперёд)
  - Вместимость окна — `Store.slotCapacity`. Заполненное окно приходит помеченным и рисуется вычеркнутым, а не пропадает
  - Проверка вместимости повторяется при создании заказа, включая ASAP: экран чекаута успевает устареть, и двое клиентов могут выбрать последнее окно одновременно
  - **Клиенты (web, TMA, mobile).** «Сейчас» выключен, пока `openNow=false`, и под переключателем — причина по `asapBlockedReason`: «Точка откроется (завтра) в 9:00 — выберите, к какому времени приготовить заказ», «Точка ещё не начала работу — …», «Сейчас большая очередь — …»; «Ко времени» выбран сразу. Окна — на 24 часа, под заголовками «Сегодня» / «Завтра», запрашиваются с `?cartId=` и перезапрашиваются при изменении корзины; время на следующий день подписано «09:15 завтра». Чекаут блокируется только при `acceptingOrders=false` (`STORE_NOT_TAKING_ORDERS`). Ответ `ASAP_UNAVAILABLE` переключает на «Ко времени» с причиной из ответа; `PICKUP_SLOT_FULL` сбрасывает выбранное окно и обновляет окна — клиент выбирает новое сам. Веб и TMA следят за точкой, пока открыт чекаут (сокет + раз в минуту), и выключают «Сейчас», когда точка закрылась
- Чекаут:
  1. Выбор точки (если не выбрана) — с показом «готово через X мин»
  2. **Pickup time** (ASAP / scheduled) — центральный элемент
  3. Контакт: имя на заказе + телефон для SMS-подтверждения
  4. Промокод / применение баллов
  5. Комментарий к заказу
  6. Оплата: только привязанная карта Агропромбанка, в одно нажатие; оплаты на месте нет. Сумма бронируется на чекауте и списывается, когда точка принимает заказ; новый заказ попадает на доску кухни, только когда бронь прошла, и принять его без брони нельзя. Заказ с нулевой суммой (всё покрыли баллы или подарочная карта) проходит без карты. Карты клиент привязывает в профиле («Способы оплаты») — в TMA и в вебе одинаково. Stripe Payment Intents остались в API запасным путём
- Тип получения: `PICKUP` (default), `DINE_IN` (secondary, если точка поддерживает), **`DELIVERY` — реализовано** (см. 3.11) с per-store fee overrides
- **Часы работы точки** проверяются при создании заказа и при выдаче слотов — в таймзоне точки (`Intl`, не фиксированный сдвиг), с поддержкой ночных смен. Точка без расписания считается работающей круглосуточно
- **Стоп-лист** блокирует добавление в корзину, изменение позиции и создание заказа. Записи с истёкшим `expiresAt` не блокируют
- Минимальная сумма заказа (конфигурируется per store)
- Расчёт итога (`computeTax` в `@takeaway/utils`, общая функция для API и обоих чекаутов):

  ```
  taxable = max(0, subtotal − discount) + deliveryFee
  налог в цене:  tax = taxable × rate / (10000 + rate);  total = taxable − giftCard
  налог сверху:  tax = taxable × rate / 10000;           total = taxable + tax − giftCard
  ```

  Подарочная карта вычитается после налога — это способ оплаты, а не скидка

- **VAT по точке**: `Store.taxRateBps` (500 = 5%, 2000 = 20%) и `Store.taxIncludedInPrice`. Второй флаг меняет сумму к оплате, а не только строку в чеке: в ОАЭ / Великобритании / ЕС цена налог уже содержит, в США он добавляется на кассе
- **Списание при принятии без холда** (`AGROPROMBANK_HOLD_UNTIL_ACCEPTED=false`, так работает прод: терминал не умеет ни preauth, ни возврат): на чекауте только `CheckToken`; создаётся `Payment` в `REQUIRES_ACTION` без `invoiceId` с `rawJson.deferred=true`, заказ уходит на KDS. «Принять» захватывает строку (`REQUIRES_ACTION` → `PENDING` с новым `invoiceId`) и списывает карту `ProcessCardAutoPayment` с `preauth=0` на сумму с чекаута. Отказ банка отменяет заказ (`reason=CARD_DECLINED`, KDS получает `400 {code: CARD_DECLINED}`, клиенту — пуш), отказ кухни и истечение закрывают строку как `FAILED` + `rawJson.voided=true` без вызова банка (клиент видит оплату как `NONE`). Старое списание на чекауте — `AGROPROMBANK_CHARGE_AT_CHECKOUT=true`
- **Холд вместо списания** (`AGROPROMBANK_HOLD_UNTIL_ACCEPTED`, по умолчанию on): на чекауте сумма бронируется на карте (`ProcessCardAutoPayment` с `preauth=1`), а списывается в момент, когда точка принимает заказ на KDS (`CompletePreAuthorizaion`). Отказ банка при списании не даёт принять заказ. Отмена заказа клиентом, отказ кухни (`POST /kds/orders/:id/reject`) и истечение снимают бронь (`ReverseOperation`) сразу после коммита, best-effort; не снятую бронь раз в 5 минут повторяет cron `agroprombank-reconcile` (до 20 попыток)
- **Web-платёж** (`PaymentProvider.AGROPROMBANK_WEB`, `AGROPROMBANK_WEB_ENABLED`): вторая схема — клиент вводит карту на странице банка `epay.apb.online/PaymentStart` (MD5-подпись, `ispreauth=1`). Итог берётся только из подписанного банком `GetState` (ResultURL и редиректы SuccessURL/FailURL — лишь повод спросить банк). Списание при принятии — `ComplitionOperation`, снятие брони — `CancelOperation`, возврат — `CancelOperation` в день оплаты или `RefundOperation`. Какую схему запускают клиенты, задаёт `CARD_PAYMENT_FLOW=token|web` (`cardPaymentFlow` в `/config/features`). Подробно — `docs/agroprombank-payments.md`, раздел 11
- **Состояние платежа для клиента**: `GET /orders/:id` возвращает поле `payment` — `{ state: NONE | PENDING | HELD | PAID | FAILED | REFUNDED, amountCents, cardMask, paidAt }`. Считается по последней строке `Payment` заказа; `REQUIRES_ACTION` у преавторизации читается как `HELD`. Клиенты показывают его первым блоком на экране заказа
- После оплаты: генерация **order code** (4-значный) и **QR-кода** для получения
- **TTL неоплаченного заказа** (`ORDER_PAYMENT_TTL_MINUTES`, по умолчанию 15, считается и от последней попытки оплаты): раз в минуту `OrderExpiryService` переводит просроченные `CREATED` в `EXPIRED` и возвращает промокод, остаток подарочной карты и окно выдачи. То же освобождение выполняется при отмене заказа клиентом и при отказе кухни
- **TTL принятия оплаченного заказа**: заказ с бронью ждёт кухню `ORDER_ACCEPT_TTL_MINUTES` (30) от момента брони, а заказ ко времени — не меньше, чем до времени выдачи плюс `ORDER_ACCEPT_GRACE_MINUTES` (15); затем `EXPIRED` и бронь снимается

### 3.5. Заказы и live-статус

- Статусы pickup-флоу: `CREATED` → `PAID` → `ACCEPTED` → `IN_PROGRESS` → `READY` → `PICKED_UP` / `CANCELLED` / `EXPIRED`
- Статусы delivery-флоу: после `READY` → `OUT_FOR_DELIVERY` → `DELIVERED` (см. 3.11)
- **Live-таймер ETA** на базе `currentEtaSeconds` точки + prep-time товаров
- Real-time через WebSocket (Socket.io); fallback polling — на стороне клиента
- **Уведомления** (app push FCM + web push, Telegram-бот как запасной канал; SMS — резерв). Статусы, о которых сообщаем клиенту: `ACCEPTED`, `READY`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`, `EXPIRED` — на языке клиента:
  - `PAID` — receipt email + welcome (для нового customer)
  - `READY` — push (с order code и pickup инструкцией); кому push не дошёл — Telegram
  - `RIDER_ASSIGNED` — Telegram push на rider, push на customer
  - Маркетинговые broadcast — через Campaigns (см. 3.9)
- **Geofencing**: `POST /orders/:id/location` принимает координаты клиента → автотриггер `GEOFENCE_NEAR` (300м) и `GEOFENCE_HERE` (50м или явный «I'm here»)
- **Order code & QR** — 4-значный `orderCode` (unique) + opaque `qrToken`. Поддержка обоих в KDS.
- **I'm here** — кнопка в UI клиента, эквивалент ручному `GEOFENCE_HERE` event'у
- **Что ждёт заказ** (экран заказа в web, TMA, mobile; `orderWaitNote` в `@takeaway/utils`, `order_wait.dart` в мобильном): заказ на доске и ещё не принят (бронь прошла или платить нечего) — «Ждём подтверждения точки»; такой предзаказ, пока точка закрыта (`openNow=false`, причина не `QUEUE_FULL`), — «Точка подтвердит предзаказ, когда откроется»; `ACCEPTED`/`IN_PROGRESS` после `pickupAt` — «Немного задерживаемся» (и на таймере вместо 0:00). Таймер выше часа — `ч:мм:сс`. Пока заказ не завершён и у точки есть телефон (`StoreDetail.phone`) — кнопка «Позвонить в точку» (`tel:`). Push `order_delayed` с `data.orderId` открывает заказ, как остальные пуши о заказе
- **`EXPIRED` для клиента** (`expiredOutcome`): причины истечения в заказе нет, её читают по оплате — `NONE`/`HELD` → «Точка не подтвердила заказ — деньги не списаны», `REFUNDED` → «… — деньги вернутся на карту», `PENDING`/`FAILED` → «Оплата не завершилась — заказ отменён»; карточка оплаты у отменённого/истёкшего заказа без платежа — «Деньги не списаны». В списке заказов мобильного приложения `EXPIRED` — «Не состоялся»
- История заказов с фильтрами (`/me/orders`)
- «Повторить заказ» — план (UI ещё не везде)
- Отмена: `POST /orders/:id/cancel` (refund — отдельный flow, admin)
- `EXPIRED` через job по `pickupAt`-таймеру
- Чек по email — да, через nodemailer (welcome + receipt). **PDF attachment** через `pdfkit` (Helvetica, ASCII-only) — для receipt с Cyrillic/non-ASCII PDF не прикладывается, идёт только HTML (custom font для UTF-8 — backlog). `POST /me/orders/:id/resend-receipt` для повторной отправки.

### 3.6. Программа лояльности

- **Баллы**: `LoyaltyAccount.pointsBalance` + append-only `PointsLedger` (типы: `EARN` / `SPEND` / `EXPIRE` / `ADJUST`)
- **Уровни** (фактический enum): `SILVER` / `GOLD` / `PLATINUM` (Bronze в реализации нет — упрощено)
- **Промокоды**: `Promo` с типами `PERCENT` / `FIXED` / `BOGO` / `POINTS_MULTIPLIER`, лимиты на total/per-user. Статусы — черновик → активен → пауза → завершён (`PROMO_TRANSITIONS` в `libs/shared-types`): запущенный промокод хранится как `SCHEDULED` до `startsAt` и `RUNNING` после, на чекауте работают оба внутри дат; API отдаёт статус «по факту» (активный после `endsAt` — `EXPIRED`). `Promo.inactiveDays` (3/7/14) + `segmentStoreId` — код только для неактивных клиентов (сегмент ниже), остальным чекаут отвечает `PROMO_NOT_ELIGIBLE`; гостевой `/promo/preview` этого не проверяет.
- **Уровни лояльности в кабинете бизнеса**: только статичные карточки Silver/Gold/Platinum/Signature на вкладке «Промокоды» (число участников «—», бонусы — текст без логики). Уровни платформенные (`LoyaltyAccount` на пользователя, не на бренд) и влияют только на прогресс в профиле клиента.
- **Рефералка**: реализовано — каждый юзер получает уникальный код, бонус обеим сторонам начисляется на первом PAID-заказе реферала
- **Подписки (Coffeepass)**: НЕ реализовано — кандидат на v1.x
- **Геймификация**: НЕ реализовано — далёкий backlog

### 3.7. Подарочные карты

- Реализовано как admin-driven flow (v1):
  - Brand admin выпускает карту через `/admin/gift-cards` → код шарится клиенту out-of-band
  - Клиент вводит код в чекаут (рядом с промо), баланс применяется как скидка через `GiftCardRedemption`
  - Поддержка частичного погашения (баланс остаётся)
  - Отказ в карте на чекауте — 400 с кодом в теле (`GiftCardErrorCode` в `libs/shared-types`: `GIFT_CARD_UNKNOWN`, `GIFT_CARD_OTHER_BRAND`, `GIFT_CARD_CURRENCY`, `GIFT_CARD_EXPIRED`, `GIFT_CARD_USED_UP`, `GIFT_CARD_CANCELLED`) и прежним английским `message` — по нему переводят версии приложения, вышедшие до кодов; списание, которое опередил другой заказ, — 409 `GIFT_CARD_BALANCE_CHANGED`
- НЕ реализовано в v1: customer-facing покупка карты со Stripe, кастомный дизайн/шаблон, email с подарком

### 3.8. Уведомления

- **Push**: мобильное приложение — iOS **напрямую через APNs** (`ApnsPushProvider`: HTTP/2 на `api.push.apple.com` / `api.sandbox.push.apple.com`, одно долгое соединение на шлюз с переподключением после GOAWAY/ошибки/таймаута 10 с/10 мин простоя; ES256-токен провайдера на 50 мин; ключ `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_PRIVATE_KEY`, при пустом `APNS_PRIVATE_KEY` — ключ Sign in with Apple `APPLE_*` с включённым APNs; `APNS_TOPIC` = `md.takeaway.ios`, `APNS_ENABLED=false` выключает), Android и iOS старых версий приложения — **FCM HTTP v1** (сервисный аккаунт `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`; iOS там идёт через APNs-ключ, загруженный в Firebase), браузер — **VAPID** (`web-push`). Устройства — в `Device`; токены, которые FCM называет `UNREGISTERED`, и подписки браузера с ответом 404/410 удаляются при отправке. APNs: `BadDeviceToken` повторяется на другом шлюзе (и он запоминается в `apnsEnvironment`); токен, который отвергли оба шлюза или APNs назвал `Unregistered`, стирается из `apnsToken` (строка и FCM-токен остаются); ошибки настройки (`InvalidProviderToken`, чужой topic) ничего не стирают. В payload есть `gcm.message_id`, чтобы `firebase_messaging` показывал такой push в приложении и открывал заказ по тапу.
- **Правило доставки клиенту** (`NotificationsService.deliver`): APNs, FCM и web push параллельно. iOS-устройство с `apnsToken` при настроенном APNs получает push только через Apple, его FCM-токен пропускается (без дублей, когда починят и Firebase); если Apple push не принял — пробуется FCM-токен этого устройства. Если ни один транспорт не принял (нет токенов, транспорт не настроен, отказ) и у пользователя есть `telegramUserId` — сообщение от Telegram-бота. Одинаково для статусов заказа и для маркетинговых рассылок с каналом PUSH, поэтому клиент Mini App (без токенов) получает бот, а пользователь приложения — один push без дубля в Telegram. Сбои логируются на уровне warn с причиной; в результате доставки причина сохраняется и тогда, когда сообщение всё же дошло (другим устройством или через бота).
- **Регистрация устройства**: `POST /devices` (см. 6.6) убирает строки с тем же токеном у других аккаунтов (сессия истекла без выхода — пуши прежнего аккаунта иначе приходили бы на этот телефон) и строки того же iOS-устройства с прежним FCM-токеном (тот же `apnsToken`). Приложение держит устройство зарегистрированным только при разрешённых уведомлениях — иначе FCM/APNs принимают push, который телефон не покажет, и рассылка считала бы его доставленным.
- **Email**: nodemailer/SMTP — welcome (на первом PAID), receipt (на PAID), password reset.
- **Telegram bot**: пуши rider при назначении, brand staff при новом PAID-заказе; customer — статусы заказов и рассылки, когда app/web push недоступен. Входящие сообщения бот не читает, поэтому каналом поддержки нигде не указан (поддержка — форма на `/support` и help@takeaway.md).
- **Обратная связь → платформа** (`FeedbackNotifier`): о каждом новом `Feedback` (в том числе с формы «Поддержка» на сайте — с именем гостя и его контактом) — сообщение в ops-чат (`OPS_ALERT_TELEGRAM_CHAT_ID`); если чата нет или Telegram его не принял — каждому SUPER_ADMIN с привязанным Telegram от бота; плюс email всем SUPER_ADMIN, только если настроен SMTP. Язык — `PLATFORM_LOCALE` (ru по умолчанию), ссылка — `ADMIN_APP_URL/feedback`. Best-effort: сбой доставки только логируется.
- **Per-user prefs**: `notifyOrderUpdates` + `notifyPromotions` через `PATCH /me/notifications`. Operational push (rider/brand staff) prefs не учитывает.
- **Marketing campaigns**: brand admin рассылает push/Telegram/email через `Campaign` (см. 3.9), audience: ALL / HAS_ORDERED / INACTIVE_30D / INACTIVE (сегмент неактивных с днями и точкой). Учитывается `notifyPromotions`. Список рассылок (`GET /admin/campaigns`) отдаёт по каждой `via` — сколько людей дошло через каждый транспорт (`apns`, `fcm`, `webpush`, `telegram`, `email`) — и `errors` — до трёх самых частых ошибок доставки с числом получателей (в том числе app push, который не дошёл перед Telegram-фолбэком).

### 3.9. Admin panel

- **Роли** (фактический enum): `SUPER_ADMIN`, `BRAND_ADMIN`, `STORE_MANAGER`, `STAFF`, `RIDER`, `CUSTOMER`. `ANALYST` из исходного ТЗ — нет, аналитика доступна `BRAND_ADMIN`/`SUPER_ADMIN`.
- **Brand registration + moderation**: бизнес регистрируется в админке (`/signup` → `POST /business/register`) с валютой бренда (MDL по умолчанию) и языком писем; **телефон обязателен** (команда звонит тем, кто зарегистрировался и не запустился) и хранится как контактный телефон бренда `Brand.contactPhone` в E.164. Нормализация — `normalizePhone` в `libs/utils` (одна для API и админки): разделители убираются, `00` → `+`; без кода страны читаются только домашние привычки, различимые по длине — `0` + 8 цифр → Молдова/ПМР (+373), `0` + 9 цифр → Украина (+380), `8` + 10 цифр → Россия (+7), и код страны без плюса; для +373 / +380 / +7 проверяется длина номера. Форма показывает, как номер будет сохранён. Если номер уже есть у другого аккаунта (часто — у самого владельца как покупателя), регистрация не отказывает: номер остаётся у бренда, а на аккаунт владельца не ставится. Конфликты email возвращаются кодами (`EMAIL_TAKEN`, `EMAIL_CUSTOMER_ACCOUNT`). Владелец меняет телефон в настройках бренда (`PATCH /my-brand { contactPhone }`, очистить нельзя). Бренд создаётся `PENDING`; владелец попадает на дашборд с чек-листом «Запуск бренда» (`GET /my-brand/onboarding`: логотип, точка с адресом и часами, категория и товар с фото, оплата, модерация) и видит баннер статуса на всех страницах. Шаг, открытый из чек-листа, возвращает владельца на дашборд после сохранения, если шаг стал выполнен (короткая плашка «Сохранено» и подсветка следующего шага; после последнего — состояние «Всё готово» с переходом к панели); если шаг ещё не выполнен, страница остаётся и пишет, чего не хватает. Прямые заходы на те же страницы работают как раньше; пока запуск не завершён, на «Настройках», «Точках» и «Меню» есть ссылка «Вернуться к запуску бренда» (`OnboardingFlowService` в админке). SUPER_ADMIN одобряет/отклоняет в модальном окне; причина отказа обязательна (и на сервере). Отклонённый бренд после правок отправляется повторно (`POST /my-brand/resubmit`). Письма владельцу («заявка получена», «одобрен», «нужны правки» — на языке бренда) и платформе (новая заявка, повторная подача — email всем SUPER_ADMIN и ops-чат в Telegram); сбой отправки не ломает запрос. Контакт поддержки — `SUPPORT_EMAIL` / `SUPPORT_TELEGRAM`.
- **Menu management**: CRUD категорий / продуктов / вариаций / модификаторов; цена вводится в валюте бренда, время приготовления — в минутах; до 6 фото на товар (первое — главное, JPEG/PNG/WebP/AVIF до 5 МБ, тип определяется по содержимому, SVG не принимается); слаги необязательны и генерируются из названия с транслитерацией кириллицы; порядок категорий и товаров; удаление непустой категории — 409 `CATEGORY_NOT_EMPTY` или перенос товаров (`?moveProductsTo=`); удаление товара или опции чистит корзины в транзакции; «нет в наличии» по точке — до отмены или до конца дня в часовом поясе точки; описание, КБЖУ, кофеин, диетические метки, аллергены.
- **Store management**: новая точка создаётся `CLOSED` (черновик) с чек-листом готовности `readiness` (координаты, часовой пояс IANA, часы работы, видимая позиция в меню, одобрение бренда — информативно); открыть точку можно только когда обязательные пункты выполнены (409 `STORE_NOT_READY` со списком). Часовой пояс проверяется на сервере; если он не передан, API выводит его из города / страны / координат (`suggestStoreTimeZone` в `libs/utils`: Молдова и ПМР → `Europe/Chisinau`, Украина → `Europe/Kyiv`, Россия → `Europe/Moscow`, Румыния → `Europe/Bucharest` и др.; рамка координат Молдовы), иначе берёт преобладающий пояс других точек бренда, иначе `Europe/Chisinau` — никогда не UTC (так же для точек из POS). Форма создания подставляет пояс по адресу, пока владелец не выбрал его сам; открытая точка на UTC подсвечивается красным баннером на карточке и на дашборде; валюта берётся из бренда и блокируется после первого заказа (409 `STORE_CURRENCY_LOCKED`); точка с заказами не удаляется, а закрывается (409 `STORE_HAS_ORDERS`). Редактор: основное, часы работы (расписание или круглосуточно, выходные по дням, окна через полночь), касса и кухня (налог, способы получения, место выдачи, базовое время, параллельность, ёмкость слота, минимальный заказ), фото (обложка и до 8 в галерее), доступ на кухню (PIN сотрудников); **per-store delivery fee overrides**.
- **Staff roster**: страница «Сотрудники» — по людям, а не по точкам (`/admin/staff`): у сотрудника одна роль (`User.role`) и список точек, где он работает (pivot `UserStore`); точки отмечаются в карточке сотрудника, приглашение сразу на несколько точек. Досягаемость: SUPER_ADMIN — все точки (бренда из `brandId`), BRAND_ADMIN — точки своих брендов, STORE_MANAGER — только назначенные ему; точки вне досягаемости вызывающего не показываются и не меняются. STORE_MANAGER не назначает менеджеров и не меняет других менеджеров, свои роль и точки не меняет никто. Без последней точки сотрудник выбывает из команды; PIN кухни, привязанный к снятой точке, сбрасывается. Старые per-store `/admin/stores/:id/staff` остались для других клиентов; курьеры — `/admin/stores/:id/riders`. Invite — через временный пароль с force-rotate (правило 8–128 символов показано у поля, кнопка «Сгенерировать», под выбором роли — описание Менеджер / Кухня / Редактор меню, по умолчанию Кухня) и письмо-приглашение с одноразовой ссылкой задать свой пароль (72 ч); без SMTP форма показывает, что передать лично. На странице — «Планшеты кухни»: привязанные планшеты, одноразовая ссылка для нового, отвязка. В карточке сотрудника владелец (BRAND_ADMIN) и SUPER_ADMIN могут «Сбросить пароль» без почты: API генерирует временный пароль (12 символов, как кнопка «Сгенерировать»), показывает его один раз, ставит `passwordMustChange`, завершает все сессии сотрудника (кабинет и PIN-планшет), гасит ранее высланные ссылки и, если есть SMTP, шлёт новую ссылку задать свой пароль (72 ч). Только для тех, все точки которых в брендах вызывающего (иначе 403 `STAFF_NOT_EDITABLE`); в журнал — кто, кому, сколько сессий, судьба письма, без пароля. «Забыл пароль» и ссылки в письмах ведут на `ADMIN_APP_URL`; без SMTP или (в проде) без `ADMIN_APP_URL` восстановление отвечает 503 `PASSWORD_RESET_UNAVAILABLE`, а не обещает письмо.
- **Меню по точкам и стоп-лист**: в форме товара — «Продаётся в точках» (галочки, по умолчанию все; у бренда с одной точкой блок скрыт и точка назначается сама), в таблице меню — чипы точек и «—» в колонке наличия для точки, где товар не продаётся. Страница «Стоп-лист» (`/stop-list`, роли SUPER_ADMIN / BRAND_ADMIN / STORE_MANAGER / STAFF, ссылка в меню и в шапке «Кухни»): выбор из своих точек, блюда и напитки точки и добавки, которыми пользуются её товары, переключатель «В наличии / В стопе» (до отмены или до конца дня), поиск и фильтр «только в стопе». STAFF только переключает — создавать, менять и удалять товары и добавки он не может (API-роли).
- **Orders**: `/admin/orders` живой фид. **Refund**: `POST /admin/orders/:id/refund` — full/partial Stripe refund, обновляет `Payment.refundedCents` + `PaymentStatus`, эмитит `REFUND_ISSUED` event с `actorId`. RBAC: SUPER_ADMIN — всё, BRAND_ADMIN — только свои бренды, STORE_MANAGER — только свои store-scope.
- **Тарифы (BrandPlan)**: `BASIC` (10 %) и `PRO` (15 %), `Brand.plan` + `Brand.commissionBps`. Что входит в тариф — `PLAN_FEATURES` в `libs/shared-types` (единый источник для админки и API). API: `@RequiresPlanFeature(feature)` → 403 `PLAN_FEATURE_REQUIRED` `{ feature, requiredPlan }`, бренд берётся из `brandId` запроса или из всех брендов пользователя, SUPER_ADMIN проходит всегда. Админка: `PlanAccess` по активному бренду, `planGated()` — на том же пути вместо раздела страница апселла, в меню значок PRO. PRO-разделы: промокоды (`/promotions/promo`), `/campaigns`, `/customers`, глубокая аналитика (top-products, cohort), сравнение точек, сотрудники, список неактивных, win-back. Подарочные карты, интеграции — на всех тарифах. Существующие на момент миграции бренды — PRO, новые — BASIC; тариф меняет SUPER_ADMIN (`PATCH /admin/brands/:id/plan`), оплаты нет. Смена тарифа или ставки пишется в историю ставок `BrandCommissionRate` (с этого момента), `Brand.commissionBps` — ставка, действующая сейчас. Владелец на BASIC просит PRO кнопкой «Перейти на PRO» в карточке тарифа (`POST /my-brand/plan-request { plan, note? }`): на бренде запоминаются `requestedPlan` + `planRequestedAt`, в «Обратную связь» пишется сообщение `PLAN_CHANGE` от бизнеса (тот же ops-алерт в Telegram, что и у отзывов клиентов), повторная заявка на тот же тариф ничего не шлёт, тариф, который уже стоит, — 409 `PLAN_ALREADY_ACTIVE`. SUPER_ADMIN видит заявку на карточке бренда и во вкладке «Заявки на тариф» (бейдж «Бренды» = заявки на модерацию + заявки на тариф); смена тарифа или «Закрыть заявку» (`DELETE /admin/brands/:id/plan-request`) её снимают.
- **Поддержка из админки бизнеса**: «Написать в поддержку» внизу меню (роли бренда: BRAND_ADMIN, STORE_MANAGER, MENU_EDITOR, STAFF) и в карточке тарифа — тема (вопрос / не работает / предложение) и сообщение (`POST /admin/support?brandId=`). Ложится в «Обратную связь» с источником `BUSINESS` и брендом, алерт — как у отзывов клиентов, с названием, тарифом и телефоном бренда; лимит — тот же (5 в час на аккаунт).
- **Расчёты с брендами** (`/settlements`; SUPER_ADMIN — «Расчёты с брендами», любой бренд; BRAND_ADMIN — «Расчёты», только свои, без правок): бренд, валюта (не суммируются), период в поясе точек бренда (прошлая/эта неделя, прошлый/этот месяц, свои даты). Заказ учитывается, если по нему захвачена оплата картой (даже возвращённая) или точка его приняла; день и ставка — по моменту принятия (если не принят — по первой захваченной оплате). Карточки: «Всего оплачено картами» (сумма захваченных `Payment.amountCents` без чаевых), «Комиссия takeAway» (ставка × (оплачено − возвраты), округление до копейки вверх от половины по каждому заказу), «К выплате бренду» (база − комиссия), «Уже выплачено», «Остаток» (на начало + к выплате − выплачено; возврат после выплаты уменьшает следующую). Отдельно — заказы на 0 (всё покрыли промокод/баллы/подарочная карта) и принятые без оплаты через платформу. Таблица по дням (продажи, промокоды, баллы, подарочные карты, доставка, оплачено, возвраты, база, комиссия, к выплате) и CSV. SUPER_ADMIN: «Зафиксировать выплату» (PENDING с дня после прошлой выплаты по конец выбранного завершённого периода, сумма — весь долг на конец периода), «Отметить выплаченной» с номером платёжки, удаление последней невыплаченной; индивидуальная ставка с даты (или возврат к ставке тарифа), история ставок с интервалами действия; ставка с будущей датой включается кроном `commission-rate-sync` (раз в час). Определения, пример и решения для владельца — `docs/settlements.md`.
- **«Акции» (`/promotions`)**: один пункт меню (`NavKey` `promotions` = объединение ролей двух вкладок) с вкладками «Промокоды» (`/promotions/promo`, PRO, апселл внутри вкладки) и «Подарочные карты» (`/promotions/gift-cards`, все тарифы); у каждой вкладки свой `navKey` и guard, как раньше. Старые `/promo`, `/promo/new`, `/gift-cards`, `/gift-cards/new` редиректят на новые адреса.
- **Промокоды**: в строке — статус и кнопки следующего шага (запустить / пауза / возобновить / завершить с подтверждением); черновик, а также запланированный или на паузе без единого использования — правятся целиком (`/promotions/promo/:id`, `PATCH /admin/promo/:id`, иначе 409 `PROMO_NOT_EDITABLE`); переходы вне схемы — 409 `PROMO_STATUS_NOT_ALLOWED`, занятый код — 409 `PROMO_CODE_TAKEN`, запуск после `endsAt` — 400 `PROMO_ENDED`. Форма задаёт лимиты на клиента и всего и «Кому доступен: всем / только неактивным (дни, точка)».
- **Gift cards**: выпуск и отмена.
- **Marketing campaigns**: composer + send (push/Telegram/email broadcast), тариф PRO (`@RequiresPlanFeature('campaigns')` на весь контроллер). Работают на бренде из переключателя (SUPER_ADMIN — любой бренд, `?brandId=`).
  - **Аудитории**: `ALL` — все клиенты (`role = CUSTOMER`, не заблокированы), у которых есть связь с брендом: заказ в его точке в любом статусе, корзина в его точке или купленная подарочная карта бренда (бот и приложение у платформы общие, поэтому вход через них с брендом не связывает); `HAS_ORDERED` — хотя бы один оплаченный заказ; `INACTIVE_30D` — платили, но не за последние 30 дней; `INACTIVE` — сегмент неактивных клиентов (`Campaign.inactiveDays` 3/7/14, `segmentStoreId` — только заказы этой точки, иначе весь бренд), состав считается в момент предпросмотра и отправки — те же люди, что «Клиенты → Неактивные». Вкладка «Возврат» и «Клиенты» открывают конструктор с этой аудиторией и готовым текстом (`?audience=INACTIVE&inactiveDays=&storeId=&code=`), а не списком id.
  - **Предпросмотр** до отправки (`GET /admin/campaigns/preview`): сколько человек в аудитории, сколько достижимо и через что (приложение / браузер / Telegram / email), сколько без канала и сколько отписались, и какие транспорты настроены на сервере.
  - **Тест себе** (`POST /admin/campaigns/test`): текст уходит только текущему админу по тем же правилам, без учёта его отписки.
  - **Модерация**: каждая рассылка бизнеса до отправки проходит проверку SUPER_ADMIN (и рассылка неактивным из «Возврата» / «Клиентов» — её конструктор тоже заканчивается «Отправить на модерацию»; в очереди охват `INACTIVE` считается по сегменту). `DRAFT` → «Отправить на модерацию» (`POST /admin/campaigns/:id/submit`) → `PENDING_REVIEW` (+ алерт в ops-чат `OPS_ALERT_TELEGRAM_CHAT_ID`, если он настроен) → `APPROVED` → отправка сразу или в `scheduledAt` → `SENDING` → `SENT` / `FAILED`; либо `REJECTED` с причиной `reviewNote`, которую бизнес видит в списке и в форме, правит (`PATCH /admin/campaigns/:id`) и отправляет снова. Править можно только `DRAFT` и `REJECTED` (409 `CAMPAIGN_NOT_EDITABLE`), удалить — всё, что ещё не начало уходить (`DRAFT` / `PENDING_REVIEW` / `REJECTED` / `APPROVED`). На модерацию не принимается пустая аудитория (400 `CAMPAIGN_NO_RECIPIENTS`) и время отправки в прошлом (400 `CAMPAIGN_SCHEDULED_IN_PAST`). Рассылка, отправленная SUPER_ADMIN, одобряется сразу при submit. Пока рассылка на модерации, бизнес может «Отозвать в черновик» (`POST /admin/campaigns/:id/withdraw`, `PENDING_REVIEW` → `DRAFT`, иначе 409 `CAMPAIGN_NOT_PENDING`); удаление ожидающей или одобренной рассылки админка подтверждает диалогом. О решении модератора владелец бренда узнаёт от бота в Telegram (если привязал) и по email (если настроен SMTP) — на языке бренда, с причиной отказа и ссылкой на рассылку; сбой доставки решение не отменяет. Очередь — `/campaign-moderation` в кабинете платформы (бейдж в меню): текст как у покупателя, канал, аудитория и охват сейчас, время отправки; «Одобрить» / «Отклонить» (причина обязательна); вкладки одобренных и отклонённых. Отправку без одобрения исключают три места: `isSendable` (повтор только при `approvedAt`), захват строки в `SENDING` (условие `approvedAt IS NOT NULL`) и сам фоновый прогон (`run` без `approvedAt` ничего не отправляет). Крон раз в минуту запускает одобренные рассылки, у которых наступило `scheduledAt` (и одобренные, чей старт потерялся при рестарте).
  - **Отправка в фоне**: одобрение (или «Повторить») сразу переводит рассылку в `SENDING`; рассылка идёт пачками по 50, по каждому получателю пишется `CampaignDelivery` (SENT / FAILED / NO_CHANNEL / OPTED_OUT), счётчики обновляются после каждой пачки. Итог — `SENT`, если доставлено хоть одному, иначе `FAILED` с `lastError`. Падение рассылки → `FAILED` с текстом ошибки; `SENDING` без движения дольше 10 минут крон переводит в `FAILED`. Аудитория, опустевшая к моменту старта, — `FAILED` с причиной.
  - **Повтор** (`POST /admin/campaigns/:id/send`): только одобренная рассылка — `FAILED`, зависшая `SENDING` и `SENT` с ошибками; получатели, которым уже доставлено, пропускаются. Пустая аудитория — 400 `CAMPAIGN_NO_RECIPIENTS`, повторный запуск во время отправки — 409 `CAMPAIGN_IN_PROGRESS`, неодобренная — 409 `CAMPAIGN_NOT_SENDABLE`.
  - **Миграция `20261010110000_campaign_moderation`**: статус `SCHEDULED` удалён; существовавшие `SCHEDULED`, `FAILED` и `SENDING` стали `PENDING_REVIEW` (до аудитории они не дошли или дошли не целиком, а повтор теперь требует одобрения), `DRAFT` остались черновиками, `SENT` остались историей без одобрения (повторить их ошибки нельзя).
- **Analytics**: summary, order-statuses, revenue, top-products, cohort, stores, staff, churn, winback и `/admin/customers`. Период — `from`/`to` (календарные дни в часовом поясе точки или преобладающем поясе бренда; `days` по-прежнему принимается), сравнение — с таким же отрезком до него; `storeId` сужает до точки в скоупе. Цифры бренда читаются из `Order` между локальными полуночами (индекс `Order(storeId, createdAt)`), выручка — без `CANCELLED` и `EXPIRED`. `mv_orders_daily` (UTC-дни, refresh каждые 5 минут через `AnalyticsRefreshService`) питает только экран «Весь проект». Неактивные (отток): клиент неактивен, когда он сделал минимум 3 засчитанных заказа (`INACTIVE_MIN_ORDERS`) и после последнего прошло 3/7/14 дней без нового; «стал неактивным в периоде» — этот порог пришёлся на период и клиент не вернулся к его концу; упущенная выручка — сумма их средних чеков. Возврат: клиенты, неактивные к началу периода (тот же порог 3 заказов), заказавшие в нём. Сегменты клиентов (`customers/customer-segment.ts`, одно правило для списка «Клиенты», аудитории `INACTIVE` и промокодов): постоянные — 3+ заказа; неактивные — 3+ заказа и ни одного за N дней (сейчас, без периода). Любимое клиента — позиции из 5+ штук по засчитанным заказам (по id товара из снимка позиции), напиток или блюдо — по кофеину, опциям напитка (температура, молоко, стакан) и названию категории/товара, иначе без типа. Удалённые аккаунты (`User.blockedAt`) в оттоке и списке клиентов не участвуют, их заказы остаются в выручке.
- **POS integrations**: connect (с шифрованными credentials AES-256-GCM), sync stores/menu/stop-list, мониторинг jobs.
- **Бренды** (`/brands`, только SUPER_ADMIN): у карточки — контактный телефон (ссылка `tel:`), прогресс «Запуска бренда» (`onboarding`: шагов из 5 и какие выполнены) и заявка на тариф; вкладки по модерации плюс «Зарегистрировались, но не запустились» (бренды с владельцем, чек-лист не завершён; то же — `GET /admin/brands?notLaunched=true`) и «Заявки на тариф».
- **Обратная связь** (`/feedback`, только SUPER_ADMIN, пункт меню с бейджем непрочитанных): отзывы, предложения и проблемы, которые клиенты пишут из профиля в приложении, на сайте и в Mini App, обращения с формы «Поддержка» на сайте (гость без аккаунта — имя «(без аккаунта)» и его email/телефон ссылкой `mailto:` / `tel:`) и обращения бизнесов из админки (источник «Панель бизнеса», бренд и его телефон на карточке). Новые сверху; вкладки «Входящие» (всё, кроме архива) / «Непрочитанные» / «Архив», фильтр по типу; у карточки — тип, текст, клиент (имя, email, телефон, Telegram ID; «аккаунт удалён»), оставленный контакт, платформа и версия приложения, дата. «Прочитано» / «Непрочитано», «В архив» / «Вернуть из архива».
- **Цвета бренда отключены** (решение владельца 11.10.2026): все бренды в одном стиле takeAway. Редактора «Цвета темы» в настройках нет, каталог отдаёт `brand.themeOverrides: null`, Mini App красится только палитрой Telegram. Колонка `Brand.themeOverrides` оставлена для отката; `PATCH /my-brand` и `/admin/brands` поле принимают и игнорируют (старые вкладки админки).
- **Multi-brand**: ✅ через `BrandScopeService` (BRAND_ADMIN видит только свой бренд) и `UserStoreScopeService`: SUPER_ADMIN — все точки, BRAND_ADMIN — точки своих брендов, STORE_MANAGER и STAFF — назначенные. Скоуп проверяется во всех per-store маршрутах, в KDS-сокете, у курьеров и в аналитике.

### 3.10. KDS (экран баристы)

- Раздел «Кухня» (`/kitchen`) в кабинете бизнеса `apps/admin`; отдельное приложение `apps/kds` выведено 26.09.2026, `kds.takeaway.md` отвечает 301 на `admin.takeaway.md/login/pin`. Планшет на точке — тот же кабинет в «режиме планшета»: без меню и шапки, тёмная доска на весь экран; включается PIN-входом или кнопкой на доске
- Новые заказы приходят по всему кабинету: всплывающая карточка с «Принять», звук, системное уведомление из фоновой вкладки, счётчик непринятых в меню. Кабинет держит одно сокет-подключение (`kds.subscribe` на все точки активного бренда) с повторным входом в комнаты после переподключения
- Авторизация: email + password (`auth/password/login`), а также **KDS PIN** (`auth/kds/pin`) scoped to one store (только STAFF/STORE_MANAGER, аккаунт должен работать в этой точке и только в её бренде). PIN управляется через `PUT/DELETE /admin/stores/:id/staff/:userId/kds-pin`: новый PIN — ровно 6 цифр и не «первая догадка» (одна цифра шесть раз, ряд 123456/987654; 400 `KDS_PIN_FORMAT` / `KDS_PIN_TOO_SIMPLE`), на входе принимаются 4–6 цифр, так что выданные раньше 4–5-значные PIN работают. PIN хранится как HMAC-SHA256(storeId+pin) с server secret `KDS_PIN_SECRET`; без секрета (пусто или `CHANGE_ME`) установка и вход по PIN отвечают 503 `KDS_PIN_NOT_CONFIGURED`, API при этом стартует.
- **Привязка планшета** (`KitchenDevice`): вход по PIN принимается только с планшета, привязанного к бренду точки (`deviceToken` в теле; без него 401 `KDS_DEVICE_REQUIRED`, с неизвестным/отвязанным — 401 `KDS_DEVICE_UNKNOWN`). Планшет привязывается один раз: сотрудник бренда (STAFF и выше) открывает на нём «Кухню» под своей учётной записью — доска вызывает `POST /auth/kds/device { storeId }`, так же сами привязались планшеты, вошедшие до появления привязки, — или владелец/менеджер делает на странице «Сотрудники» одноразовую ссылку `/login/pin?pair=<code>` (код в Redis, 24 часа, один раз; `POST /auth/kds/device/pair`). Токен (256 бит) лежит в localStorage планшета, в БД — только SHA-256. Экран PIN берёт точки из `GET /auth/kds/device` (заголовок `X-Kitchen-Device`): только точки привязанного бренда, где есть хотя бы один действующий PIN. Публичный `GET /stores` экран PIN больше не использует. Список, ссылка и отвязка — `/admin/kitchen-devices`.
- **Сессия по PIN ограничена кухней**: токены несут claim `kds = storeId` (сохраняется при refresh), `KdsSessionGuard` пускает такую сессию только в маршруты с `@KdsSessionAllowed` (доска и смена `/kds/*`, стоп-лист и наличие точки, список точек и свой бренд, `/auth/me`) и только для своей точки (403 `KDS_SESSION_LIMITED` / `KDS_SESSION_STORE`); `BrandScopeService` сужает её до бренда точки; сокет — только `kds.subscribe` своей точки. Кабинет при PIN-сессии показывает только «Кухню» и «Стоп-лист».
- **Защита от подбора**: per-IP throttle (8/мин) + счётчик в Redis на пару точка × планшет: 5 неверных PIN бесплатно, затем пауза 1, 2, 4 … 60 минут (429 `KDS_PIN_LOCKED` с `retryAfterSeconds`), успешный вход сбрасывает; общий потолок на точку — 100 неверных за час → пауза 15 минут. Планшет проверяется до подсчёта, поэтому посторонний не может заблокировать кухню. UI lockscreen — `/login/pin` в кабинете: 4–6 цифр, отправка кнопкой «Войти»/Enter (длину PIN экран не знает, автоотправка на 4-й цифре делала 5–6-значные PIN невозможными).
- **«Загружены»**: кнопка в шапке доски при открытой смене (`PUT /kds/busy?storeId= { busy }`) переключает `Store.status` OPEN ⇄ OVERLOADED (тот же статус, что владелец видит значком в «Точках» и может выбрать в редакторе точки); закрытую точку (`CLOSED`) не трогает — 409 `STORE_SWITCHED_OFF`. Смена несёт `busy`, отметка снимается сама при «Закончить работу». Каталог отдаёт у загруженной точки `busyMeter = 100` (иначе сохранённое значение); ETA считается по очереди (`KitchenLoadService`) плюс `BUSY_EXTRA_WAIT_SECONDS` (по умолчанию 5 мин), пока точка загружена — см. 3.4. Оповещения: `kds.shiftChanged`, `store.availabilityChanged` (клиенты перечитывают точку) и `store.loadChanged`.
- Колонки: фид через `GET /kds/orders` + статус-переходы `accept` → `start` → `ready` → `picked-up`
- **Смена точки**: точка принимает заказы, только пока открыта смена (`StoreShift` с `closedAt = null`). Над доской — «Начать работу» / «Закончить работу» (`POST /kds/shift/open|close`), те же кнопки на карточке точки в «Точках». Пока смена закрыта, `GET /stores` отдаёт `acceptingOrders: false` (и `openNow: false`; пока открыта — оба `true`, даже вне часов работы), клиенты показывают точку «Не работает», создание заказа отвечает `STORE_NOT_TAKING_ORDERS`. Корзину собрать можно. Смена открывается и закрывается только вручную; остальные планшеты узнают об этом по `kds.shiftChanged`
- **Клиент на месте**: строка доски несёт `customerArrival` (`NEARBY` | `HERE` | null) и `customerArrivedAt` из событий `CUSTOMER_NEARBY` / `CUSTOMER_HERE`; на карточке — плашка «Клиент рядом» / зелёная «Клиент на месте · N мин»
- Звук при новом заказе — да
- **Dual timer на карточке**:
  - Время до pickup (обещанное клиенту) — основной
  - Время с момента принятия — вспомогательный
  - Цветовая индикация: зелёный / жёлтый / красный
- **Customer proximity alerts**:
  - «Клиент в пути» — `GEOFENCE_NEAR` event (300м)
  - «Клиент у двери» — `GEOFENCE_HERE` (ручной «I'm here» + 50м auto)
- **Order code** + opaque QR token отображаются большим шрифтом
- Отображение комментариев, имени клиента, способа получения, delivery flag
- Отдельная колонка READY — да (с обратным таймером)
- Печать на кухонный принтер — план (v2)

### 3.11. Delivery (расширение оригинального ТЗ)

Доставка реализована в модели «бренд организует своих курьеров», без курьерской сети takeAway:

- **Заказ**: `fulfillmentType = DELIVERY`, поля `deliveryAddress*`, `deliveryLat/Lng`, `deliveryFeeCents`, `deliveryDistanceM` снепшотятся на Order. Адрес и fee неизменны после создания.
- **Quote**: `POST /delivery/quote` считает fee и distance до адреса по координатам
- **Per-store overrides**: `Store.deliveryFee*` (base/perKm/freeRadiusM/maxRadiusM) — null = глобальный env-default
- **Dispatch (manager)**: `/delivery/queue` + `/delivery/orders/:id/assign { riderId }`, `/delivery/riders` — staff scoped per-store
- **Rider workflow**: `/delivery/my`, `/delivery/orders/:id/self-assign`, `PATCH /delivery/orders/:id/status` для `OUT_FOR_DELIVERY` → `DELIVERED`
- **Уведомления**: Telegram push на rider при назначении, push клиенту на каждом переходе
- **TMA**: TMA-приложение умеет сразу запросить geolocation для адреса доставки; поддерживается scheduled delivery

### 3.12. POS integrations (расширение оригинального ТЗ)

Реализованы внешние back-office интеграции для брендов, у которых уже есть iiko или Poster:

- **Pluggable**: `IPosProvider` интерфейс, провайдер выбирается через enum `PosProvider`
- **Poster** (joinposter.com): ✅ menu import (M2), stop-list (M2), outgoing orders (M3), webhooks (M4) — app-level + per-brand routing
- **iiko Cloud**: ✅ M5 — connect, listStores, importMenu (`/api/1/nomenclature`), importStopList (через cron `PosCronService`, `/api/1/stop_lists`), pushOrder (`/api/1/order/create`). Требует pinned `settings.organizationId` для menu и pushOrder.
- **Credentials**: AES-256-GCM шифрование (`POS_CREDENTIALS_KEY`, 32 bytes hex), хранятся в `PosIntegration.credentialsCiphertext`. См. `docs/integrations.md`.
- **Sync jobs**: `PosSyncJob` с прогрессом — UI в admin отображает live-статус
- **External-id linking**: Store / Category / Product / Modifier хранят `externalProvider + externalId` для двусторонней связи

## 4. Нефункциональные требования

- **Производительность**: p95 API < 250ms, time-to-interactive web < 2s на 4G
- **Доступность**: 99.9% uptime (≈ 43 мин/мес downtime)
- **Безопасность**: HTTPS only, HSTS, CSP, rate limiting, OWASP Top-10, PCI-DSS через Stripe (no card data on our servers)
- **GDPR**: согласия, экспорт и удаление данных пользователя
- **i18n**: EN, RU + архитектурная готовность к AR, ES, PT, TH, ID
- **A11y**: WCAG 2.1 AA
- **Offline**: просмотр меню и корзины offline в PWA/TMA
- **Logs**: все запросы с correlation_id, retention 30 дней
- **Тесты**: unit > 70%, e2e на critical path (auth → order → pay)

## 5. Модель данных (ключевые сущности)

> Источник истины — `apps/api/prisma/schema.prisma` (16 миграций). Все денежные суммы — **в центах** (`*Cents`-поля Int), все длительности — **в секундах** (`*Seconds`).

### 5.1. Identity / Auth

```
User (id, phone?, email?, emailVerifiedAt?, passwordHash?, passwordMustChange, name?, locale, currency,   // emailVerifiedAt — адрес подтверждён Google/Apple; вход через соцсеть присоединяется к профилю по email только при нём
      telegramUserId?, role[CUSTOMER|RIDER|STAFF|STORE_MANAGER|BRAND_ADMIN|SUPER_ADMIN],
      notifyOrderUpdates, notifyPromotions, blockedAt?, referralCode?, referredByUserId?,
      kdsPinHash?, kdsPinStoreId?)                            // KDS lockscreen PIN, scoped to one store
Device (id, userId, type[WEB|TMA|IOS|ANDROID], pushToken?, apnsToken?,   // apnsToken — сырой APNs-токен iOS (hex)
        apnsEnvironment?[PRODUCTION|SANDBOX], locale, lastSeenAt)
OAuthAccount (id, userId, provider[GOOGLE|APPLE|TELEGRAM], providerUserId)
PasswordResetToken (id, userId, tokenHash, expiresAt, consumedAt?)   // «забыл пароль» (1 ч) и ссылка из приглашения сотрудника (72 ч)
KitchenDevice (id, brandId [CASCADE], tokenHash (unique, SHA-256), createdById?, createdAt,
               lastUsedAt?, revokedAt?)                       // планшет кухни, привязанный к бренду; токен — в localStorage планшета
Referral (id, referrerId, refereeId, status[PENDING|REWARDED|CANCELLED], rewardOrderId?,
          referrerPointsCredited, refereePointsCredited)
Feedback (id, userId? [SET NULL], brandId? [SET NULL],
          kind[REVIEW|SUGGESTION|PROBLEM|QUESTION|PLAN_CHANGE], message (1–2000, trimmed; у PLAN_CHANGE может быть пустым),
          contact? (≤200), name? (≤80), source[IOS|ANDROID|WEB|TMA|BUSINESS], appVersion?,
          status[NEW|READ|ARCHIVED], readAt?, createdAt)        // «Обратная связь» из профиля клиента;
                                                                 // форма «Поддержка» сайта: гость — userId null, contact
                                                                 //   (email в нижнем регистре или E.164) и name;
                                                                 // BUSINESS — «Написать в поддержку» / «Перейти на PRO» из админки, с brandId
```

### 5.2. Tenancy / Stores

```
Brand (id, slug, name, currency, locale, logoUrl?, themeOverrides? (не используется с 11.10.2026, оставлена для отката), ownerId?,
       moderationStatus[PENDING|APPROVED|REJECTED], moderationNote?,
       plan[BASIC|PRO] = BASIC, commissionBps = 1000,   // тариф и комиссия платформы, меняет SUPER_ADMIN
       contactPhone? (E.164; обязателен при регистрации, у старых брендов — из телефона владельца или null),
       requestedPlan?[BASIC|PRO], planRequestedAt?)     // заявка «Перейти на PRO», снимается сменой тарифа
Store (id, brandId, slug, name, address, lat, lng, timezone, currency,
       status[OPEN|CLOSED|BUSY|PAUSED], fulfillmentTypes[], pickupPointType[COUNTER|SHELF|LOCKER],
       kinds[COFFEE|FOOD] = [COFFEE],          // что продаёт точка: маркер и фильтр на карте; не пусто
       heroImageUrl?, galleryUrls[],            // обложка — фото самой точки (логотип бренда — запасной)
       busyMeter, baseEtaSeconds, kitchenParallelism, slotCapacity, minOrderCents,   // OVERLOADED = «Загружены» с кухни; в API busyMeter у неё 100
       taxRateBps, taxIncludedInPrice,
       deliveryFeeBaseCents?, deliveryFeePerKmCents?, deliveryFreeRadiusM?, deliveryMaxRadiusM?,
       externalProvider?[POSTER|IIKO], externalId?)
UserStore (userId, storeId)              // pivot: scope STAFF/RIDER/STORE_MANAGER на конкретные точки
StoreWorkingHour (storeId, weekday[0..6], opensAt, closesAt, isClosed)
StoreShift (storeId, openedAt, openedById?, closedAt?, closedById?)   // не больше одной открытой на точку (частичный уникальный индекс)
```

### 5.3. Catalog

```
Category (id, brandId, slug, name, sortOrder, availableFrom?, availableTo?, visible, addOnsOnly,
          kind[HOT_DRINKS|COLD_DRINKS|FOOD|BAKERY|OTHER], defaultPrepTimeSeconds?,
          externalProvider?, externalId?)
Product (id, brandId, categoryId, slug, name, basePriceCents, prepTimeSeconds,
         caffeineLevel?, calories?, P/F/C, allergens[], dietTags[VEGAN|GLUTEN_FREE|...],
         imageUrls[], visible, sortOrder, availableFrom?, availableTo?,
         externalProvider?, externalId?)
Variation (id, productId, type[SIZE|TEMP|MILK|CUP], name, priceDeltaCents,
           prepTimeDeltaSeconds, isDefault, ingredientId?)
Modifier (id, productId, slug, name, priceDeltaCents, prepTimeDeltaSeconds,
          minCount, maxCount, externalProvider?, externalId?, ingredientId?, group?)   -- group ≤ 40 символов, null = «Добавки»
Ingredient (id, brandId, name, priceCents, isAvailable, group?)   -- справочник «Добавки» бренда, (brandId, name) уникально
CategoryOption (id, categoryId, kind[VARIATION|MODIFIER], variationType?, name, priceDeltaCents,
                group?, isDefault, maxCount, sortOrder, ingredientId?)   -- набор опций категории (шаблон, не читается заказом)
ProductStore (productId, storeId)              -- точки, где товар продаётся; PK (productId, storeId)
StopListEntry (id, storeId, productId, reason?, expiresAt?)
StoreIngredientStop (storeId, ingredientId, expiresAt?)  -- добавка закончилась в одной точке; PK (storeId, ingredientId)
```

**Меню по точкам.** Товар есть в меню точки и заказывается в ней, только если для пары (товар, точка) есть строка `ProductStore`; без строк товар не продаётся нигде. Миграция `20261004000000_store_menu_availability` заполнила каждую пару «товар × точка его бренда», так что после выкатки ничего не пропало. Новый товар без `storeIds` получает все точки бренда (так же — импорт из POS); новая точка (кабинет или импорт из POS) получает все товары бренда. `GET /stores/:id/menu` отдаёт только товары точки и пропускает категории, где их нет; `GET /products/:idOrSlug?store=` отвечает 404 для товара, который эта точка не продаёт. Корзина отвечает 400 `ITEMS_UNAVAILABLE` (с названием) на товар не этой точки, оформление снимает такую строку (`CART_CHANGED`, `PRODUCT_UNAVAILABLE`).

**Справочник «Добавки» — единственный источник добавки.** Запись `Ingredient` хранит название добавки, её обычную цену (`priceCents`) и наличие. Добавки (modifiers) и молоко (MILK-варианты) товара — это ссылки на запись справочника: опцию можно создать по одному `ingredientId` (название и доплата берутся из справочника, введённая доплата важнее), а новая добавка или молоко, введённые по названию, привязываются к записи с тем же названием (создаётся при отсутствии — с доплатой, указанной для опции), `ingredientId: null` — не отслеживать. Новое название или цена записи (`PATCH /admin/ingredients/:id`) переносятся во все опции, где ещё стоят прежние название или цена; опция со своим названием или ценой в каком-то товаре их сохраняет. Удаление опции убирает добавку только из этого товара — запись остаётся в справочнике. Удаление записи (`DELETE /admin/ingredients/:id`) убирает её опции из всех товаров вместе со строками корзин, где они выбраны (корзины пересчитываются, оформленные заказы не меняются). Миграция `20261010120000_ingredient_price` заполнила `priceCents` самой частой доплатой опций каждой записи. Пока `isAvailable = false`, все опции с этой добавкой скрыты во всех клиентах (`GET /products/:idOrSlug`), корзина их не принимает, а строка корзины с ней снимается при оформлении (`CART_CHANGED`, `OPTION_UNAVAILABLE`); сам товар остаётся в меню. Если скрыт вариант по умолчанию, по умолчанию выбирается первый оставшийся того же типа. Кроме общего для бренда `isAvailable` точка может остановить добавку у себя (`StoreIngredientStop`, с `expiresAt` или до отмены): её опции скрыты в `GET /products/:idOrSlug?store=` этой точки, а корзина и оформление этой точки их не принимают — с 400 `ITEMS_UNAVAILABLE` и названием опции при добавлении. Опции без привязки к справочнику (размер, температура, стакан или явно «не отслеживать») по точкам не останавливаются.

**Категории «только как добавка».** `Category.addOnsOnly = true` — товары категории не продаются отдельно (например, «Дополнительные ингредиенты», пришедшие из Poster как обычные товары). Такая категория остаётся в кабинете, стоп-листе и синхронизации с POS, но `GET /stores/:id/menu` её не отдаёт, `GET /products/:idOrSlug` отвечает 404 на её товары, `POST /cart/items` — 404, а оформление снимает уже лежащую в корзине строку (`CART_CHANGED`, `PRODUCT_UNAVAILABLE`). Так же теперь обрабатывается товар скрытой категории (`visible = false`). Синхронизация с POS пишет в категорию только название и порядок, поэтому флаг переживает повторный импорт. Дальше такую категорию можно превратить в источник справочника: связать её товары с записями `Ingredient` (например, `Ingredient.productId`), чтобы цена добавки и её стоп-лист шли из POS.

**Вид категории.** `Category.kind` — что лежит в категории: `HOT_DRINKS`, `COLD_DRINKS`, `FOOD`, `BAKERY` или `OTHER` (по умолчанию). Миграция `20261011120000_category_kind_option_presets` проставила вид существующим категориям по названию — те же начала слов на русском и английском и тот же порядок (еда → холодные напитки → горячие → выпечка, первое совпадение), что и `inferCategoryKind` в `libs/utils` (тест в API сверяет регулярки миграции с утилитой). Кабинет предлагает вид новой категории по названию, `POST /admin/categories` без `kind` ставит его так же; синхронизация с POS задаёт вид только новой категории и никогда не перезаписывает его, как и `defaultPrepTimeSeconds`. От вида зависят только кабинет (поля товара: кофеин и «без кофеина»/«без сахара» — напиткам, «вегетарианское»/«без глютена» — еде, чек-лист аллергенов — всем; варианты MILK/TEMPERATURE/CUP — только напиткам; у товара, перенесённого в категорию другого вида, скрытые поля сохраняются, кабинет предлагает их очистить) и клиентские заглушки — меню, корзина и цены от него не зависят. Аллергены чек-листа хранятся кодами (`GLUTEN`, `MILK`, `LACTOSE`, … — `ALLERGEN_CODES` в `libs/utils`, названия — `common.allergens` в i18n; приложение знает те же коды) в том же `Product.allergens`, рядом со свободным текстом, который был до чек-листа и сохраняется как есть; клиенты печатают код на языке покупателя (`allergenChips`), текст — как есть.

**Время приготовления по умолчанию.** `Category.defaultPrepTimeSeconds` — с каким `prepTimeSeconds` создаётся новый товар категории (кабинет подставляет его в форму; `POST /admin/products` без `prepTimeSeconds` берёт его на сервере). `POST /admin/categories/:id/prep-time/apply` ставит его всем товарам категории. Базовое время точки (`Store.baseEtaSeconds`) — только пробить, упаковать и выдать; готовка считается по товарам.

**Набор опций категории.** `CategoryOption` — варианты и добавки, которые должны быть у товаров категории («Молоко: Овсяное +10», «Сиропы: Ваниль +5»). Набор — шаблон, заказ его не читает: корзина, оформление, цены и стоп-лист работают со строками `Variation`/`Modifier` каждого товара, как раньше. Поэтому набор не наследуется при чтении, а копируется: новый товар категории получает копию при создании (`applyCategoryOptions: false` — без неё), а `POST /admin/categories/:id/options/apply` добавляет каждому товару категории то, чего у него нет. Копирование ничего не удаляет и не меняет — ни цену, ни название, ни вариант по умолчанию; повторный запуск ничего не добавляет. Добавка или молоко совпадают по записи справочника (или по названию без учёта регистра, если связи нет); размер, температура и стакан копируются целой группой и только в товар, где такой группы ещё нет (у товара может быть своя шкала «0,3 / 0,4 л»). Применения к одной категории идут по очереди (advisory lock), гонка за слаг добавки повторяется. Опции набора ссылаются на справочник «Добавки» так же, как опции товара: при сохранении набора недостающие записи создаются с указанной ценой и группой, переименование, новая цена и новая группа записи переносятся и в наборы, удаление записи убирает её и из наборов. Готовые наборы по видам (`OPTION_PRESETS` в `libs/shared-types/src/lib/option-presets/`, с README) — константы в коде: кабинет показывает предпросмотр, бизнес снимает лишнее, вводит цены (почти все цены пресета — 0, валюты у брендов разные; добавка из справочника приходит со своей ценой) и сохраняет; редактора пресетов для SUPER_ADMIN в v1 нет.

**Группы добавок.** `Modifier.group` — подпись группы на экране товара; `null` — общая группа «Добавки». `Ingredient.group` — группа, в которую попадает добавка, выбранная из справочника («Ваниль» → «Сиропы»); новая группа записи переносится в добавки товаров и наборов, где ещё стоит прежняя. `GET /admin/ingredients/groups?brandId=` — все группы бренда для подсказок.

### 5.4. Cart / Order / Payment

```
Cart (id, userId, storeId, subtotalCents, etaSeconds)             // unique(userId, storeId)
CartItem (id, cartId, productId, quantity, variationIds[], modifiersJson, unitPriceCents,
          unitPrepSeconds, notes?)
Order (id, userId, storeId, status[CREATED|PAID|ACCEPTED|IN_PROGRESS|READY|PICKED_UP|
         OUT_FOR_DELIVERY|DELIVERED|CANCELLED|EXPIRED|REFUNDED],
       fulfillmentType[PICKUP|DINE_IN|DELIVERY], pickupMode[ASAP|SCHEDULED], pickupAt,
       subtotalCents, discountCents, taxCents, totalCents, currency,
       orderCode (4-digit unique), qrToken (opaque),
       paymentIntentId?, prepSeconds, workSeconds,                  // см. 3.4 — разные числа
       customerName?, customerPhone?, notes?,
       couponCode?, giftCardCode?, giftCardCents, pointsSpent, pointsDiscountCents,
       deliveryAddress*?, deliveryLat?, deliveryLng?, deliveryFeeCents, deliveryDistanceM?,
       riderId?,                                                   // FK → User (RIDER)
       posExternalId?,                                             // iiko/Poster order id
       acceptedAt?, startedAt?, readyAt?, pickedUpAt?,
       outForDeliveryAt?, deliveredAt?, cancelledAt?, expiredAt?)
OrderItem (id, orderId, productSnapshot (json), quantity, unitPriceCents, totalCents)
// productSnapshot: { id, slug, name, variationIds[], modifiers{id: count}, notes?, unitPrepSeconds,
//                    variations: [{ id, type, name, priceDeltaCents }]  (размер → молоко → температура → стакан),
//                    modifierLines: [{ id, name, count, priceCents }] }  — это видят KDS, админка, чеки и клиент
OrderEvent (id, orderId, type[STATUS_CHANGED|GEOFENCE_NEAR|GEOFENCE_HERE|RIDER_ASSIGNED|...],
            actorId?, payload?, createdAt)
Payment (id, orderId, provider[STRIPE|TELEGRAM_PAY|...], providerRef?,
         status[PENDING|REQUIRES_ACTION|PAID|FAILED|REFUNDED], amountCents, refundedCents,
         currency, rawJson?)
```

### 5.5. Loyalty / Promo / Gift cards / Campaigns

```
LoyaltyAccount (id, userId unique, pointsBalance, lifetimePoints, tier[SILVER|GOLD|PLATINUM])
PointsLedger (id, loyaltyAccountId, userId, orderId?, type[EARN|SPEND|EXPIRE|ADJUST],
              amount (signed), reason, metadata?)
Promo (id, brandId, code, label, type[PERCENT|FIXED|BOGO|POINTS_MULTIPLIER],
       value, minSubtotalCents?, maxRedemptions, perUserLimit, startsAt, endsAt,
       status[DRAFT|SCHEDULED|RUNNING|PAUSED|EXPIRED],
       inactiveDays?, segmentStoreId?)   // код только для неактивных клиентов
PromoRedemption (id, promoId, userId, orderId unique, discountCents)
GiftCard (id, code unique, brandId, initialAmountCents, balanceCents, currency,
          status[ACTIVE|REDEEMED|EXPIRED|CANCELLED], purchaserUserId?, recipientEmail?,
          expiresAt?)
GiftCardRedemption (id, giftCardId, orderId unique, amountCents)
Campaign (id, brandId, title, body, channel[PUSH|TELEGRAM|EMAIL],
          audience[ALL|HAS_ORDERED|INACTIVE_30D|INACTIVE], inactiveDays?, segmentStoreId?,
          status[DRAFT|PENDING_REVIEW|APPROVED|REJECTED|SENDING|SENT|FAILED],
          targetCount, sentCount, failedCount, noChannelCount, optedOutCount,
          lastError?, scheduledAt? (не раньше), createdById? [SET NULL],
          submittedAt?, reviewedAt?, reviewedById? [SET NULL], reviewNote? (причина отказа),
          approvedAt? (без него прогон не стартует), startedAt?, sentAt?)
CampaignDelivery (id, campaignId, userId, outcome[SENT|FAILED|NO_CHANNEL|OPTED_OUT],
                  via? ("apns,fcm,webpush" | "telegram" | "email"),
                  error?)   // также у SENT: что не сработало по дороге (app push перед Telegram)
  unique (campaignId, userId) — повтор рассылки пропускает уже доставленных
```

### 5.5a. Settlements (расчёты с брендами)

```
BrandCommissionRate (id, brandId, bps, source[PLAN|INDIVIDUAL], effectiveFrom, note?, createdById?, createdAt)
  unique (brandId, effectiveFrom); строка действует до effectiveFrom следующей (интервалы без дыр и наложений),
  первая — и до себя; Brand.commissionBps = строка, действующая сейчас; миграция завела каждому бренду текущую ставку с его создания
BrandPayout (id, brandId, currency, periodFrom DATE, periodTo DATE, timeZone, periodEnd (момент конца periodTo),
             amountCents (> 0), cardNetCents, commissionCents (цифры периода на момент фиксации),
             status[PENDING|PAID], paidAt?, reference?, comment?, createdById?, paidById?)
  periods идут подряд без наложений; Brand → payouts ON DELETE RESTRICT
```

### 5.6. Analytics (materialized views)

```
mv_orders_daily (brandId, storeId, day, orderCount, revenueCents,
                 slaHits, slaTotal, pickupSecSum, pickupSecCount)
  unique (brandId, storeId, day)
  refreshed every 5 min via REFRESH MATERIALIZED VIEW CONCURRENTLY
```

Источник: `Order` join `Store` для заказов кроме `CANCELLED` и `EXPIRED`, агрегация по UTC-дню; `revenueCents` — выручка (см. ниже), с миграции `20261010120000_analytics_revenue_basis`. SLA-hit считается при readyAt − coalesce(acceptedAt, createdAt) ≤ 7 минут. Pickup-длительность — readyAt → pickedUpAt. Питает только `/admin/analytics/brands` (платформа; точки в валюте, отличной от валюты бренда, не суммируются); аналитика бренда считается по `Order` в его часовом поясе.

**Деньги — одно определение на всех экранах** (`apps/api/src/app/analytics/money.ts`, SQL-двойники `SALES`/`DISCOUNTS`/`REVENUE`/`GIFT_CARDS` в `analytics-sql.ts`): **продажи** = `subtotalCents` (позиции по ценам меню); **скидки** = `min(discountCents, subtotalCents)` (промокоды + баллы — их даёт бизнес); **выручка** = `max(subtotalCents − discountCents, 0)` — независимо от того, оплачено картой или подарочной картой; **подарочные карты** = `min(giftCardCents, выручка)` — часть выручки. `totalCents` (списание с карты) выручкой не является: в нём нет оплаченного подарочной картой, зато есть доставка и налог сверху цены. Подарочные карты выпускаются в админке и продаются (если продаются) вне takeAway, поэтому продажа карты нигде не считается, а покупка по ней — один раз, в выручке. Топ позиций — на той же базе: скидка заказа раскладывается по позициям пропорционально цене, сумма по позиции округляется вниз, поэтому Σ позиций ≤ выручки; `salesCents` — та же позиция до скидок. Клиенты: новые — первый засчитанный заказ в скоупе попал в период; постоянные — заказывали в скоупе и раньше (`returningCustomers = customers − newCustomers`); `cohort.repeatRatePercent` — другая метрика: доля клиентов с ≥ 2 заказами внутри периода. Изменение к прошлому периоду — `null`, если прошлый период без выручки (экран пишет «новое за период»).

**Валюта.** Деньги в разных валютах не складываются: если точки бренда в нескольких валютах, все эндпоинты аналитики и `/admin/customers` сужаются до точек одной (`currency` в запросе; выбранная точка — её валюта; по умолчанию `defaultCurrency()` из `libs/utils`: валюта бренда, если она есть у точек, иначе валюта большинства точек). `revenue` и `overview` возвращают `currency` и `currencies[]`, строки `stores` — `currency`. Платформа (`/admin/platform/overview`) берёт только точки в валюте бренда.

**Фильтр по точке.** `storeId` сужает цифры до точки, но дни считаются в поясе всего видимого скоупа (`parent`), а не в поясе точки — строка, по которой кликнули, и итоги после клика совпадают. В `overview` с `storeId` итоги берутся из строки этой точки, а `byStore` по-прежнему перечисляет все точки скоупа. Точка на UTC-заглушке считается в преобладающем поясе бренда.

**Дашборды (`overview`).** Пять сгруппированных запросов по `Order ⋈ Store ⋈ Brand` идут параллельно, без выборки заказов по одному: (1) итоги текущего и прошлого отрезка по точке/бренду и по всему скоупу (`GROUPING SETS`, чтобы клиенты считались уникальными по скоупу, а не суммой по точкам); (2) дни текущего отрезка в поясе скоупа; (3) первые засчитанные заказы клиентов в скоупе (новый клиент — первый заказ в этом бизнесе/на платформе попал в отрезок); (4) загрузка по часу и дню недели (ISO, Пн = 1) в поясе каждой точки — точка на UTC-заглушке берёт пояс отрезка; (5) статусы заказов отрезка. Правила как во всей аналитике: выручка, заказы и клиенты — без `CANCELLED`/`EXPIRED`; `placed` — все заказы; доля отмен = (отменённые + истекшие) / placed. Итоги несут `salesCents`, `discountCents`, `revenueCents`, `giftCardCents` и `returningCustomers`. Мгновения передаются как `timestamp` (`utc()`), чтобы TimeZone сессии Postgres ничего не сдвигал. Комиссия = Σ (выручка − оплачено подарочными картами) × текущий `commissionBps` бренда / 10 000 — оценка по текущей ставке; точные суммы с историей ставок и возвратами — в «Расчётах с брендами». Проверка SQL на настоящем Postgres — `analytics.db.spec.ts`, запускается только с `ANALYTICS_IT_DATABASE_URL` (одноразовая база с применёнными миграциями).

### 5.7. POS integrations

```
PosIntegration (id, brandId, provider[POSTER|IIKO], credentialsCiphertext (AES-256-GCM),
                status[DISCONNECTED|CONNECTED|ERROR], settings (json),
                lastSyncAt?, lastErrorMessage?)             // unique(brandId, provider)
PosSyncJob (id, integrationId, kind[STORES|MENU|STOP_LIST|ORDER_PUSH|WEBHOOK],
            status[PENDING|RUNNING|SUCCESS|FAILED], progress, total, errorMessage?,
            startedAt?, finishedAt?)
```

External-id pattern: `Store`, `Category`, `Product`, `Modifier` хранят `externalProvider + externalId` для двусторонней связи с iiko/Poster.

## 6. API Contract (основные endpoints)

> Источник истины — контроллеры в `apps/api/src/app/**/*.controller.ts`. OTP-вход в исходном ТЗ заявлен, но в текущей реализации customer заходит через Google, Apple или Telegram (widget на web, initData в TMA), а staff/RIDER — через email + password (с force-rotate при инвайте).

### 6.1. Auth & Identity

```
POST   /auth/password/login          { email, password } → tokens
POST   /auth/kds/pin                  { storeId, pin, deviceToken } → tokens + kdsStoreId
                                     //   (KDS lockscreen, STAFF/STORE_MANAGER, 4–6 digits; только с привязанного планшета:
                                     //   401 KDS_DEVICE_REQUIRED | KDS_DEVICE_UNKNOWN; 429 KDS_PIN_LOCKED { retryAfterSeconds });
                                     //   сессия ограничена кухней точки (claim `kds`)
POST   /auth/kds/device               { storeId } → { deviceToken, brandId, brandName }   (auth: STAFF+, точка в скоупе)
POST   /auth/kds/device/pair          { code } → то же   (одноразовая ссылка со страницы «Сотрудники»; 401 KDS_PAIRING_INVALID)
GET    /auth/kds/device               [X-Kitchen-Device] → { brandId, brandName, stores[{id,name,city}] }
                                     //   точки бренда, где есть действующий PIN; 401 KDS_DEVICE_UNKNOWN
POST   /auth/password/forgot         { email }   → 204; 503 PASSWORD_RESET_UNAVAILABLE, если нет SMTP_HOST или (в проде) ADMIN_APP_URL
POST   /auth/password/reset          { token, password }
POST   /auth/password/change         { currentPassword, newPassword, refreshToken? }    (auth; отзывает все сессии, кроме refreshToken)
POST   /auth/google                  { idToken } → tokens              (Google Identity Services credential)
POST   /auth/apple                   { idToken, name? } → tokens       (name — только при первом согласии)
GET    /auth/me/sign-in-methods      → { telegram, google, apple }
POST   /auth/me/sign-in-methods/google|apple|telegram  { idToken, name? } → { methods, session? }  (session — если клиент перешёл в профиль с заказами)
DELETE /auth/me/sign-in-methods/google|apple  → { telegram, google, apple }
POST   /auth/telegram                { initData } → tokens           (TMA)
POST   /auth/telegram/widget         { ...telegramAuthWidgetPayload } → tokens   (legacy Login Widget, HMAC)
POST   /auth/telegram/oidc           { idToken } → tokens            (Telegram Login, OpenID Connect)
GET    /auth/telegram/config         → { botId, botUsername, clientId }  (public)
POST   /auth/telegram/link           { ...widgetPayload }            (auth, привязка TG к существующему юзеру)
POST   /auth/telegram/link/oidc      { idToken }                     (auth, то же через Telegram Login)
POST   /auth/refresh                 { refreshToken }
POST   /auth/logout
GET    /auth/me
DELETE /auth/me                      { appleAuthorizationCode? } → 204   (удаление аккаунта; только CUSTOMER, staff и владелец бренда → 403)
```

`DELETE /auth/me` (App Store 5.1.1(v)) не удаляет строку `User`, а превращает её в обезличенную заглушку в одной транзакции: имя, email, телефон, аватар, дата рождения, `telegramUserId`, `passwordHash`, `referralCode` → null, notify-флаги → false, `blockedAt = now()`. Удаляются `OAuthAccount`, `Device`, `Cart`, `CardToken`, `CardBindingRequest`, `PasswordResetToken`; баланс `LoyaltyAccount` обнуляется записью `EXPIRE` в ledger. Заказы, платежи, ledger, промо-погашения, рефералы, подарочные карты и обратная связь (`Feedback`, у неё обнуляется только `contact`) остаются и ссылаются на ту же строку, но заказы — только в обезличенном виде: у всех заказов пользователя (и у ещё не выполненных тоже) обнуляются `customerName`, `customerPhone`, адрес доставки (`deliveryAddressLine`, `deliveryCity`), `deliveryNotes`, `deliveryLatitude`/`deliveryLongitude`; позиции с опциями и комментариями, комментарий к заказу, суммы, статусы, точка, время, стоимость доставки и расстояние сохраняются. У событий прихода клиента (`CUSTOMER_NEARBY` / `CUSTOMER_HERE`) из payload удаляются координаты, тип и `distanceM` остаются. Координаты клиента не отдаёт и `GET /admin/orders/:id`: в событиях заказа админ видит только расстояние. Все refresh-токены пользователя удаляются из Redis, ротация и WebSocket-рукопожатие отказывают заблокированному аккаунту. Повторный вход тем же Telegram / Google / Apple создаёт новый пустой профиль. Тело необязательное: iOS-приложение перед удалением заново проходит Sign in with Apple и присылает свежий `appleAuthorizationCode` — до транзакции (и только после проверки прав) API меняет его на токены в `appleid.apple.com/auth/token` и отзывает refresh-токен (или access) через `/auth/revoke`. `client_secret` — ES256 JWT, подписанный ключом Sign in with Apple (`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`), client id — `APPLE_REVOKE_CLIENT_ID` или первый из `APPLE_OAUTH_CLIENT_IDS`, не равный `APPLE_OAUTH_SERVICES_ID`. Отзыв best-effort: сбой Apple или отсутствие ключа логируются и удаление не блокируют. Логика и решения по каждой связи — `AccountDeletionService`, отзыв Apple — `AppleTokenRevocationService`.

### 6.2. Профиль и уведомления

```
GET    /me
PATCH  /me
GET    /me/notifications             (notify-prefs)
PATCH  /me/notifications             { notifyOrderUpdates?, notifyPromotions? }
GET    /me/orders
POST   /me/orders/:id/resend-receipt   → { ok: true }       (PAID-and-later only)
GET    /me/gift-cards
GET    /me/referrals                 → { code, stats }
POST   /me/referrals/apply           { code }
POST   /feedback                     { kind: REVIEW|SUGGESTION|PROBLEM, message (1–2000), contact? (≤200),
                                       source: IOS|ANDROID|WEB|TMA, appVersion? } → 201 { id, createdAt }
                                     // любой вошедший аккаунт; 429 FEEDBACK_TOO_MANY — больше 5 за час на аккаунт
                                     // типы и источники — только клиентские (QUESTION / PLAN_CHANGE / BUSINESS — 400)
POST   /feedback/support             { kind: QUESTION|PROBLEM|SUGGESTION, message (1–2000), name? (≤80), contact? (≤200),
                                       website? } → 204
                                     // форма «Поддержка» на сайте; публичный, токен необязателен (@OptionalAuth: без токена —
                                     //   гость, с токеном — аккаунт, плохой токен — 401). Гостю contact обязателен
                                     //   (400 SUPPORT_CONTACT_REQUIRED), contact — email или телефон (400 SUPPORT_CONTACT_INVALID),
                                     //   хранится как email в нижнем регистре или E.164. Антиспам: website — honeypot (ответ тот же,
                                     //   ничего не сохраняется), 3/час на адрес клиента (вошедший — на аккаунт), 3/час на контакт
                                     //   и 5/час на аккаунт (429 FEEDBACK_TOO_MANY). Источник WEB, алерт — как у отзывов
POST   /admin/support[?brandId=]     { kind: QUESTION|PROBLEM|SUGGESTION, message (1–2000) } → 201 { id, createdAt }
                                     // BRAND_ADMIN / STORE_MANAGER / MENU_EDITOR / STAFF; бренд — свой (чужой 403); тот же лимит
                                     //   (плюс 5/мин на IP); платформа узнаёт в Telegram, см. 3.8
```

### 6.3. Catalog

```
GET    /stores?lat=&lng=&radius=&kind=  // включает currentEtaSeconds (+ BUSY_EXTRA_WAIT_SECONDS у «Загруженной»), busyMeter, acceptingOrders (открыта смена), openNow, timezone, brandName,
                                     //   heroImageUrl (фото точки), logoUrl (логотип бренда — показывать, когда фото нет),
                                     //   kinds: ['COFFEE'|'FOOD'] (никогда не пусто); ?kind=FOOD|COFFEE — только такие точки (COFFEE включает точки без kinds)
GET    /stores/:idOrSlug             // openNow: примет ли точка ASAP-заказ сейчас (= acceptingOrders: статус не CLOSED и открыта смена); те же heroImageUrl, logoUrl, kinds + brand.logoUrl;
                                     //   brand.themeOverrides всегда null (цвета бренда отключены)
GET    /stores/:idOrSlug/menu        (категории + продукты + variations + modifiers + stop-list)
                                     //   категория несёт kind (HOT_DRINKS|COLD_DRINKS|FOOD|BAKERY|OTHER), товар — categoryKind
GET    /products/:idOrSlug[?store=]  // включает brandId; ?store= (id или slug просматриваемой точки) ищет слаг внутри её бренда — слаги уникальны только в бренде;
                                     //   с ?store= — 404, если точка не продаёт товар, и без опций, добавка которых остановлена в этой точке;
                                     //   categoryKind товара, modifiers[].group (null = «Добавки»); allergens — коды чек-листа и/или свободный текст
GET    /stores/:idOrSlug/pickup-slots  → 15-минутные окна выдачи на 12 часов вперёд
```

### 6.4. Cart / Order / Payment

```
GET    /cart
POST   /cart/items                   { productId, quantity, variationIds[], modifiers{} } → { cart, etaSeconds }
                                     // не больше одной вариации каждого типа; неизвестный id — 400; тип без выбора — вариация по умолчанию
PATCH  /cart/items/:itemId
DELETE /cart/items/:itemId
DELETE /cart

POST   /orders                       { cartId, pickupMode, pickupAt?, couponCode?, giftCardCode?, fulfillmentType, deliveryAddress? } → { id, orderCode, qrToken, etaSeconds }
                                     // корзина пересчитывается по текущему меню; если цена или состав изменились —
                                     // 409 { code: CART_CHANGED, items: [{ cartItemId, productName, reason, previousUnitPriceCents, unitPriceCents }] }
                                     // и корзина уже обновлена; закрытая точка или неодобренный бренд — отказ;
                                     // ошибки оформления несут code (STORE_CLOSED_AT_TIME, PICKUP_SLOT_FULL, …),
                                     // проверка промокода — reasonCode; клиенты переводят их по коду
                                     // пустое имя в заказе заполняется именем из профиля покупателя
GET    /orders/:id                   // включает storeTimezone — время выдачи показывается по часам точки
POST   /orders/:id/cancel
POST   /orders/:id/location          { lat, lng }  // геофенсинг (триггер «I'm here» при попадании в радиус)

POST   /payments/intent              { orderId } → { clientSecret }          // Stripe, запасной путь
POST   /payments/webhook             (Stripe)

GET    /payments/agroprombank/institutes                     → [{ code, name }]
GET    /payments/agroprombank/cards                          → привязанные карты клиента
POST   /payments/agroprombank/cards/bind                     { lastDigits, phone, institute } → { bindingId, completed }
POST   /payments/agroprombank/cards/bind/:bindingId/confirm  { code } → карта
POST   /payments/agroprombank/cards/:cardId/default
POST   /payments/agroprombank/cards/:cardId/refresh
DELETE /payments/agroprombank/cards/:cardId
POST   /payments/agroprombank/pay                            { orderId, cardId, tipCents? } → списание или бронь, по политике мерчанта
POST   /payments/agroprombank-web/start                      { orderId, returnTo: web|tma|mobile } → { paymentId, invoiceId, status, page: { method, action, fields, url } | null, expiresAt }
GET|POST /payments/agroprombank-web/result                   (public) ResultURL банка: MD5-проверка → GetState → 200 OK
GET|POST /payments/agroprombank-web/success|fail             (public) SuccessURL/FailURL: сверка с банком → 302 на заказ в web / TMA / takeaway://pay
```

### 6.5. Promo / Gift cards / Loyalty

```
POST   /promo/validate               { code, cartId }
POST   /promo/preview                { code, cartId } → { discountCents, finalTotalCents }
POST   /gift-cards/validate          { code, cartId } → { balanceCents, applicableCents }
GET    /loyalty                      → { balance, tier, lifetimePoints, recentEntries[] }
```

### 6.6. Devices (web push + мобильные)

```
GET    /devices/vapid-public-key
POST   /devices                      { type, pushToken, apnsToken?, apnsEnvironment?, locale }
                                     (type: WEB | IOS | ANDROID; для IOS/ANDROID pushToken — FCM-токен;
                                      apnsToken — сырой APNs-токен iOS, hex; apnsEnvironment — PRODUCTION | SANDBOX,
                                      по умолчанию PRODUCTION; WEB вместо pushToken шлёт endpoint + keys)
DELETE /devices                      { type, pushToken }
```

### 6.7. Delivery (riders + dispatch)

```
POST   /delivery/quote               { storeId, lat, lng } → { feeCents, distanceM, etaSeconds }
GET    /delivery/queue               (STORE_MANAGER / SUPER) — заказы для назначения
GET    /delivery/riders              (managerial)
POST   /delivery/orders/:id/assign   { riderId }
GET    /delivery/my                  (RIDER) — мои заказы
POST   /delivery/orders/:id/self-assign       (RIDER)
PATCH  /delivery/orders/:id/status   { status }   // OUT_FOR_DELIVERY → DELIVERED
```

### 6.8. Brand owner / Business signup

```
POST   /business/register            { brand, contact, currency, locale, phone } → { brand: { moderationStatus: PENDING } }
                                     // phone обязателен, нормализуется в E.164 → Brand.contactPhone
GET    /my-brand[?brandId=]          (BRAND_ADMIN → свой бренд; SUPER_ADMIN → бренд из brandId)
PATCH  /my-brand[?brandId=]          (название, логотип, цвета, язык, contactPhone; валюта — до первого заказа, иначе 409 CURRENCY_LOCKED)
POST   /my-brand/logo[?brandId=]     (multipart → S3/MinIO; JPG/PNG/WebP до 2 МБ, 413 IMAGE_TOO_LARGE / 415 IMAGE_TYPE)
GET    /my-brand/onboarding[?brandId=]  → чек-лист запуска бренда
POST   /my-brand/resubmit[?brandId=]    REJECTED → PENDING, уведомляет платформу
POST   /my-brand/plan-request[?brandId=] { plan, note? } → { requestedPlan, planRequestedAt }   // BRAND_ADMIN; 409 PLAN_ALREADY_ACTIVE
```

`brandId` у SUPER_ADMIN — бренд, выбранный переключателем в админке (без параметра — единственный
бренд установки). У BRAND_ADMIN параметр проверяется на владение (чужой — 403), без параметра —
самый старый бренд владельца; админка всегда шлёт бренд из переключателя.

### 6.9. Admin (JWT + RBAC: SUPER_ADMIN / BRAND_ADMIN / STORE_MANAGER)

```
# Каталог (scope to brand для BRAND_ADMIN)
GET/POST/PATCH                       /admin/brands[, /:id, /:id/moderation]   // REJECTED требует note
GET                                  /admin/brands/pending-count              // бейдж «Бренды» у SUPER_ADMIN
PATCH                                /admin/brands/:id/plan                   // SUPER_ADMIN: { plan, commissionBps? } — без ставки берётся ставка тарифа
#   POST /admin/brands (SUPER_ADMIN) создаёт бренд сразу APPROVED — модератор здесь
#   сам автор; это единственный способ завести первый бренд на свежей установке.
GET/POST/PATCH/DELETE  /admin/categories[/:id]      + PATCH /admin/categories/reorder, DELETE ?moveProductsTo=
                                                    + kind, defaultPrepTimeSeconds в create/update (create без kind — по названию); список несёт _count.options
GET/POST               /admin/categories/:id/options        набор опций категории; POST { options: [{ kind: VARIATION|MODIFIER, variationType?, name? | ingredientId?,
                                                    priceDeltaCents?, group?, isDefault?, maxCount? }] } дописывает недостающее (повтор ничего не добавляет), отвечает всем набором
PATCH/DELETE           /admin/categories/:id/options/:optionId   { name?, priceDeltaCents?, group?, isDefault?, maxCount?, sortOrder? }; DELETE — только из набора
POST                   /admin/categories/:id/options/apply  → { total, products, variations, modifiers }: недостающее из набора во все товары категории
POST                   /admin/categories/:id/prep-time/apply → { products }: defaultPrepTimeSeconds всем товарам категории
GET/POST/PATCH/DELETE  /admin/products[/:id]        + PATCH /admin/products/:id/visibility, PATCH /admin/products/reorder
                                                    + storeIds[] в create/update (create без него — все точки бренда; update — заменяет список;
                                                      400 STORE_UNKNOWN для чужой точки), ответы несут storeIds, GET ?storeId= — товары точки
GET                    /admin/products/stores?brandId=   точки бренда для выбора в форме товара (доступно MENU_EDITOR)
                                                    + POST/DELETE /admin/products/:id/images, PUT /admin/products/:id/images/order
                                                    + POST/PATCH/DELETE /admin/products/:id/variations[/...]
                                                    + POST/PATCH/DELETE /admin/products/:id/modifiers[/...]
GET/POST/PATCH/DELETE  /admin/ingredients[/:id]     справочник «Добавки» (GET ?brandId=, ответы несут priceCents, group и products[]); POST/PATCH { name, priceCents?, isAvailable?, group? },
                                                    PATCH { isAvailable } — «закончилось/появилось», новое name/priceCents переносится в опции с прежними значениями;
                                                    DELETE убирает добавку из всех товаров
#   POST /admin/products/:id/modifiers и /variations принимают { ingredientId } без name/priceDeltaCents — берутся из справочника
#   /admin/categories: create/update принимают addOnsOnly (категория «только как добавка»)
#   POST /admin/products: applyCategoryOptions (по умолчанию true) — копия набора категории и её время приготовления, если prepTimeSeconds не передан
#   POST/PATCH /admin/products/:id/modifiers: group (≤ 40, null = «Добавки»; при создании без group — группа записи справочника)
#   POST /admin/products/:id/images: PRODUCT_PHOTO_RULE (JPEG/PNG/WebP/AVIF до 5 МБ; рекомендуем 1:1 от 1200×1200 или 3:4)
GET                    /admin/ingredients/groups?brandId=   группы добавок бренда (справочник, товары, наборы) для подсказок
GET/POST/PATCH/DELETE  /admin/stores[/:id]            // ответы несут readiness; 409 STORE_HAS_ORDERS / STORE_CURRENCY_LOCKED /
                                                    //   STORE_SLUG_TAKEN / STORE_NOT_READY
                                                    //   + kinds[] (COFFEE|FOOD, не пусто) в create/update
POST/DELETE            /admin/stores/:id/images?kind=hero|gallery   // JPG/PNG/WebP до 5 МБ; 413 IMAGE_TOO_LARGE, 415 IMAGE_TYPE
PUT                    /admin/stores/:id/working-hours
GET                    /admin/geocode?address=&city=&country=   // SUPER_ADMIN/BRAND_ADMIN/STORE_MANAGER: { result: { lat, lng, displayName, approximate } | null }
                                                    //   approximate = нашёлся только город (карта открывается там, метку не ставим);
                                                    //   503 GEOCODER_UNAVAILABLE — геокодер не ответил/занят. OSM Nominatim (GEOCODER_URL),
                                                    //   структурный поиск, затем город латиницей, затем один город; не чаще 1 запроса/с на всё
                                                    //   приложение (токен в Redis), кеш в Redis 14 дней (промах — 1 день), после 429/403 пауза 60 с,
                                                    //   User-Agent с контактом GEOCODER_CONTACT (или SUPPORT_EMAIL), accept-language=ru,en
GET                    /admin/geocode/reverse?lat=&lng=   // { result: { lat, lng, displayName, addressLine, city, country } | null }
GET/POST/DELETE        /admin/stores/:id/stop-list[/:productId]     // + STAFF своей точки; товар должен быть из бренда точки
GET                    /admin/stores/:id/availability                // стоп-лист точки: её товары и добавки с остановками (+ STAFF)
PUT/DELETE             /admin/stores/:id/ingredient-stops/:ingredientId   // { expiresAt? } — добавка закончилась в этой точке (+ STAFF)

# Staff (по людям; ?brandId= — активный бренд, без него вся досягаемость вызывающего)
GET    /admin/staff                  → [{ userId, email, phone, name, role, blocked, addedAt,
                                          stores: [{ id, name }], kdsPinStoreId, hasKdsPin, editable }]
GET    /admin/staff/:userId          → то же для одного (404 вне досягаемости)
POST   /admin/staff                  { email, name?, role, tempPassword (8–128), storeIds[≥1] }
                                     //   → 201 { ...StaffMember, inviteEmail: SENT|NOT_CONFIGURED|FAILED, accountCreated }
                                     //   Письмо-приглашение: кабинет, логин и для нового аккаунта одноразовая ссылка
                                     //   /reset-password?token=…&invite=1 (PasswordResetToken, 72 ч); временный пароль не пишется.
                                     //   Без SMTP / ADMIN_APP_URL — NOT_CONFIGURED, токен не создаётся.
                                     //   409 STAFF_ALREADY_ON_TEAM / STAFF_EMAIL_TAKEN (email занят не сотрудником
                                     //   или сотрудником, работающим и в другом бренде; без роли в ответе)
PUT    /admin/staff/:userId/stores   { storeIds[] } → замена в пределах досягаемости; [] — убрать из команды
PATCH  /admin/staff/:userId/role     { role: STORE_MANAGER | STAFF | MENU_EDITOR }
POST   /admin/staff/:userId/reset-password   → 200 { tempPassword, resetEmail: SENT|NOT_CONFIGURED|FAILED }
                                     //   только SUPER_ADMIN / BRAND_ADMIN; сгенерированный временный пароль (один раз в ответе),
                                     //   passwordMustChange, все refresh-сессии отозваны, прежние PasswordResetToken погашены,
                                     //   новая ссылка /reset-password?token=… (72 ч) письмом при SMTP; 403 STAFF_NOT_EDITABLE —
                                     //   свой аккаунт или сотрудник, работающий и в другом бренде; 404 — не в команде
                                     //   403 STAFF_STORE_OUT_OF_SCOPE / STAFF_ROLE_NOT_ALLOWED / STAFF_NOT_EDITABLE
                                     //   (роль, новые точки и PIN — только если все точки человека в брендах вызывающего)

# Планшеты кухни (?brandId= обязателен; SUPER_ADMIN / BRAND_ADMIN / STORE_MANAGER бренда, не PIN-сессия)
GET    /admin/kitchen-devices        → [{ id, createdAt, createdByName, lastUsedAt }]
POST   /admin/kitchen-devices/pairing-code → { code, expiresAt }   // ссылка /login/pin?pair=<code>, 24 ч, один раз
DELETE /admin/kitchen-devices/:id    → 204   // отвязать: токен перестаёт открывать экран PIN

# Staff / Riders (per-store scope)
GET/POST/DELETE        /admin/stores/:storeId/staff[/:userId]
PUT/DELETE             /admin/stores/:storeId/staff/:userId/kds-pin   { pin }   // новый PIN — ровно 6 цифр, не 111111/123456
GET/POST/DELETE        /admin/stores/:storeId/riders[/:userId]   // POST: 409 RIDER_PHONE_TAKEN — номер у другого аккаунта

# Orders / Promo / Gift cards / Campaigns
GET    /admin/orders/:id             → состав, платежи, возвраты, лента событий (scope как у списка; 404 вне scope)
GET                    /admin/orders                     (фильтрация по store/brand/status)
POST                   /admin/orders/:id/refund          { amountCents?, reason?, note? } → Stripe refund (full/partial)
GET/POST               /admin/promo                      // PRO (promo); статус в ответе — «по факту»
GET/PATCH              /admin/promo/:id                  // PRO: правка черновика / запланированного или на паузе без использований
PATCH                  /admin/promo/:id/status           // { status: RUNNING|PAUSED|EXPIRED } — черновик → активен → пауза → завершён
GET/POST/DELETE        /admin/gift-cards[/:id]
GET/POST               /admin/campaigns                  ?brandId= (SUPER_ADMIN — обязательно) // PRO (campaigns) — весь контроллер
GET                    /admin/campaigns/preview          ?brandId=&audience=&channel=[&inactiveDays=3|7|14&storeId=] → охват по каналам + настроенные транспорты
POST                   /admin/campaigns/test             { title, body, channel } → { outcome, via[], error? } — только себе
GET/PATCH              /admin/campaigns/:id              // PATCH — только DRAFT / REJECTED (409 CAMPAIGN_NOT_EDITABLE); scheduledAt: null — сразу после одобрения
POST                   /admin/campaigns/:id/submit       → PENDING_REVIEW (+ ops-алерт); от SUPER_ADMIN — сразу APPROVED и старт
POST                   /admin/campaigns/:id/withdraw     → PENDING_REVIEW → DRAFT («Отозвать в черновик»); иначе 409 CAMPAIGN_NOT_PENDING
POST                   /admin/campaigns/:id/send         → «Повторить» одобренную: FAILED / зависшая / SENT с ошибками; неодобренная — 409 CAMPAIGN_NOT_SENDABLE
DELETE                 /admin/campaigns/:id              (DRAFT / PENDING_REVIEW / REJECTED / APPROVED; иначе 409 CAMPAIGN_NOT_DELETABLE)
# Модерация рассылок (только SUPER_ADMIN, без проверки тарифа)
GET                    /admin/campaign-moderation?view=PENDING_REVIEW|APPROVED|REJECTED   // очередь (старые сверху, с охватом reach) или последние 50 решений
GET                    /admin/campaign-moderation/pending-count   // { count } — бейдж «Модерация рассылок»
POST                   /admin/campaign-moderation/:id/approve     // PENDING_REVIEW → APPROVED, старт сразу или в scheduledAt
POST                   /admin/campaign-moderation/:id/reject      { reason } → REJECTED; 409 CAMPAIGN_NOT_PENDING, если решение уже принято

# Аналитика (всё скоупится на бренды пользователя; ?brandId= — бренд из переключателя)
# Период у всех: ?from=YYYY-MM-DD&to=YYYY-MM-DD (дни в поясе бренда/точки) или ?days=N; ?storeId= — одна точка
GET                    /admin/analytics/overview           // дашборд бизнеса одним запросом: period, currency, currencies[], current/previous (продажи, скидки, выручка, из неё подарочными картами, заказы, placed, клиенты, новые, постоянные, чек, отмены, истекшие, доля отмен, выдача, точек с заказами, комиссия), daily[], statuses{}, byStore[] (все точки скоупа, и при storeId тоже: выручка/заказы/доли; PRO storeComparison: + previous*, Δ, чек, клиенты, отмены, выдача), byHour[24]/byWeekday[7] (PRO deepAnalytics, иначе null; час — по поясу каждой точки). Все эндпоинты аналитики принимают currency=
GET                    /admin/platform/overview?currency=  // SUPER_ADMIN: тот же формат по брендам одной валюты (byBrand[]: + тариф, commissionBps, commissionCents, точки, модерация); currencies[] — все валюты, по умолчанию та, где выручка больше; дни — в преобладающем поясе точек этих брендов
GET                    /admin/analytics/summary            // выручка, заказы, средний чек, время выдачи + изменения к предыдущему отрезку
GET                    /admin/analytics/order-statuses     // открытые заказы по статусам сейчас + итог заказов периода (выданы / отменены / истекли)
GET                    /admin/analytics/brands?days=       // SUPER_ADMIN: все бренды рядом (тариф, комиссия, точки, заказы, выручка) — «Весь проект»
GET                    /admin/analytics/revenue            // по дням периода + salesCents, discountCents, giftCardCents, currency, currencies[]; revenueDeltaPercent = null без выручки в прошлом периоде
GET                    /admin/analytics/top-products?take= // PRO (deepAnalytics): revenueCents после скидок (Σ ≤ выручки), salesCents до скидок
GET                    /admin/analytics/cohort             // PRO (deepAnalytics): customers, newCustomers, returningCustomers, repeatRatePercent (≥ 2 заказов в периоде), avgBasketCents, pickupSlaPercent
GET                    /admin/analytics/stores             // все точки скоупа; BASIC: выручка/заказы/доля, PRO: + доли заказов, чек, выдача, готовка, отмены, сотрудники, дельта (detailed=true)
GET                    /admin/analytics/staff              // PRO: по сотруднику — принял/приготовил/выдал/заказов, смены и часы (часы — тому, кто открыл смену)
GET                    /admin/analytics/churn?window=3|7|14&take=   // все: count, lostRevenueCents (сумма средних чеков), previous — только клиенты с 3+ заказами; PRO: customers[]
GET                    /admin/analytics/winback?window=3|7|14&take= // PRO: неактивные к началу периода → вернулись (кол-во, заказы, выручка, доля) против прошлого
GET                    /admin/customers?search=&segment=all|regular|inactive&inactiveDays=3|7|14&storeId=&sort=lastOrderAt|firstOrderAt|orders|totalCents|avgCheckCents|frequency&dir=&page=&pageSize=  // PRO; у клиента favouriteProduct (5+ шт.)
GET                    /admin/customers/:id                // PRO: итоги, точки, favourites[] (name, quantity, kind DRINK|FOOD|null), последние 100 заказов; 404 для удалённых и чужих

# Расчёты с брендами (SUPER_ADMIN — любой бренд, brandId обязателен; BRAND_ADMIN — только свои, чтение). См. docs/settlements.md
GET                    /admin/settlements?brandId=&currency=&from=&to=   // brand {plan, currentBps, planBps}, currency, currencies[], period, totals, days[] (все дни периода), rates[] (ставки периода), balance {opening, payable, paid, pending, closing, closingPending}, nextPayout {periodFrom, periodTo, amountCents, cardNetCents, commissionCents, blocked: PERIOD_OPEN|OVERLAP|NOTHING_DUE|null}, payouts[]
GET                    /admin/settlements/rates?brandId=   // история ставок: { plan, planBps, currentBps, timeZone, rates[{ bps, source, effectiveFrom, effectiveTo, note }] }
POST                   /admin/settlements/rates          { brandId, bps (0–5000) | null — ставка тарифа, effectiveFrom: YYYY-MM-DD (полночь в поясе бренда), note? }  // SUPER_ADMIN
DELETE                 /admin/settlements/rates/:id      // SUPER_ADMIN
POST                   /admin/settlements/payouts        { brandId, currency, to, reference?, comment? } → PENDING  // SUPER_ADMIN; 409 PAYOUT_PERIOD_OPEN / PAYOUT_OVERLAP / PAYOUT_NOTHING_DUE
PATCH                  /admin/settlements/payouts/:id/paid  { reference?, comment?, paidAt? } → PAID  // SUPER_ADMIN; 409 PAYOUT_ALREADY_PAID
DELETE                 /admin/settlements/payouts/:id    // SUPER_ADMIN, только последняя PENDING; 409 PAYOUT_PAID / PAYOUT_NOT_LATEST

# Обратная связь клиентов (только SUPER_ADMIN)
GET                    /admin/feedback?status=NEW|READ|ARCHIVED&kind=&source=&page=&pageSize=   // новые сверху; без status — всё, кроме ARCHIVED
                                                           //   → { items[{ …, author: { name, email, phone, telegramUserId, deleted } | null, brand: { id, name, contactPhone } | null }], total, page, pageSize, newCount }
GET                    /admin/feedback/new-count           // { count } — бейдж «Обратная связь»
PATCH                  /admin/feedback/:id                 { status } — readAt ставится при первом прочтении, сохраняется в архиве, NEW его сбрасывает

# POS
GET                    /admin/pos/status
POST                   /admin/pos/connect              { provider, credentials, settings }
DELETE                 /admin/pos/disconnect/:provider
POST                   /admin/pos/sync/stores/:provider
POST                   /admin/pos/sync/menu/:provider
POST                   /admin/pos/sync/stop-list/:provider
GET                    /admin/pos/jobs/:provider
```

### 6.10. KDS (экран баристы)

```
GET    /kds/orders                    // + customerArrival, customerArrivedAt
GET    /kds/shift?storeId=            → { open, openedAt, openedByName, closedAt, closedByName, busy }
POST   /kds/shift/open?storeId=       «Начать работу», идемпотентно
POST   /kds/shift/close?storeId=      «Закончить работу», идемпотентно; снимает «Загружены» (OVERLOADED → OPEN)
PUT    /kds/busy?storeId=             { busy } → смена с busy; Store.status OPEN ⇄ OVERLOADED, 409 STORE_SWITCHED_OFF у CLOSED
// Весь /kds/* доступен PIN-сессии только для её точки (KdsSessionGuard)
POST   /kds/orders/:id/accept
POST   /kds/orders/:id/reject         { reason: OUT_OF_STOCK|TOO_BUSY|CLOSING|OTHER, comment? } → отмена до принятия, бронь снимается / списанное возвращается, пуш клиенту с причиной
POST   /kds/orders/:id/start
POST   /kds/orders/:id/ready
POST   /kds/orders/:id/picked-up
```

### 6.11. POS webhooks (incoming)

```
POST   /pos/webhooks/poster                    (app-level webhook — multi-brand routing)
POST   /pos/webhooks/poster/:brandId           (legacy/per-brand webhook, переходный)
```

### 6.12. Health / Config

```
GET    /health                       // liveness: { status, commit (12 символов) }; version/commit/builtAt/uptime — с заголовком X-Health-Token (HEALTH_TOKEN)
GET    /health/ready                 → { ready, checks: { postgres, redis } }, 503 когда что-то лежит
GET    /config/features              → { deliveryEnabled, agroprombankEnabled, cardPaymentFlow: token|web|none, support: { email, telegram } }
```

### 6.13. WebSocket

```
WS     /ws                          (события: order.statusChanged, order.etaUpdated,
                                              order.customerNearby, order.riderAssigned,
                                              store.stopList, store.busyMeter,
                                              store.loadChanged, store.availabilityChanged,
                                              kds.orderChanged, kds.shiftChanged,
                                              dispatch.orderChanged,
                                              pos.syncJob.progress, notification)
```

- **Подключение**: токен (`auth.token`, `Authorization: Bearer` или `?token=`) необязателен. Без токена сокет подключается анонимно: не попадает ни в одну комнату, `order.subscribe` / `kds.subscribe` / `dispatch.subscribe` отвечают `{ok:false}`, приходят только публичные события. Невалидный или просроченный токен и заблокированный аккаунт — по-прежнему разрыв соединения (клиент обновляет токен и переподключается).
- **Публичные события** (всем сокетам namespace `/ws`, включая анонимные): `store.loadChanged` `{storeId, busy, busyMeter, currentEtaSeconds}` — шлётся, когда кухня ставит или снимает «Загружены» (и когда отметку снимает конец смены); `store.availabilityChanged` — ровно `{storeId, brandId, acceptingOrders}` (тип `StoreAvailabilityChangedEvent` в `libs/shared-types`). Шлётся после открытия и закрытия смены, смены статуса точки в админке, «Загружены» на кухне и удаления точки (`acceptingOrders: false`). Состояние перечитывается из БД, поэтому событие совпадает с тем, что отдал бы каталог; при текущем правиле `openNow = acceptingOrders`, перезапрашивать точку ради `openNow` не нужно.
- **Комнатные события**: `order.statusChanged` (комнаты `order:<id>` и `user:<id>`), `kds.orderChanged` / `kds.shiftChanged` (`kds:<storeId>`: роль персонала и точка в скоупе), `dispatch.orderChanged` (`dispatch:<storeId>`, STORE_MANAGER и выше).

OpenAPI 3.1 (через `@nestjs/swagger`) — источник правды, от него генерируется типизированный клиент `libs/api-client` для Angular. Для Flutter — `libs/api-client-dart` (Retrofit + json_serializable), модели проверяются тестами на ответах живого API.

## 7. Этапы разработки (дорожная карта)

> Сводный статус — в секции 0.1. Здесь — расшифровка пунктов и оставшийся объём.

### M0 — Фундамент (fundament) ✅

- Монорепо (pnpm + Nx) ✅
- docker-compose (pg, redis, minio, mailhog) ✅
- NestJS скелет, Prisma-схема, первые миграции ✅
- GitHub Actions CI (lint, test, build) ✅
- Angular скелеты для web / tma / admin / kds ✅

### M1 — Auth + Catalog ✅

- OTP auth, JWT ✅ (+ password auth, OAuth Google/Apple/Telegram)
- CRUD меню в admin ✅
- Публичное API каталога ✅
- Web: экраны каталога, карточки продукта ✅
- TMA: адаптация под Telegram ✅

### M2 — Pre-order core (Cart + Checkout + Live status) ✅

- Cart sync между устройствами с live-ETA ✅
- Чекаут с выбором точки и pickup time (ASAP / scheduled) ✅
- Stripe Payment Intents + webhook ✅
- Order creation с генерацией order code + QR ✅
- Live-status экран: WebSocket, таймер ETA, push-уведомления ✅
- Геофенсинг «я в пути» ✅ (`/orders/:id/im-here` + ping endpoint)
- KDS: базовая панель с dual-timer, колонки NEW/IN_PROGRESS/READY ✅

### M3 — Лояльность ✅

- Loyalty accounts, начисление/списание ✅
- Промокоды ✅
- Подарочные карты ✅ (`gift-cards` модуль + admin issue UI + redemption на checkout)
- Рефералка ✅ (код на пользователя, бонус обеим сторонам с первого оплаченного заказа)

### M4 — Push / Email / Telegram ✅

- ~~FCM push~~ → Web push через VAPID + `/devices` ✅ (FCM не подключали)
- Email templates (welcome, receipt) ✅ — через nodemailer/SMTP (не Mailgun)
- Telegram bot для уведомлений ✅ — пуши на rider/brand staff

### M5 — Admin panel расширенная 🟡

- Аналитика 🟡 — модуль есть, materialized views точечно
- Маркетинговые кампании ✅ (push/Telegram/email broadcast for brands)
- Multi-store управление ✅ (per-store fee overrides, inline store editor, multi-brand scope)
- Staff roster: invite managers + kitchen staff ✅ (вне исходного ТЗ)
- Brand moderation (banners + rejection note) ✅ (вне исходного ТЗ)

### M6 — Mobile apps (Flutter) 🟡

Код готов и проверен на эмуляторе сквозным прогоном против живого API (`apps/mobile/README.md`):

- Каркас, тема по дизайн-токенам (светлая/тёмная), RU/EN, иконки и сплэш ✅
- Вход Telegram / Google / Apple, secure storage, ротация refresh ✅
- Точки (карта + список, «рядом», «открыто сейчас»), меню с поиском, быстрое добавление, конструктор товара ✅
- Корзина, чекаут ASAP/ко времени, промо, подарочные карты, баллы, доставка, оплата только картой Агропромбанка (бронь на чекауте, списание при принятии) ✅
- Live-статус: сокет + опрос, кольцо ETA, код и QR, «Я на месте», геофенсинг, отмена, повтор, чек на почту ✅
- Push: FCM на сервере + `firebase_messaging` в приложении ✅ (ждёт ключей)
- Профиль: лояльность, рефералы, подарочные карты, способы оплаты, уведомления ✅
- CI: workflow `Mobile` (analyze, тесты, release-APK) ✅
- Выпуск: ключи Firebase/Google/Apple, аккаунты App Store / Google Play, сборка iOS на Mac, подпись release ❌

### M7 — Scale & polish ❌

- Наблюдаемость, алерты
- Load testing
- A/B testing framework
- White-label / multi-tenant (часть multi-brand уже в проде, см. секцию 0.2)

### Доп. треки (вне исходного roadmap)

- **POS integrations** ✅ — iiko + Poster (см. `docs/integrations.md`). Poster: menu/stop-list (M2), outgoing orders (M3), webhooks (M4). iiko: menu/stop-list (cron poll, M5), outgoing orders (M5). Все credentials — AES-256-GCM.
- **Delivery v1** 🟡 — riders, dispatch, scheduled delivery, geolocation в TMA, per-store fees. Pending: расширение метрик и SLA.

## 8. Вне скоупа MVP

- ~~Курьерская доставка~~ — реализована как трек delivery v1 (riders, dispatch, scheduled). Бренд отвечает за своих курьеров; собственная курьерская сеть в скоуп не входит.
- Dine-in заказы с обслуживанием за столом (только базовый dine-in pickup)
- Собственный POS-терминал (вместо этого — **интеграция с iiko/Poster**, см. `docs/integrations.md`)
- Интеграция с Uber Eats / DoorDash
- Инвентарный учёт ингредиентов
- Мультивалютность в одном заказе
- Холодные цепочки / склад
- Физические pickup lockers с электронным замком (v2)

## 9. Риски

- **Stripe**: комплаенс в отдельных странах → верифицировать при выборе рынка
- **Telegram Mini App**: лимиты на payments, нужна fallback-оплата через Stripe Checkout
- **Многоязычие**: перевод маркетингового контента — нужен процесс
- **Легал**: налоги, чеки, фискализация разные в каждой стране — начинать с 1–2 стран
