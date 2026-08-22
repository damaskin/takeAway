# takeAway — Technical Specification (MVP)

> **Ключевая механика продукта — pre-order first.** Клиент делает предзаказ, следит за ETA и статусом, приходит к готовому заказу и забирает без очереди. Все архитектурные и UX-решения подчинены этой механике. Курьерская доставка добавлена как полноценный второй канал получения (см. секцию 7 и 0.2).

## 0. Текущее состояние реализации

> Синхронизируется при каждом значимом изменении кода/инфры/roadmap. Источник истины — `git log` + структура `apps/`/`libs/` + `docs/`.

**Стадия:** активная разработка, релиз `v0.5.0-pos-integrations`. Локальный snapshot — после коммита `83adc1a` (2026-04-20+).

### 0.1. Прогресс по milestones

| Milestone                      | Статус | Комментарий                                                                                                                                                                                                                                         |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** Фундамент               | ✅     | Nx + pnpm 10, Node 22+, docker-compose (pg, redis, MinIO, mailhog), NestJS 11 + Prisma 6, Angular 21 (web/tma/admin/kds), CI                                                                                                                        |
| **M1** Auth + Catalog          | ✅     | OTP + password + OAuth (Google/Apple/Telegram), JWT + refresh, CRUD меню, публичный каталог, web/TMA-экраны                                                                                                                                         |
| **M2** Pre-order core          | ✅     | Cart sync, чекаут с ASAP/scheduled, Stripe Payment Intents + webhook, order code + QR, live-status (Socket.io), KDS dual-timer, geofencing «I'm here»                                                                                               |
| **M3** Лояльность              | ✅     | LoyaltyAccount + txn, промокоды, gift cards, рефералы (бонус с первого оплаченного заказа обеим сторонам)                                                                                                                                           |
| **M4** Push / Email / Telegram | ✅     | Web push (VAPID) + `/devices`, transactional email через nodemailer/SMTP (welcome, receipt), Telegram push на rider/brand staff                                                                                                                     |
| **M5** Admin расширенный       | 🟡     | Аналитика, marketing campaigns broadcast, multi-store fee overrides, staff roster + invites, password rotation. Materialized view `mv_orders_daily` (refresh каждые 5 мин) питает summary/revenue/stores; top-products и cohort пока на raw queries |
| **M6** Mobile (Flutter)        | 🟡     | Scaffolding в `apps/mobile/` (pubspec.yaml с целевыми deps, lib skeleton, README с PR-разбивкой M6 PR1–PR8). До `flutter create` ничего не собирается.                                                                                              |
| **M7** Scale & polish          | ❌     | Только базовые health-эндпоинты и preflight в CI                                                                                                                                                                                                    |

### 0.2. Треки за пределами оригинального ТЗ

| Трек                            | Статус | Комментарий                                                                                                                                                                                                                                 |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **POS integrations**            | ✅     | iiko Cloud + Poster, pluggable через `IPosProvider`. Poster: import + stop-list (M2), outgoing orders (M3), webhooks (M4). iiko: import + stop-list (cron) + outgoing orders (M5). AES-256-GCM для credentials. См. `docs/integrations.md`. |
| **Multi-brand SaaS**            | ✅     | Brand registration + moderation (banners, rejection notes), `BrandScopeService` для scope-проверок, brand-themed UI overrides, BRAND_ADMIN роль с ограничением catalog-эндпоинтов                                                           |
| **Delivery (расширена с v1.5)** | 🟡     | TMA geolocation для доставки, scheduled delivery, riders + dispatch admin UI, per-store fee overrides, Telegram push rider при назначении. Не курьерская сеть — модель «бренд организует своего курьера».                                   |
| **Storage / CDN**               | ✅     | MinIO (S3-compatible) bundled в инфре + `cdn.takeaway.million-sales.ru`, brand logo uploader                                                                                                                                                |
| **Notifications prefs**         | ✅     | Per-user prefs: order updates / promotions, force password rotation для invited staff                                                                                                                                                       |

### 0.3. Реальный стек (расхождения с разделом 2)

- **Node 22+**, **pnpm 10.33+** (раздел 2 называл общее, тут зафиксировано конкретно)
- **Nx 22.6.5** (Turborepo не используется)
- **Angular 21.2** (раздел 2 говорит «19+» исторически — следует читать как «21+»)
- **NestJS 11** + Prisma **6.19**, BullMQ **5.74**, Stripe SDK **22**, Socket.io **4.8**, nodemailer **8**
- **Email:** SMTP через nodemailer (Mailgun/Postmark из ТЗ — не подключены)
- **Storage:** MinIO + Cloudflare-style CDN (Cloudflare R2 из ТЗ — не подключен)

