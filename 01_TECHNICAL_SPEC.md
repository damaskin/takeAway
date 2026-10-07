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

- **NestJS 11** на **FastifyAdapter** (`@nestjs/platform-fastify`, `trustProxy: true`)
- **Database**: PostgreSQL 16 + **Prisma 6.19** (16 миграций, см. 5.x)
- **Cache / session / rate limit**: Redis 7 через **ioredis 5**, `@nestjs/throttler`
- **Queue**: **BullMQ 5.74** (`@nestjs/bullmq`) для push/email/Telegram broadcast и POS sync
- **Realtime**: `@nestjs/websockets` + Socket.io 4.8 (`@nestjs/platform-socket.io`)
- **Auth**:
  - JWT через `@nestjs/jwt` + `passport-jwt` + `@nestjs/passport`
  - **Password (bcrypt 6)** для staff/RIDER + **Telegram initData** для customer + OAuth (Google/Apple через `OAuthAccount`)
  - Refresh tokens, force-rotate при инвайте (`passwordMustChange`)
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
- **Модификаторы** (shots, syrups, toppings): add-on с плюсом к цене, min/max count
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
- **Busy meter** (0–100%) — индикатор загрузки кухни, визуализируется цветом (зелёный / жёлтый / красный)
- **Pickup point type** для UI: counter / locker / shelf — определяет инструкции на экране готовности
- Привязка меню (не все точки имеют одинаковый ассортимент)
- Фото интерьера / витрины / pickup-зоны

### 3.4. Pre-order и чекаут (core flow)

**Главный механизм продукта. Вся UX-энергия направлена в этот флоу.**

- Корзина привязана к выбранной точке
- Один и тот же товар с теми же вариациями, добавками и комментарием — одна строка корзины: повторное добавление увеличивает её количество (не больше 99)
- При смене точки — предупреждение, если товара нет
- Корзина синкается между устройствами через user_id (Redis)
- **Расчёт времени готовности на лету** (`KitchenLoadService`). ETA пересчитывается при каждом изменении корзины и ещё раз при чтении — очередь движется без нас:

  ```
  eta = Store.baseEtaSeconds + невыполненная работа точки / Store.kitchenParallelism + prepSeconds заказа
  ```

  - `baseEtaSeconds` — постоянная накладная точки: пробить, собрать, выдать
  - невыполненная работа — сумма `Order.workSeconds` по статусам `CREATED / PAID / ACCEPTED / IN_PROGRESS`; заказ `IN_PROGRESS` считается наполовину сделанным
  - `prepSeconds` — самая долгая позиция в заказе (не сумма): бариста тянет шот, пока взбивается молоко
  - `workSeconds` — сумма по позициям с учётом количества: сколько заказ стоит кухне. Заказ из четырёх напитков грузит бар вчетверо сильнее, чем заставляет ждать своего клиента, поэтому это два разных числа
  - Оба снимаются на заказ в момент создания — правка меню задним числом не переписывает историю

- **Pickup time picker** — ключевой элемент чекаута:
  - `ASAP` (готово через ~X мин, таймер показывается крупно)
  - `Scheduled` — выбор из 15-минутных окон, которые точка успевает обслужить (`GET /stores/:id/pickup-slots`, 12 часов вперёд)
  - Вместимость окна — `Store.slotCapacity`. Заполненное окно приходит помеченным и рисуется вычеркнутым, а не пропадает
  - Проверка вместимости повторяется при создании заказа, включая ASAP: экран чекаута успевает устареть, и двое клиентов могут выбрать последнее окно одновременно
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
- История заказов с фильтрами (`/me/orders`)
- «Повторить заказ» — план (UI ещё не везде)
- Отмена: `POST /orders/:id/cancel` (refund — отдельный flow, admin)
- `EXPIRED` через job по `pickupAt`-таймеру
- Чек по email — да, через nodemailer (welcome + receipt). **PDF attachment** через `pdfkit` (Helvetica, ASCII-only) — для receipt с Cyrillic/non-ASCII PDF не прикладывается, идёт только HTML (custom font для UTF-8 — backlog). `POST /me/orders/:id/resend-receipt` для повторной отправки.

### 3.6. Программа лояльности

- **Баллы**: `LoyaltyAccount.pointsBalance` + append-only `PointsLedger` (типы: `EARN` / `SPEND` / `EXPIRE` / `ADJUST`)
- **Уровни** (фактический enum): `SILVER` / `GOLD` / `PLATINUM` (Bronze в реализации нет — упрощено)
- **Промокоды**: `Promo` с типами `PERCENT` / `FIXED` / `BOGO` / `POINTS_MULTIPLIER`, лимиты на total/per-user
- **Рефералка**: реализовано — каждый юзер получает уникальный код, бонус обеим сторонам начисляется на первом PAID-заказе реферала
- **Подписки (Coffeepass)**: НЕ реализовано — кандидат на v1.x
- **Геймификация**: НЕ реализовано — далёкий backlog

### 3.7. Подарочные карты

- Реализовано как admin-driven flow (v1):
  - Brand admin выпускает карту через `/admin/gift-cards` → код шарится клиенту out-of-band
  - Клиент вводит код в чекаут (рядом с промо), баланс применяется как скидка через `GiftCardRedemption`
  - Поддержка частичного погашения (баланс остаётся)
- НЕ реализовано в v1: customer-facing покупка карты со Stripe, кастомный дизайн/шаблон, email с подарком

### 3.8. Уведомления

- **Push**: мобильное приложение — iOS **напрямую через APNs** (`ApnsPushProvider`: HTTP/2 на `api.push.apple.com` / `api.sandbox.push.apple.com`, одно долгое соединение на шлюз с переподключением после GOAWAY/ошибки/таймаута 10 с/10 мин простоя; ES256-токен провайдера на 50 мин; ключ `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_PRIVATE_KEY`, при пустом `APNS_PRIVATE_KEY` — ключ Sign in with Apple `APPLE_*` с включённым APNs; `APNS_TOPIC` = `md.takeaway.ios`, `APNS_ENABLED=false` выключает), Android и iOS старых версий приложения — **FCM HTTP v1** (сервисный аккаунт `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`; iOS там идёт через APNs-ключ, загруженный в Firebase), браузер — **VAPID** (`web-push`). Устройства — в `Device`; токены, которые FCM называет `UNREGISTERED`, и подписки браузера с ответом 404/410 удаляются при отправке. APNs: `BadDeviceToken` повторяется на другом шлюзе (и он запоминается в `apnsEnvironment`); токен, который отвергли оба шлюза или APNs назвал `Unregistered`, стирается из `apnsToken` (строка и FCM-токен остаются); ошибки настройки (`InvalidProviderToken`, чужой topic) ничего не стирают. В payload есть `gcm.message_id`, чтобы `firebase_messaging` показывал такой push в приложении и открывал заказ по тапу.
- **Правило доставки клиенту** (`NotificationsService.deliver`): APNs, FCM и web push параллельно. iOS-устройство с `apnsToken` при настроенном APNs получает push только через Apple, его FCM-токен пропускается (без дублей, когда починят и Firebase); если Apple push не принял — пробуется FCM-токен этого устройства. Если ни один транспорт не принял (нет токенов, транспорт не настроен, отказ) и у пользователя есть `telegramUserId` — сообщение от Telegram-бота. Одинаково для статусов заказа и для маркетинговых рассылок с каналом PUSH, поэтому клиент Mini App (без токенов) получает бот, а пользователь приложения — один push без дубля в Telegram. Сбои логируются на уровне warn с причиной; в результате доставки причина сохраняется и тогда, когда сообщение всё же дошло (другим устройством или через бота).
- **Регистрация устройства**: `POST /devices` (см. 6.6) убирает строки с тем же токеном у других аккаунтов (сессия истекла без выхода — пуши прежнего аккаунта иначе приходили бы на этот телефон) и строки того же iOS-устройства с прежним FCM-токеном (тот же `apnsToken`). Приложение держит устройство зарегистрированным только при разрешённых уведомлениях — иначе FCM/APNs принимают push, который телефон не покажет, и рассылка считала бы его доставленным.
- **Email**: nodemailer/SMTP — welcome (на первом PAID), receipt (на PAID), password reset.
- **Telegram bot**: пуши rider при назначении, brand staff при новом PAID-заказе; customer — статусы заказов и рассылки, когда app/web push недоступен.
- **Обратная связь → платформа** (`FeedbackNotifier`): о каждом новом `Feedback` — сообщение в ops-чат (`OPS_ALERT_TELEGRAM_CHAT_ID`); если чата нет или Telegram его не принял — каждому SUPER_ADMIN с привязанным Telegram от бота; плюс email всем SUPER_ADMIN, только если настроен SMTP. Язык — `PLATFORM_LOCALE` (ru по умолчанию), ссылка — `ADMIN_APP_URL/feedback`. Best-effort: сбой доставки только логируется.
- **Per-user prefs**: `notifyOrderUpdates` + `notifyPromotions` через `PATCH /me/notifications`. Operational push (rider/brand staff) prefs не учитывает.
- **Marketing campaigns**: brand admin рассылает push/Telegram/email через `Campaign` (см. 3.9), audience: ALL / HAS_ORDERED / INACTIVE_30D. Учитывается `notifyPromotions`. Список рассылок (`GET /admin/campaigns`) отдаёт по каждой `via` — сколько людей дошло через каждый транспорт (`apns`, `fcm`, `webpush`, `telegram`, `email`) — и `errors` — до трёх самых частых ошибок доставки с числом получателей (в том числе app push, который не дошёл перед Telegram-фолбэком).

### 3.9. Admin panel