### 0.4. База данных

16 миграций, последняя `20260420_password_must_change`. Ключевые домены реализованы: User/Auth, Brand+Store+scope, Catalog, Cart, Order+Events, Payment, Loyalty/Promo/GiftCard/Referral, Device+Notification, POS credentials, Delivery (rider/dispatch), Campaign.

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
│   ├── admin/            # Angular back office
│   ├── kds/              # Angular kitchen display
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
- **Storage**: `@aws-sdk/client-s3` 3.x — реально пишем в **MinIO** (dev/prod), CDN `cdn.takeaway.million-sales.ru`. Cloudflare R2 — потенциальная замена.
- **Email**: **nodemailer 8** через SMTP (welcome, receipt, password reset). Mailgun/Postmark — резерв.
- **Push**: **web-push 3.6** (VAPID) для web/PWA + **TMA**. FCM/APNS — будущий M6 (mobile).
- **Telegram**: бот через прямые вызовы Telegram Bot API (push на rider, brand staff, customer)
- **Logs**: Pino 10 structured logs
- **Monitoring**: Sentry/Prometheus/Grafana — плановое M7

### 2.3. Mobile (v2)

- **Flutter 3.x** (Dart)
- **State**: Riverpod 2
- **Networking**: Dio + Retrofit (сгенерированный клиент из OpenAPI)
- **Storage**: Isar / Hive
- **Push**: `firebase_messaging`
- **Auth**: `google_sign_in`, `sign_in_with_apple`
- **Maps**: `google_maps_flutter` или `mapbox_gl`
- **Payments**: `flutter_stripe`

### 2.4. Инфраструктура — фактически

- **Runtime**: Docker контейнеры (Dockerfile.api для NestJS, Dockerfile.spa для Angular bundles)
- **Dev**: `docker compose -f infra/docker-compose.yml up` — Postgres 16 (host port 55432), Redis 7, MinIO. Mailhog не подключён (тестовая почта пишется на реальный SMTP).
- **Staging / Prod**: docker-compose на VPS (`deploy/docker-compose.prod.yml`, nginx, scripts, ssh). Kubernetes — будущий M7.
- **CI/CD**: GitHub Actions, preflight без `DATABASE_URL`/`REDIS_URL` (выводятся из compose), deploy guardrail
- **CDN**: `cdn.takeaway.million-sales.ru` (через MinIO)
- **Secrets**: env-файлы в SSH-deploy. Doppler/Vault — потенциально M7.
- **Backup**: pg_dump в S3-compatible — план

### 2.5. Third-party — фактическое состояние

| Сервис            | Назначение                 | Статус                                                       |
| ----------------- | -------------------------- | ------------------------------------------------------------ |
| Stripe            | Платежи                    | ✅ Payment Intents + webhook                                 |
| SMTP (nodemailer) | Транзакционный email       | ✅ welcome, receipt, password reset                          |
| Web Push (VAPID)  | Push для web/PWA + TMA     | ✅ через `web-push`                                          |
| Telegram Bot API  | Уведомления rider/staff/cu | ✅ TG push + TMA initData auth + Telegram Login Widget       |
| MinIO + CDN       | Object storage             | ✅ brand logo, product images через `@aws-sdk/client-s3`     |
| iiko Cloud        | POS меню/stop-list/orders  | ✅ menu + stop-list (cron) + outgoing orders                 |
| Poster            | POS + outgoing orders      | ✅ menu/stop-list/orders/webhooks                            |
| Twilio (SMS OTP)  | SMS OTP                    | ❌ не подключено (customer auth идёт через Telegram)         |
| Firebase FCM      | Mobile push                | ❌ нужно для M6 (Flutter)                                    |
| Mapbox            | Карты / геокодинг          | ❌ не подключено (используем нативные браузерные карты пока) |
| Sentry / Mixpanel | Errors + product analytics | ❌ запланировано на M7                                       |

## 3. Функциональные требования

### 3.1. Модуль авторизации — фактически

Реализовано не так, как в исходном ТЗ — заходов несколько, под разные роли:

- **Customer на web**: три провайдера на выбор — **Google**, **Apple** и **Telegram Login Widget**. Пароля нет ни у одного. Каждый провайдер включается независимо: пустой client id в `index.html` просто прячет кнопку.
- **Customer в TMA**: **экрана входа нет вообще**. `initData` меняется на сессию в app-initializer до первого рендера; на 401 интерсептор молча ротирует refresh или пересоздаёт сессию из того же `initData`. Пользователь ни разу не видит слова «войти».
- **Staff** (`SUPER_ADMIN` / `BRAND_ADMIN` / `STORE_MANAGER` / `STAFF` / `RIDER`): **email + bcrypt password**. При инвайте админ выдаёт временный пароль, флаг `passwordMustChange = true` → forced /change-password при первом логине.
- **Password reset**: email-based one-shot токен (SHA-256 hash в `PasswordResetToken`).
- **Google / Apple**: ID-токен проверяется на сервере по JWKS провайдера — подпись RS256 (алгоритм зафиксирован, `alg` из заголовка не используется), `iss`, `aud` против собственных client id, `exp`. Ключи кешируются на час с обработкой ротации. Учётка привязывается через `OAuthAccount`; при совпадении **подтверждённого** email со существующим `CUSTOMER` аккаунт связывается (один профиль на все каналы), staff-аккаунты для такой привязки закрыты.
- **JWT + refresh tokens**, logout invalidates refresh.
- **Brand link**: `auth/telegram/link` — привязка TG к уже существующему staff-юзеру.
- Профиль: имя, email, телефон, дата рождения, фото, язык, валюта, notify-prefs (`notifyOrderUpdates`, `notifyPromotions`)
- Мультидевайсность через таблицу `Device` (push token, locale, lastSeenAt)
- **OTP / SMS**: не реализовано. Раньше это был единственный запасной путь для рынков без Telegram — Google и Apple его закрывают.

### 3.2. Каталог / меню

- Структура: **Категория → Подкатегория → Продукт → Вариации + Модификаторы**
- Категории: Coffee / Tea / Signature / Breakfast / Lunch / Desserts / Extras
- Карточка продукта:
  - Фото (несколько), описание, состав
  - Калории, БЖУ, аллергены
  - Базовая цена + диапазон цен с модификаторами
- **Вариации** (size, temperature, milk, cup): влияют на цену, могут быть связаны
- **Модификаторы** (shots, syrups, toppings): add-on с плюсом к цене, min/max count
- **Стоп-лист**: скрываем товар на конкретной точке в реальном времени
- **Сезонные спецпозиции** с датой начала/окончания
- **Доступность по времени**: завтраки до 12:00, например
- Фильтры: vegan, gluten-free, decaf, без сахара
- Поиск по меню

### 3.3. Точки продаж (stores)

- Список с картой (Mapbox)
- Адрес, координаты, часы работы (per weekday)
- Тип: takeaway / dine-in / drive-thru
- Текущий статус: открыта/закрыта/перегружена
- **Live-ETA**: для каждой точки рассчитывается «готово через X мин для ASAP-заказа» — видно в store locator ещё до открытия меню
- **Busy meter** (0–100%) — индикатор загрузки кухни, визуализируется цветом (зелёный / жёлтый / красный)
- **Pickup point type** для UI: counter / locker / shelf — определяет инструкции на экране готовности
- Привязка меню (не все точки имеют одинаковый ассортимент)
- Фото интерьера / витрины / pickup-зоны

### 3.4. Pre-order и чекаут (core flow)

**Главный механизм продукта. Вся UX-энергия направлена в этот флоу.**

- Корзина привязана к выбранной точке
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
  6. Оплата: Stripe Card / Apple Pay / Google Pay / Telegram Pay (только в TMA)
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
- После оплаты: генерация **order code** (4-значный) и **QR-кода** для получения
- **TTL неоплаченного заказа** (`ORDER_PAYMENT_TTL_MINUTES`, по умолчанию 15): раз в минуту `OrderExpiryService` переводит просроченные `CREATED` в `EXPIRED` и возвращает промокод, остаток подарочной карты и окно выдачи. То же освобождение выполняется при отмене заказа клиентом

### 3.5. Заказы и live-статус