- **Роли** (фактический enum): `SUPER_ADMIN`, `BRAND_ADMIN`, `STORE_MANAGER`, `STAFF`, `RIDER`, `CUSTOMER`. `ANALYST` из исходного ТЗ — нет, аналитика доступна `BRAND_ADMIN`/`SUPER_ADMIN`.
- **Brand registration + moderation**: бизнес регистрируется в админке (`/signup` → `POST /business/register`) с валютой бренда (MDL по умолчанию) и языком писем; телефон — E.164, конфликты возвращаются кодами (`EMAIL_TAKEN`, `EMAIL_CUSTOMER_ACCOUNT`, `PHONE_TAKEN`). Бренд создаётся `PENDING`; владелец попадает на дашборд с чек-листом «Запуск бренда» (`GET /my-brand/onboarding`: логотип, точка с адресом и часами, категория и товар с фото, оплата, модерация) и видит баннер статуса на всех страницах. SUPER_ADMIN одобряет/отклоняет в модальном окне; причина отказа обязательна (и на сервере). Отклонённый бренд после правок отправляется повторно (`POST /my-brand/resubmit`). Письма владельцу («заявка получена», «одобрен», «нужны правки» — на языке бренда) и платформе (новая заявка, повторная подача — email всем SUPER_ADMIN и ops-чат в Telegram); сбой отправки не ломает запрос. Контакт поддержки — `SUPPORT_EMAIL` / `SUPPORT_TELEGRAM`.
- **Menu management**: CRUD категорий / продуктов / вариаций / модификаторов; цена вводится в валюте бренда, время приготовления — в минутах; до 6 фото на товар (первое — главное, JPEG/PNG/WebP/AVIF до 5 МБ, тип определяется по содержимому, SVG не принимается); слаги необязательны и генерируются из названия с транслитерацией кириллицы; порядок категорий и товаров; удаление непустой категории — 409 `CATEGORY_NOT_EMPTY` или перенос товаров (`?moveProductsTo=`); удаление товара или опции чистит корзины в транзакции; «нет в наличии» по точке — до отмены или до конца дня в часовом поясе точки; описание, КБЖУ, кофеин, диетические метки, аллергены.
- **Store management**: новая точка создаётся `CLOSED` (черновик) с чек-листом готовности `readiness` (координаты, часовой пояс IANA, часы работы, видимая позиция в меню, одобрение бренда — информативно); открыть точку можно только когда обязательные пункты выполнены (409 `STORE_NOT_READY` со списком). Часовой пояс проверяется на сервере; если он не передан, API выводит его из города / страны / координат (`suggestStoreTimeZone` в `libs/utils`: Молдова и ПМР → `Europe/Chisinau`, Украина → `Europe/Kyiv`, Россия → `Europe/Moscow`, Румыния → `Europe/Bucharest` и др.; рамка координат Молдовы), иначе берёт преобладающий пояс других точек бренда, иначе `Europe/Chisinau` — никогда не UTC (так же для точек из POS). Форма создания подставляет пояс по адресу, пока владелец не выбрал его сам; открытая точка на UTC подсвечивается красным баннером на карточке и на дашборде; валюта берётся из бренда и блокируется после первого заказа (409 `STORE_CURRENCY_LOCKED`); точка с заказами не удаляется, а закрывается (409 `STORE_HAS_ORDERS`). Редактор: основное, часы работы (расписание или круглосуточно, выходные по дням, окна через полночь), касса и кухня (налог, способы получения, место выдачи, базовое время, параллельность, ёмкость слота, минимальный заказ), фото (обложка и до 8 в галерее), доступ на кухню (PIN сотрудников); **per-store delivery fee overrides**.
- **Staff roster**: страница «Сотрудники» — по людям, а не по точкам (`/admin/staff`): у сотрудника одна роль (`User.role`) и список точек, где он работает (pivot `UserStore`); точки отмечаются в карточке сотрудника, приглашение сразу на несколько точек. Досягаемость: SUPER_ADMIN — все точки (бренда из `brandId`), BRAND_ADMIN — точки своих брендов, STORE_MANAGER — только назначенные ему; точки вне досягаемости вызывающего не показываются и не меняются. STORE_MANAGER не назначает менеджеров и не меняет других менеджеров, свои роль и точки не меняет никто. Без последней точки сотрудник выбывает из команды; PIN кухни, привязанный к снятой точке, сбрасывается. Старые per-store `/admin/stores/:id/staff` остались для других клиентов; курьеры — `/admin/stores/:id/riders`. Invite — через временный пароль с force-rotate.
- **Меню по точкам и стоп-лист**: в форме товара — «Продаётся в точках» (галочки, по умолчанию все; у бренда с одной точкой блок скрыт и точка назначается сама), в таблице меню — чипы точек и «—» в колонке наличия для точки, где товар не продаётся. Страница «Стоп-лист» (`/stop-list`, роли SUPER_ADMIN / BRAND_ADMIN / STORE_MANAGER / STAFF, ссылка в меню и в шапке «Кухни»): выбор из своих точек, блюда и напитки точки и добавки, которыми пользуются её товары, переключатель «В наличии / В стопе» (до отмены или до конца дня), поиск и фильтр «только в стопе». STAFF только переключает — создавать, менять и удалять товары и добавки он не может (API-роли).
- **Orders**: `/admin/orders` живой фид. **Refund**: `POST /admin/orders/:id/refund` — full/partial Stripe refund, обновляет `Payment.refundedCents` + `PaymentStatus`, эмитит `REFUND_ISSUED` event с `actorId`. RBAC: SUPER_ADMIN — всё, BRAND_ADMIN — только свои бренды, STORE_MANAGER — только свои store-scope.
- **Тарифы (BrandPlan)**: `BASIC` (10 %) и `PRO` (15 %), `Brand.plan` + `Brand.commissionBps`. Что входит в тариф — `PLAN_FEATURES` в `libs/shared-types` (единый источник для админки и API). API: `@RequiresPlanFeature(feature)` → 403 `PLAN_FEATURE_REQUIRED` `{ feature, requiredPlan }`, бренд берётся из `brandId` запроса или из всех брендов пользователя, SUPER_ADMIN проходит всегда. Админка: `PlanAccess` по активному бренду, `planGated()` — на том же пути вместо раздела страница апселла, в меню значок PRO. PRO-разделы: `/promo`, `/campaigns`, `/customers`, глубокая аналитика (top-products, cohort), сравнение точек, сотрудники, список ушедших, win-back. Подарочные карты, интеграции — на всех тарифах. Существующие на момент миграции бренды — PRO, новые — BASIC; тариф меняет SUPER_ADMIN (`PATCH /admin/brands/:id/plan`), оплаты нет.
- **Promo / Gift cards**: CRUD + статусы.
- **Marketing campaigns**: composer + send (push/Telegram/email broadcast), тариф PRO (`@RequiresPlanFeature('campaigns')` на весь контроллер). Работают на бренде из переключателя (SUPER_ADMIN — любой бренд, `?brandId=`).
  - **Аудитории**: `ALL` — все клиенты (`role = CUSTOMER`, не заблокированы), у которых есть связь с брендом: заказ в его точке в любом статусе, корзина в его точке или купленная подарочная карта бренда (бот и приложение у платформы общие, поэтому вход через них с брендом не связывает); `HAS_ORDERED` — хотя бы один оплаченный заказ; `INACTIVE_30D` — платили, но не за последние 30 дней.
  - **Предпросмотр** до отправки (`GET /admin/campaigns/preview`): сколько человек в аудитории, сколько достижимо и через что (приложение / браузер / Telegram / email), сколько без канала и сколько отписались, и какие транспорты настроены на сервере.
  - **Тест себе** (`POST /admin/campaigns/test`): текст уходит только текущему админу по тем же правилам, без учёта его отписки.
  - **Отправка в фоне**: `POST /admin/campaigns/:id/send` сразу переводит рассылку в `SENDING` и отвечает; рассылка идёт пачками по 50, по каждому получателю пишется `CampaignDelivery` (SENT / FAILED / NO_CHANNEL / OPTED_OUT), счётчики обновляются после каждой пачки. Итог — `SENT`, если доставлено хоть одному, иначе `FAILED` с `lastError`. Падение рассылки → `FAILED` с текстом ошибки; `SENDING` без движения дольше 10 минут крон переводит в `FAILED`.
  - **Повтор**: можно отправить снова `FAILED`, зависшую `SENDING` и `SENT` с ошибками; получатели, которым уже доставлено, пропускаются. Пустая аудитория — 400 `CAMPAIGN_NO_RECIPIENTS`, повторный запуск во время отправки — 409 `CAMPAIGN_IN_PROGRESS`.