- Статусы pickup-флоу: `CREATED` → `PAID` → `ACCEPTED` → `IN_PROGRESS` → `READY` → `PICKED_UP` / `CANCELLED` / `EXPIRED`
- Статусы delivery-флоу: после `READY` → `OUT_FOR_DELIVERY` → `DELIVERED` (см. 3.11)
- **Live-таймер ETA** на базе `currentEtaSeconds` точки + prep-time товаров
- Real-time через WebSocket (Socket.io); fallback polling — на стороне клиента
- **Уведомления** (web push + Telegram; SMS — резерв):
  - `PAID` — receipt email + push + welcome (для нового customer)
  - `READY` — push + Telegram (с order code и pickup инструкцией)
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

- **Push** (web/PWA/TMA): через **VAPID** (`web-push`), регистрация устройств в `Device`. FCM/APNS — для M6 Flutter.
- **Email**: nodemailer/SMTP — welcome (на первом PAID), receipt (на PAID), password reset.
- **Telegram bot**: пуши rider при назначении, brand staff при новом PAID-заказе, customer статусы заказов.
- **Per-user prefs**: `notifyOrderUpdates` + `notifyPromotions` через `PATCH /me/notifications`. Operational push (rider/brand staff) prefs не учитывает.
- **Marketing campaigns**: brand admin рассылает push/Telegram/email через `Campaign` (см. 3.9), audience: ALL / HAS_ORDERED / INACTIVE_30D.

### 3.9. Admin panel

- **Роли** (фактический enum): `SUPER_ADMIN`, `BRAND_ADMIN`, `STORE_MANAGER`, `STAFF`, `RIDER`, `CUSTOMER`. `ANALYST` из исходного ТЗ — нет, аналитика доступна `BRAND_ADMIN`/`SUPER_ADMIN`.
- **Brand registration + moderation**: бизнес заходит через `/business/register` → `Brand.moderationStatus = PENDING` → SUPER_ADMIN approve/reject с note. До approval бренд видит баннер модерации.
- **Menu management**: CRUD категорий / продуктов / вариаций / модификаторов, sort-order, visibility, stop-list per store. Массовые операции — точечно.
- **Store management**: inline editor (details + working hours), stop-list, **per-store delivery fee overrides**.
- **Staff roster**: `/admin/stores/:id/staff` (managers + kitchen) и `/admin/stores/:id/riders` — invite через временный пароль с force-rotate.
- **Orders**: `/admin/orders` живой фид. **Refund**: `POST /admin/orders/:id/refund` — full/partial Stripe refund, обновляет `Payment.refundedCents` + `PaymentStatus`, эмитит `REFUND_ISSUED` event с `actorId`. RBAC: SUPER_ADMIN — всё, BRAND_ADMIN — только свои бренды, STORE_MANAGER — только свои store-scope.
- **Promo / Gift cards**: CRUD + статусы.
- **Marketing campaigns**: composer + send (push/Telegram/email broadcast), счётчики target/sent/failed.
- **Analytics**: summary, revenue, top-products, cohort, stores. `mv_orders_daily` materialized view (PostgreSQL) с уникальным индексом `(brandId, storeId, day)` агрегирует non-CANCELLED orders и питает summary/revenue/stores; refresh каждые 5 минут через `AnalyticsRefreshService` (`REFRESH MATERIALIZED VIEW CONCURRENTLY`). top-products и cohort пока читают live `OrderItem`/`User`.
- **POS integrations**: connect (с шифрованными credentials AES-256-GCM), sync stores/menu/stop-list, мониторинг jobs.
- **Brand theme overrides**: `themeOverrides` JSON с CSS-переменными (применяется в TMA, опционально на web).
- **Multi-brand**: ✅ через `BrandScopeService` (BRAND_ADMIN видит только свой бренд).

### 3.10. KDS (экран баристы)

- Одно устройство на точку (iPad / Android tablet / браузер) — отдельное Angular-приложение `apps/kds`
- Авторизация: email + password (`auth/password/login`), а также **KDS PIN** (`auth/kds/pin`) — 4–6 цифр scoped to one store (только STAFF/STORE_MANAGER). PIN управляется brand admin'ом через `PUT/DELETE /admin/stores/:id/staff/:userId/kds-pin`. PIN хранится как HMAC-SHA256(storeId+pin) с server secret `KDS_PIN_SECRET`. UI lockscreen в `apps/kds` — отдельный заход, API готов.
- Колонки: фид через `GET /kds/orders` + статус-переходы `accept` → `start` → `ready` → `picked-up`
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
Device (id, userId, type[WEB|TMA|IOS|ANDROID], pushToken?, locale, lastSeenAt)
OAuthAccount (id, userId, provider[GOOGLE|APPLE|TELEGRAM], providerUserId)
PasswordResetToken (id, userId, tokenHash, expiresAt, consumedAt?)
Referral (id, referrerId, refereeId, status[PENDING|REWARDED|CANCELLED], rewardOrderId?,
          referrerPointsCredited, refereePointsCredited)
```

### 5.2. Tenancy / Stores

```
Brand (id, slug, name, currency, locale, logoUrl?, themeOverrides?, ownerId?,
       moderationStatus[PENDING|APPROVED|REJECTED], moderationNote?)
Store (id, brandId, slug, name, address, lat, lng, timezone, currency,
       status[OPEN|CLOSED|BUSY|PAUSED], fulfillmentTypes[], pickupPointType[COUNTER|SHELF|LOCKER],
       busyMeter, baseEtaSeconds, kitchenParallelism, slotCapacity, minOrderCents,
       taxRateBps, taxIncludedInPrice,
       deliveryFeeBaseCents?, deliveryFeePerKmCents?, deliveryFreeRadiusM?, deliveryMaxRadiusM?,
       externalProvider?[POSTER|IIKO], externalId?)
UserStore (userId, storeId)              // pivot: scope STAFF/RIDER/STORE_MANAGER на конкретные точки
StoreWorkingHour (storeId, weekday[0..6], opensAt, closesAt, isClosed)
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
           prepTimeDeltaSeconds, isDefault)
Modifier (id, productId, slug, name, priceDeltaCents, prepTimeDeltaSeconds,
          minCount, maxCount, externalProvider?, externalId?)
StopListEntry (id, storeId, productId, reason?, expiresAt?)
```

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
       couponCode?, giftCardCode?, giftCardCents,
       deliveryAddress*?, deliveryLat?, deliveryLng?, deliveryFeeCents, deliveryDistanceM?,
       riderId?,                                                   // FK → User (RIDER)
       posExternalId?,                                             // iiko/Poster order id
       acceptedAt?, startedAt?, readyAt?, pickedUpAt?,
       outForDeliveryAt?, deliveredAt?, cancelledAt?, expiredAt?)
OrderItem (id, orderId, productSnapshot (json), quantity, unitPriceCents, totalCents)
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
          targetCount, sentCount, failedCount, scheduledAt?, sentAt?)
```

### 5.6. Analytics (materialized views)

```
mv_orders_daily (brandId, storeId, day, orderCount, revenueCents,
                 slaHits, slaTotal, pickupSecSum, pickupSecCount)
  unique (brandId, storeId, day)
  refreshed every 5 min via REFRESH MATERIALIZED VIEW CONCURRENTLY
```

Источник: `Order` join `Store` для не-`CANCELLED` заказов, агрегация по UTC-дню. SLA-hit считается при readyAt − coalesce(acceptedAt, createdAt) ≤ 7 минут. Pickup-длительность — readyAt → pickedUpAt. Питает endpoints `/admin/analytics/{summary,revenue,stores}`.

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
POST   /auth/telegram                { initData } → tokens           (TMA)
POST   /auth/telegram/widget         { ...telegramAuthWidgetPayload } → tokens
POST   /auth/telegram/link           { initData }                    (auth, привязка TG к существующему юзеру)
POST   /auth/refresh                 { refreshToken }
POST   /auth/logout
GET    /auth/me
```

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
```

### 6.3. Catalog

```
GET    /stores?lat=&lng=&radius=     // включает currentEtaSeconds, busyMeter
GET    /stores/:idOrSlug
GET    /stores/:idOrSlug/menu        (категории + продукты + variations + modifiers + stop-list)
GET    /products/:idOrSlug
GET    /stores/:idOrSlug/pickup-slots  → 15-минутные окна выдачи на 12 часов вперёд
```

### 6.4. Cart / Order / Payment

```
GET    /cart
POST   /cart/items                   { productId, quantity, variationIds[], modifiers{} } → { cart, etaSeconds }
PATCH  /cart/items/:itemId
DELETE /cart/items/:itemId
DELETE /cart

POST   /orders                       { cartId, pickupMode, pickupAt?, couponCode?, giftCardCode?, fulfillmentType, deliveryAddress? } → { id, orderCode, qrToken, etaSeconds }
GET    /orders/:id
POST   /orders/:id/cancel
POST   /orders/:id/location          { lat, lng }  // геофенсинг (триггер «I'm here» при попадании в радиус)

POST   /payments/intent              { orderId } → { clientSecret }
POST   /payments/webhook             (Stripe)
```