- **Analytics**: summary, order-statuses, revenue, top-products, cohort, stores, staff, churn, winback и `/admin/customers`. Период — `from`/`to` (календарные дни в часовом поясе точки или преобладающем поясе бренда; `days` по-прежнему принимается), сравнение — с таким же отрезком до него; `storeId` сужает до точки в скоупе. Цифры бренда читаются из `Order` между локальными полуночами (индекс `Order(storeId, createdAt)`), выручка — без `CANCELLED` и `EXPIRED`. `mv_orders_daily` (UTC-дни, refresh каждые 5 минут через `AnalyticsRefreshService`) питает только экран «Весь проект». Отток: клиент потерян, когда после его последнего заказа прошло 7/14 дней без нового; «потерян в периоде» — этот порог пришёлся на период и клиент не вернулся к его концу; деньги — сумма их средних чеков. Возврат: клиенты, потерянные к началу периода, заказавшие в нём. Удалённые аккаунты (`User.blockedAt`) в оттоке и списке клиентов не участвуют, их заказы остаются в выручке.
- **POS integrations**: connect (с шифрованными credentials AES-256-GCM), sync stores/menu/stop-list, мониторинг jobs.
- **Обратная связь** (`/feedback`, только SUPER_ADMIN, пункт меню с бейджем непрочитанных): отзывы, предложения и проблемы, которые клиенты пишут из профиля в приложении, на сайте и в Mini App. Новые сверху; вкладки «Входящие» (всё, кроме архива) / «Непрочитанные» / «Архив», фильтр по типу; у карточки — тип, текст, клиент (имя, email, телефон, Telegram ID; «аккаунт удалён»), оставленный контакт, платформа и версия приложения, дата. «Прочитано» / «Непрочитано», «В архив» / «Вернуть из архива».
- **Brand theme overrides**: `themeOverrides` JSON с CSS-переменными (применяется в TMA, опционально на web).
- **Multi-brand**: ✅ через `BrandScopeService` (BRAND_ADMIN видит только свой бренд) и `UserStoreScopeService`: SUPER_ADMIN — все точки, BRAND_ADMIN — точки своих брендов, STORE_MANAGER и STAFF — назначенные. Скоуп проверяется во всех per-store маршрутах, в KDS-сокете, у курьеров и в аналитике.

### 3.10. KDS (экран баристы)

- Раздел «Кухня» (`/kitchen`) в кабинете бизнеса `apps/admin`; отдельное приложение `apps/kds` выведено 26.09.2026, `kds.takeaway.md` отвечает 301 на `admin.takeaway.md/login/pin`. Планшет на точке — тот же кабинет в «режиме планшета»: без меню и шапки, тёмная доска на весь экран; включается PIN-входом или кнопкой на доске
- Новые заказы приходят по всему кабинету: всплывающая карточка с «Принять», звук, системное уведомление из фоновой вкладки, счётчик непринятых в меню. Кабинет держит одно сокет-подключение (`kds.subscribe` на все точки активного бренда) с повторным входом в комнаты после переподключения
- Авторизация: email + password (`auth/password/login`), а также **KDS PIN** (`auth/kds/pin`) — 4–6 цифр scoped to one store (только STAFF/STORE_MANAGER). PIN управляется brand admin'ом через `PUT/DELETE /admin/stores/:id/staff/:userId/kds-pin`. PIN хранится как HMAC-SHA256(storeId+pin) с server secret `KDS_PIN_SECRET`; без секрета (пусто или `CHANGE_ME`) установка и вход по PIN отвечают 503 `KDS_PIN_NOT_CONFIGURED`, API при этом стартует. Защита от подбора: кроме per-IP throttle — счётчик в Redis на точку, после 10 неверных PIN за 10 минут вход по PIN на точке закрыт на 10 минут (429 `KDS_PIN_LOCKED`). UI lockscreen — `/login/pin` в кабинете (выбор точки один раз на устройство, экранная клавиатура).
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
User (id, phone?, email?, passwordHash?, passwordMustChange, name?, locale, currency,
      telegramUserId?, role[CUSTOMER|RIDER|STAFF|STORE_MANAGER|BRAND_ADMIN|SUPER_ADMIN],
      notifyOrderUpdates, notifyPromotions, blockedAt?, referralCode?, referredByUserId?,
      kdsPinHash?, kdsPinStoreId?)                            // KDS lockscreen PIN, scoped to one store
Device (id, userId, type[WEB|TMA|IOS|ANDROID], pushToken?, apnsToken?,   // apnsToken — сырой APNs-токен iOS (hex)
        apnsEnvironment?[PRODUCTION|SANDBOX], locale, lastSeenAt)
OAuthAccount (id, userId, provider[GOOGLE|APPLE|TELEGRAM], providerUserId)
PasswordResetToken (id, userId, tokenHash, expiresAt, consumedAt?)
Referral (id, referrerId, refereeId, status[PENDING|REWARDED|CANCELLED], rewardOrderId?,
          referrerPointsCredited, refereePointsCredited)
Feedback (id, userId? [SET NULL], kind[REVIEW|SUGGESTION|PROBLEM], message (1–2000, trimmed),
          contact? (≤200), source[IOS|ANDROID|WEB|TMA], appVersion?,
          status[NEW|READ|ARCHIVED], readAt?, createdAt)        // «Обратная связь» из профиля клиента
```

### 5.2. Tenancy / Stores

```
Brand (id, slug, name, currency, locale, logoUrl?, themeOverrides?, ownerId?,
       moderationStatus[PENDING|APPROVED|REJECTED], moderationNote?,
       plan[BASIC|PRO] = BASIC, commissionBps = 1000)   // тариф и комиссия платформы, меняет SUPER_ADMIN
Store (id, brandId, slug, name, address, lat, lng, timezone, currency,
       status[OPEN|CLOSED|BUSY|PAUSED], fulfillmentTypes[], pickupPointType[COUNTER|SHELF|LOCKER],
       busyMeter, baseEtaSeconds, kitchenParallelism, slotCapacity, minOrderCents,
       taxRateBps, taxIncludedInPrice,
       deliveryFeeBaseCents?, deliveryFeePerKmCents?, deliveryFreeRadiusM?, deliveryMaxRadiusM?,
       externalProvider?[POSTER|IIKO], externalId?)
UserStore (userId, storeId)              // pivot: scope STAFF/RIDER/STORE_MANAGER на конкретные точки
StoreWorkingHour (storeId, weekday[0..6], opensAt, closesAt, isClosed)
StoreShift (storeId, openedAt, openedById?, closedAt?, closedById?)   // не больше одной открытой на точку (частичный уникальный индекс)
```

### 5.3. Catalog

```
Category (id, brandId, slug, name, sortOrder, availableFrom?, availableTo?, visible,
          externalProvider?, externalId?)
Product (id, brandId, categoryId, slug, name, basePriceCents, prepTimeSeconds,
         caffeineLevel?, calories?, P/F/C, allergens[], dietTags[VEGAN|GLUTEN_FREE|...],
         imageUrls[], visible, sortOrder, availableFrom?, availableTo?,
         externalProvider?, externalId?)
Variation (id, productId, type[SIZE|TEMP|MILK|CUP], name, priceDeltaCents,
           prepTimeDeltaSeconds, isDefault, ingredientId?)
Modifier (id, productId, slug, name, priceDeltaCents, prepTimeDeltaSeconds,
          minCount, maxCount, externalProvider?, externalId?, ingredientId?)