### 6.5. Promo / Gift cards / Loyalty

```
POST   /promo/validate               { code, cartId }
POST   /promo/preview                { code, cartId } → { discountCents, finalTotalCents }
POST   /gift-cards/validate          { code, cartId } → { balanceCents, applicableCents }
GET    /loyalty                      → { balance, tier, lifetimePoints, recentEntries[] }
```

### 6.6. Devices (web push)

```
GET    /devices/vapid-public-key
POST   /devices                      { type, pushToken, locale }
DELETE /devices                      { pushToken }
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
POST   /business/register            { brand, contact, ... } → { brand: { moderationStatus: PENDING } }
GET    /my-brand                     (BRAND_ADMIN)
PATCH  /my-brand                     (PATCH-только для approved брендов)
POST   /my-brand/logo                (multipart → S3/MinIO)
```

### 6.9. Admin (JWT + RBAC: SUPER_ADMIN / BRAND_ADMIN / STORE_MANAGER)

```
# Каталог (scope to brand для BRAND_ADMIN)
GET/POST/PATCH                       /admin/brands[, /:id, /:id/moderation]
GET/POST/PATCH/DELETE  /admin/categories[/:id]      + PATCH /admin/categories/reorder
GET/POST/PATCH/DELETE  /admin/products[/:id]        + PATCH /admin/products/:id/visibility
                                                    + POST/PATCH/DELETE /admin/products/:id/variations[/...]
                                                    + POST/PATCH/DELETE /admin/products/:id/modifiers[/...]
GET/POST/PATCH/DELETE  /admin/stores[/:id]
PUT                    /admin/stores/:id/working-hours
GET/POST/DELETE        /admin/stores/:id/stop-list[/:productId]

# Staff / Riders (per-store scope)
GET/POST/DELETE        /admin/stores/:storeId/staff[/:userId]
PUT/DELETE             /admin/stores/:storeId/staff/:userId/kds-pin   { pin }
GET/POST/DELETE        /admin/stores/:storeId/riders[/:userId]

# Orders / Promo / Gift cards / Campaigns
GET                    /admin/orders                     (фильтрация по store/brand/status)
POST                   /admin/orders/:id/refund          { amountCents?, reason?, note? } → Stripe refund (full/partial)
GET/POST/PATCH         /admin/promo[/:id/status]
GET/POST/DELETE        /admin/gift-cards[/:id]
GET/POST               /admin/campaigns
POST                   /admin/campaigns/:id/send         (синхронный fan-out)
DELETE                 /admin/campaigns/:id

# Аналитика
GET                    /admin/analytics/summary
GET                    /admin/analytics/revenue
GET                    /admin/analytics/top-products
GET                    /admin/analytics/cohort
GET                    /admin/analytics/stores

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
GET    /kds/orders
POST   /kds/orders/:id/accept
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
GET    /config/features              → { features: { campaigns, giftCards, referrals, ... } }
```

### 6.13. WebSocket

```
WS     /ws                          (события: order.statusChanged, order.etaUpdated,
                                              order.customerNearby, order.riderAssigned,
                                              store.stopList, store.busyMeter,
                                              pos.syncJob.progress, notification)
```

OpenAPI 3.1 (через `@nestjs/swagger`) — источник правды, от него генерируется типизированный клиент `libs/api-client` для Angular. Для Flutter (M6) тот же контракт через `openapi-generator`.

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

### M6 — Mobile apps (Flutter) 🟡 (kickoff)

PR-разбивка зафиксирована в `apps/mobile/README.md`:

- **PR1** bootstrap: `flutter create`, CI `flutter analyze && flutter test`
- **PR2** Dart API client: генерация из OpenAPI через `openapi-generator-cli` (template `dart-dio`), Dio interceptors auth/refresh
- **PR3** Auth: Telegram deep-link + email+password fallback, secure storage refresh token
- **PR4** Каталог + cart с live-ETA
- **PR5** Чекаут + Stripe PaymentSheet (Apple Pay / Google Pay)
- **PR6** Order status: Socket.io live, QR + I'm here
- **PR7** Push: Firebase FCM/APNS + `/devices` registration, deep-links
- **PR8** Profile/orders history + store submission

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