Ingredient (id, brandId, name, isAvailable)   -- библиотека добавок бренда, (brandId, name) уникально
ProductStore (productId, storeId)              -- точки, где товар продаётся; PK (productId, storeId)
StopListEntry (id, storeId, productId, reason?, expiresAt?)
StoreIngredientStop (storeId, ingredientId, expiresAt?)  -- добавка закончилась в одной точке; PK (storeId, ingredientId)
```

**Меню по точкам.** Товар есть в меню точки и заказывается в ней, только если для пары (товар, точка) есть строка `ProductStore`; без строк товар не продаётся нигде. Миграция `20261004000000_store_menu_availability` заполнила каждую пару «товар × точка его бренда», так что после выкатки ничего не пропало. Новый товар без `storeIds` получает все точки бренда (так же — импорт из POS); новая точка (кабинет или импорт из POS) получает все товары бренда. `GET /stores/:id/menu` отдаёт только товары точки и пропускает категории, где их нет; `GET /products/:idOrSlug?store=` отвечает 404 для товара, который эта точка не продаёт. Корзина отвечает 400 `ITEMS_UNAVAILABLE` (с названием) на товар не этой точки, оформление снимает такую строку (`CART_CHANGED`, `PRODUCT_UNAVAILABLE`).

**Добавки и наличие.** Добавки (modifiers) и молоко (MILK-варианты) ссылаются на запись библиотеки `Ingredient` бренда; новая добавка или молоко привязывается к записи с тем же названием (создаётся при отсутствии), `ingredientId: null` — не отслеживать. Пока `isAvailable = false`, все опции с этой добавкой скрыты во всех клиентах (`GET /products/:idOrSlug`), корзина их не принимает, а строка корзины с ней снимается при оформлении (`CART_CHANGED`, `OPTION_UNAVAILABLE`); сам товар остаётся в меню. Если скрыт вариант по умолчанию, по умолчанию выбирается первый оставшийся того же типа. Кроме общего для бренда `isAvailable` точка может остановить добавку у себя (`StoreIngredientStop`, с `expiresAt` или до отмены): её опции скрыты в `GET /products/:idOrSlug?store=` этой точки, а корзина и оформление этой точки их не принимают — с 400 `ITEMS_UNAVAILABLE` и названием опции при добавлении. Опции без привязки к справочнику (размер, температура, стакан или явно «не отслеживать») по точкам не останавливаются.

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
       status[DRAFT|ACTIVE|PAUSED|EXPIRED])
PromoRedemption (id, promoId, userId, orderId unique, discountCents)
GiftCard (id, code unique, brandId, initialAmountCents, balanceCents, currency,
          status[ACTIVE|REDEEMED|EXPIRED|CANCELLED], purchaserUserId?, recipientEmail?,
          expiresAt?)
GiftCardRedemption (id, giftCardId, orderId unique, amountCents)
Campaign (id, brandId, title, body, channel[PUSH|TELEGRAM|EMAIL],
          audience[ALL|HAS_ORDERED|INACTIVE_30D],
          status[DRAFT|SCHEDULED|SENDING|SENT|FAILED],
          targetCount, sentCount, failedCount, noChannelCount, optedOutCount,
          lastError?, scheduledAt?, startedAt?, sentAt?)
CampaignDelivery (id, campaignId, userId, outcome[SENT|FAILED|NO_CHANNEL|OPTED_OUT],
                  via? ("apns,fcm,webpush" | "telegram" | "email"),
                  error?)   // также у SENT: что не сработало по дороге (app push перед Telegram)
  unique (campaignId, userId) — повтор рассылки пропускает уже доставленных
```

### 5.6. Analytics (materialized views)

```
mv_orders_daily (brandId, storeId, day, orderCount, revenueCents,
                 slaHits, slaTotal, pickupSecSum, pickupSecCount)
  unique (brandId, storeId, day)
  refreshed every 5 min via REFRESH MATERIALIZED VIEW CONCURRENTLY
```

Источник: `Order` join `Store` для заказов кроме `CANCELLED` и `EXPIRED`, агрегация по UTC-дню. SLA-hit считается при readyAt − coalesce(acceptedAt, createdAt) ≤ 7 минут. Pickup-длительность — readyAt → pickedUpAt. Питает только `/admin/analytics/brands` (платформа); аналитика бренда считается по `Order` в его часовом поясе.

**Дашборды (`overview`).** Пять сгруппированных запросов по `Order ⋈ Store ⋈ Brand` идут параллельно, без выборки заказов по одному: (1) итоги текущего и прошлого отрезка по точке/бренду и по всему скоупу (`GROUPING SETS`, чтобы клиенты считались уникальными по скоупу, а не суммой по точкам); (2) дни текущего отрезка в поясе скоупа; (3) первые засчитанные заказы клиентов в скоупе (новый клиент — первый заказ в этом бизнесе/на платформе попал в отрезок); (4) загрузка по часу и дню недели (ISO, Пн = 1) в поясе каждой точки — точка на UTC-заглушке берёт пояс отрезка; (5) статусы заказов отрезка. Правила как во всей аналитике: выручка, заказы и клиенты — без `CANCELLED`/`EXPIRED`; `placed` — все заказы; доля отмен = (отменённые + истекшие) / placed. Мгновения передаются как `timestamp` (`utc()`), чтобы TimeZone сессии Postgres ничего не сдвигал. Комиссия = Σ totalCents × текущий `commissionBps` бренда / 10 000.

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
POST   /auth/kds/pin                  { storeId, pin } → tokens   (KDS lockscreen, STAFF/STORE_MANAGER, 4–6 digits)
POST   /auth/password/forgot         { email }
POST   /auth/password/reset          { token, password }
POST   /auth/password/change         { oldPassword, newPassword }    (auth)
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
                                     //   (плюс 5/мин на IP); платформа узнаёт в Telegram, см. 3.8
```

### 6.3. Catalog

```
GET    /stores?lat=&lng=&radius=     // включает currentEtaSeconds, busyMeter, acceptingOrders (открыта смена), openNow, timezone, brandName, logoUrl (логотип бренда для карточки точки)
GET    /stores/:idOrSlug             // openNow: примет ли точка ASAP-заказ сейчас (= acceptingOrders: статус не CLOSED и открыта смена)
GET    /stores/:idOrSlug/menu        (категории + продукты + variations + modifiers + stop-list)
GET    /products/:idOrSlug[?store=]  // включает brandId; ?store= (id или slug просматриваемой точки) ищет слаг внутри её бренда — слаги уникальны только в бренде;
                                     //   с ?store= — 404, если точка не продаёт товар, и без опций, добавка которых остановлена в этой точке
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
POST   /business/register            { brand, contact, currency, locale, phone? } → { brand: { moderationStatus: PENDING } }
GET    /my-brand[?brandId=]          (BRAND_ADMIN → свой бренд; SUPER_ADMIN → бренд из brandId)
PATCH  /my-brand[?brandId=]          (название, логотип, цвета, язык; валюта — до первого заказа, иначе 409 CURRENCY_LOCKED)
POST   /my-brand/logo[?brandId=]     (multipart → S3/MinIO)
GET    /my-brand/onboarding[?brandId=]  → чек-лист запуска бренда
POST   /my-brand/resubmit[?brandId=]    REJECTED → PENDING, уведомляет платформу
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
GET/POST/PATCH/DELETE  /admin/products[/:id]        + PATCH /admin/products/:id/visibility, PATCH /admin/products/reorder
                                                    + storeIds[] в create/update (create без него — все точки бренда; update — заменяет список;
                                                      400 STORE_UNKNOWN для чужой точки), ответы несут storeIds, GET ?storeId= — товары точки
GET                    /admin/products/stores?brandId=   точки бренда для выбора в форме товара (доступно MENU_EDITOR)
                                                    + POST/DELETE /admin/products/:id/images, PUT /admin/products/:id/images/order
                                                    + POST/PATCH/DELETE /admin/products/:id/variations[/...]
                                                    + POST/PATCH/DELETE /admin/products/:id/modifiers[/...]
GET/POST/PATCH/DELETE  /admin/ingredients[/:id]     библиотека добавок бренда (GET ?brandId=), PATCH { isAvailable } — «закончилось/появилось»
GET/POST/PATCH/DELETE  /admin/stores[/:id]            // ответы несут readiness; 409 STORE_HAS_ORDERS / STORE_CURRENCY_LOCKED /
                                                    //   STORE_SLUG_TAKEN / STORE_NOT_READY
POST/DELETE            /admin/stores/:id/images?kind=hero|gallery
PUT                    /admin/stores/:id/working-hours
GET/POST/DELETE        /admin/stores/:id/stop-list[/:productId]     // + STAFF своей точки; товар должен быть из бренда точки
GET                    /admin/stores/:id/availability                // стоп-лист точки: её товары и добавки с остановками (+ STAFF)
PUT/DELETE             /admin/stores/:id/ingredient-stops/:ingredientId   // { expiresAt? } — добавка закончилась в этой точке (+ STAFF)

# Staff (по людям; ?brandId= — активный бренд, без него вся досягаемость вызывающего)
GET    /admin/staff                  → [{ userId, email, phone, name, role, blocked, addedAt,
                                          stores: [{ id, name }], kdsPinStoreId, hasKdsPin, editable }]
GET    /admin/staff/:userId          → то же для одного (404 вне досягаемости)
POST   /admin/staff                  { email, name?, role, tempPassword, storeIds[≥1] } → 201
                                     //   409 STAFF_ALREADY_ON_TEAM / STAFF_EMAIL_TAKEN
PUT    /admin/staff/:userId/stores   { storeIds[] } → замена в пределах досягаемости; [] — убрать из команды
PATCH  /admin/staff/:userId/role     { role: STORE_MANAGER | STAFF | MENU_EDITOR }
                                     //   403 STAFF_STORE_OUT_OF_SCOPE / STAFF_ROLE_NOT_ALLOWED / STAFF_NOT_EDITABLE

# Staff / Riders (per-store scope)
GET/POST/DELETE        /admin/stores/:storeId/staff[/:userId]
PUT/DELETE             /admin/stores/:storeId/staff/:userId/kds-pin   { pin }
GET/POST/DELETE        /admin/stores/:storeId/riders[/:userId]

# Orders / Promo / Gift cards / Campaigns
GET    /admin/orders/:id             → состав, платежи, возвраты, лента событий (scope как у списка; 404 вне scope)
GET                    /admin/orders                     (фильтрация по store/brand/status)
POST                   /admin/orders/:id/refund          { amountCents?, reason?, note? } → Stripe refund (full/partial)
GET/POST/PATCH         /admin/promo[/:id/status]         // PRO (promo)
GET/POST/DELETE        /admin/gift-cards[/:id]
GET/POST               /admin/campaigns                  ?brandId= (SUPER_ADMIN — обязательно) // PRO (campaigns) — весь контроллер
GET                    /admin/campaigns/preview          ?brandId=&audience=&channel= → охват по каналам + настроенные транспорты
POST                   /admin/campaigns/test             { title, body, channel } → { outcome, via[], error? } — только себе
POST                   /admin/campaigns/:id/send         → SENDING сразу, рассылка в фоне; также «Повторить» для FAILED/зависших/с ошибками
DELETE                 /admin/campaigns/:id              (только DRAFT)

# Аналитика (всё скоупится на бренды пользователя; ?brandId= — бренд из переключателя)
# Период у всех: ?from=YYYY-MM-DD&to=YYYY-MM-DD (дни в поясе бренда/точки) или ?days=N; ?storeId= — одна точка
GET                    /admin/analytics/overview           // дашборд бизнеса одним запросом: period, current/previous (выручка, заказы, placed, клиенты, новые, чек, отмены, истекшие, доля отмен, выдача, точек с заказами, комиссия), daily[], statuses{}, byStore[] (все: выручка/заказы/доли; PRO storeComparison: + previous*, Δ, чек, клиенты, отмены, выдача), byHour[24]/byWeekday[7] (PRO deepAnalytics, иначе null; час — по поясу каждой точки)
GET                    /admin/platform/overview?currency=  // SUPER_ADMIN: тот же формат по брендам одной валюты (byBrand[]: + тариф, commissionBps, commissionCents, точки, модерация); currencies[] — все валюты, по умолчанию та, где выручка больше; дни — в преобладающем поясе точек этих брендов
GET                    /admin/analytics/summary            // выручка, заказы, средний чек, время выдачи + изменения к предыдущему отрезку
GET                    /admin/analytics/order-statuses     // открытые заказы по статусам сейчас + итог заказов периода (выданы / отменены / истекли)
GET                    /admin/analytics/brands?days=       // SUPER_ADMIN: все бренды рядом (тариф, комиссия, точки, заказы, выручка) — «Весь проект»
GET                    /admin/analytics/revenue            // по дням периода
GET                    /admin/analytics/top-products?take= // PRO (deepAnalytics)
GET                    /admin/analytics/cohort             // PRO (deepAnalytics)
GET                    /admin/analytics/stores             // все точки скоупа; BASIC: выручка/заказы/доля, PRO: + доли заказов, чек, выдача, готовка, отмены, сотрудники, дельта (detailed=true)
GET                    /admin/analytics/staff              // PRO: по сотруднику — принял/приготовил/выдал/заказов, смены и часы (часы — тому, кто открыл смену)
GET                    /admin/analytics/churn?window=7|14&take=   // все: count, lostRevenueCents (сумма средних чеков), previous; PRO: customers[]
GET                    /admin/analytics/winback?window=7|14&take= // PRO: потерянные к началу периода → вернулись (кол-во, заказы, выручка, доля) против прошлого
GET                    /admin/customers?search=&sort=lastOrderAt|firstOrderAt|orders|totalCents|avgCheckCents|frequency&dir=&page=&pageSize=  // PRO
GET                    /admin/customers/:id                // PRO: итоги, точки, последние 100 заказов; 404 для удалённых и чужих

# Обратная связь клиентов (только SUPER_ADMIN)
GET                    /admin/feedback?status=NEW|READ|ARCHIVED&kind=&page=&pageSize=   // новые сверху; без status — всё, кроме ARCHIVED
                                                           //   → { items[{ …, author: { name, email, phone, telegramUserId, deleted } | null }], total, page, pageSize, newCount }
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
GET    /kds/shift?storeId=            → { open, openedAt, openedByName, closedAt, closedByName }
POST   /kds/shift/open?storeId=       «Начать работу», идемпотентно
POST   /kds/shift/close?storeId=      «Закончить работу», идемпотентно
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
GET    /health                       // liveness + build triple (version/commit/builtAt)
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
- **Публичные события** (всем сокетам namespace `/ws`, включая анонимные): `store.loadChanged` `{storeId, busyMeter, currentEtaSeconds}`; `store.availabilityChanged` — ровно `{storeId, brandId, acceptingOrders}` (тип `StoreAvailabilityChangedEvent` в `libs/shared-types`). Шлётся после открытия и закрытия смены, смены статуса точки в админке и удаления точки (`acceptingOrders: false`). Состояние перечитывается из БД, поэтому событие совпадает с тем, что отдал бы каталог; при текущем правиле `openNow = acceptingOrders`, перезапрашивать точку ради `openNow` не нужно.
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
