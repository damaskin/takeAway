# takeAway — Technical Specification (MVP)

> **Ключевая механика продукта — pre-order first.** Клиент делает предзаказ, следит за ETA и статусом, приходит к готовому заказу и забирает без очереди. Все архитектурные и UX-решения подчинены этой механике. Курьерская доставка добавлена как полноценный второй канал получения (см. секцию 7 и 0.2).

## 0. Текущее состояние реализации

> Синхронизируется при каждом значимом изменении кода/инфры/roadmap. Источник истины — `git log` + структура `apps/`/`libs/` + `docs/`.

**Стадия:** активная разработка, релиз `v0.5.0-pos-integrations`. Локальный snapshot — после коммита `83adc1a` (2026-04-20+).

### 0.1. Прогресс по milestones

| Milestone                        | Статус | Комментарий                                                                                                          |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| **M0** Фундамент                 | ✅     | Nx + pnpm 10, Node 22+, docker-compose (pg, redis, MinIO, mailhog), NestJS 11 + Prisma 6, Angular 21 (web/tma/admin/kds), CI |
| **M1** Auth + Catalog            | ✅     | OTP + password + OAuth (Google/Apple/Telegram), JWT + refresh, CRUD меню, публичный каталог, web/TMA-экраны          |
| **M2** Pre-order core            | ✅     | Cart sync, чекаут с ASAP/scheduled, Stripe Payment Intents + webhook, order code + QR, live-status (Socket.io), KDS dual-timer, geofencing «I'm here» |
| **M3** Лояльность                | ✅     | LoyaltyAccount + txn, промокоды, gift cards, рефералы (бонус с первого оплаченного заказа обеим сторонам)            |
| **M4** Push / Email / Telegram   | ✅     | Web push (VAPID) + `/devices`, transactional email через nodemailer/SMTP (welcome, receipt), Telegram push на rider/brand staff |
| **M5** Admin расширенный         | 🟡     | Аналитика, marketing campaigns broadcast, multi-store fee overrides, staff roster + invites, password rotation. Materialized views для аналитики не во всех модулях |
| **M6** Mobile (Flutter)          | ❌     | Не начато                                                                                                            |
| **M7** Scale & polish            | ❌     | Только базовые health-эндпоинты и preflight в CI                                                                     |

### 0.2. Треки за пределами оригинального ТЗ

| Трек                              | Статус | Комментарий                                                                                                       |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| **POS integrations**              | 🟡     | iiko Cloud + Poster, pluggable через `IPosProvider`. Poster: import + stop-list (M2), outgoing orders (M3), webhooks (M4). iiko — M5+ pending. AES-256-GCM для credentials. См. `docs/integrations.md`. |
| **Multi-brand SaaS**              | ✅     | Brand registration + moderation (banners, rejection notes), `BrandScopeService` для scope-проверок, brand-themed UI overrides, BRAND_ADMIN роль с ограничением catalog-эндпоинтов |
| **Delivery (расширена с v1.5)**   | 🟡     | TMA geolocation для доставки, scheduled delivery, riders + dispatch admin UI, per-store fee overrides, Telegram push rider при назначении. Не курьерская сеть — модель «бренд организует своего курьера». |
| **Storage / CDN**                 | ✅     | MinIO (S3-compatible) bundled в инфре + `cdn.takeaway.million-sales.ru`, brand logo uploader                       |
| **Notifications prefs**           | ✅     | Per-user prefs: order updates / promotions, force password rotation для invited staff                              |

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

### 2.1. Frontend (Angular)

- **Angular 21+** со standalone components и signals
- **State**: NgRx Signal Store (или Akita для более простого API)
- **UI Kit**: Tailwind CSS 4 + собственные компоненты, потом расширяем через CDK
- **Forms**: Reactive Forms + Zod-подобная валидация через `@angular/forms` + `zod`
- **HTTP**: HttpClient + interceptors (auth, retry, error handling)
- **Router**: Angular Router с lazy loading
- **i18n**: `@ngx-translate/core` (JSON-словари, легко добавлять языки)
- **PWA**: Angular Service Worker, offline catalog cache
- **Telegram Mini App**: `@twa-dev/sdk` или нативный `window.Telegram.WebApp`
- **Realtime**: Socket.io client для статусов заказов
- **Analytics**: Mixpanel SDK + Sentry SDK
- **Build**: Vite через Angular ESBuild (ng build --configuration=production)

### 2.2. Backend (NestJS)

- **NestJS 11** (TypeScript, Fastify adapter для скорости)
- **Database**: PostgreSQL 16 + **Prisma** (type-safe, миграции, отличный DX)
- **Cache / session / rate limit**: Redis 7
- **Queue**: BullMQ (на Redis) для уведомлений, email, webhook
- **Realtime**: `@nestjs/websockets` + Socket.io
- **Auth**: JWT (access 15m) + refresh tokens (7d, в Redis), Passport strategies
- **OAuth**: Google, Apple, Telegram (для TMA)
- **Validation**: `class-validator` + `class-transformer` + DTO
- **OpenAPI**: `@nestjs/swagger` — авто-генерация клиента для фронта
- **Payments**: Stripe SDK (Payment Intents, Setup Intents, Customer)
- **Storage**: Cloudflare R2 (S3-compatible) через `@aws-sdk/client-s3`
- **Email**: Mailgun / Postmark через API
- **SMS OTP**: Twilio / MessageBird
- **Push**: Firebase Admin SDK (FCM) + APNS
- **Logs**: Pino structured logs → Loki
- **Monitoring**: Sentry (errors) + Prometheus (metrics) + Grafana

### 2.3. Mobile (v2)

- **Flutter 3.x** (Dart)
- **State**: Riverpod 2
- **Networking**: Dio + Retrofit (сгенерированный клиент из OpenAPI)
- **Storage**: Isar / Hive
- **Push**: `firebase_messaging`
- **Auth**: `google_sign_in`, `sign_in_with_apple`
- **Maps**: `google_maps_flutter` или `mapbox_gl`
- **Payments**: `flutter_stripe`

### 2.4. Инфраструктура

- **Runtime**: Docker контейнеры
- **Dev**: docker-compose (Postgres, Redis, MinIO, Mailhog, api)
- **Staging / Prod**: Kubernetes (k3s / Hetzner) или Render / Railway на старте
- **CI/CD**: GitHub Actions → build, test, lint, docker push, deploy
- **CDN**: Cloudflare
- **Secrets**: Doppler / 1Password / Vault
- **DNS**: Cloudflare
- **Backup**: daily pg_dump → S3, 30d retention

### 2.5. Third-party

| Сервис           | Назначение               | Почему                             |
| ---------------- | ------------------------ | ---------------------------------- |
| Stripe           | Основной процессинг      | Глобальный охват, Apple/Google Pay |
| Twilio           | SMS OTP                  | Глобально, API стабильное          |
| Firebase         | Push (FCM) + Crashlytics | Бесплатно, стандарт                |
| Mapbox           | Карты, геокодинг         | Дешевле Google, кастомные стили    |
| Mailgun          | Транзакционный email     | Хорошая deliverability             |
| Sentry           | Ошибки и perf            | Поддержка Angular, NestJS, Flutter |
| Mixpanel         | Продуктовая аналитика    | Воронки, когорты, ретеншн          |
| Telegram Bot API | Уведомления + TMA        | Критично для Telegram канала       |

## 3. Функциональные требования

### 3.1. Модуль авторизации

- Регистрация/логин по телефону с OTP (SMS)
- Социальный вход: Google, Apple
- Авторизация в TMA через `initData` (HMAC проверка)
- JWT + refresh tokens, logout invalidates refresh
- Профиль: имя, email, телефон, дата рождения, фото, язык, валюта
- Мультидевайсность

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
- **Расчёт времени готовности на лету**: при добавлении каждого товара бэкенд возвращает обновлённый ETA исходя из:
  - Текущей загрузки точки (очередь заказов в KDS)
  - Сложности состава (модификаторы влияют на время приготовления)
  - Количества баристов онлайн
- **Pickup time picker** — ключевой элемент чекаута:
  - `ASAP` (готово через ~X мин, таймер показывается крупно)
  - `Scheduled` — выбор конкретного времени из доступных слотов с 5-минутным шагом
  - Скользящее окно 15 мин до 24 ч вперёд
  - Для ASAP — показываем погрешность (±2 мин)
- Чекаут:
  1. Выбор точки (если не выбрана) — с показом «готово через X мин»
  2. **Pickup time** (ASAP / scheduled) — центральный элемент
  3. Контакт: имя на заказе + телефон для SMS-подтверждения
  4. Промокод / применение баллов
  5. Комментарий к заказу
  6. Оплата: Stripe Card / Apple Pay / Google Pay / Telegram Pay (только в TMA)
- Тип получения: `PICKUP` (default), `DINE_IN` (secondary, если точка поддерживает), `DELIVERY` (v1.5, вне core MVP)
- Минимальная сумма заказа (конфигурируется per store)
- Расчёт итога: subtotal − discount + taxes = total
- VAT по точке (разные страны)
- После оплаты: генерация **order code** (4-значный) и **QR-кода** для получения

### 3.5. Заказы и live-статус

- Статусы: `CREATED` → `PAID` → `ACCEPTED` → `IN_PROGRESS` → `READY` → `PICKED_UP` / `CANCELLED` / `EXPIRED`
- **Live-таймер ETA** — пересчёт каждые 10 секунд на основе данных с KDS
- Real-time обновление через WebSocket + fallback polling каждые 15 сек
- **Уведомления** (push + Telegram + SMS в критичных случаях):
  - `PAID` — «Заказ принят, готовим к 8:35»
  - `IN_PROGRESS` — «Твой кофе уже делают ☕»
  - `READY` — «Заказ готов. Код: 4832. Отсек B3» (с deep-link на карту)
  - `PICKED_UP` — чек + «Оставь отзыв»
  - `LATE` (клиент опаздывает к своему времени) — «Твой заказ ждёт тебя, ETA?»
- **Geofencing**: при входе в радиус 300м от точки триггер отправляет на KDS сигнал «клиент в пути» — бариста может начать готовить ASAP-заказ
- **Order code & QR** — 4-значный код и QR на экране статуса, можно показать бариста или отсканировать на pickup-терминале
- **I'm here** кнопка — ручная альтернатива геофенсингу: «я у двери, начинайте»
- История заказов с фильтрами
- «Повторить заказ» одной кнопкой (с новым pickup time)
- Отмена заказа возможна только до `IN_PROGRESS` (с автоматическим возвратом)
- Если клиент не пришёл через N минут после `READY` → статус `EXPIRED`, отправка предупреждения, конфигурируемая политика утилизации/hold
- Refund через Stripe API (частичный/полный)
- Чек/квитанция в PDF по email

### 3.6. Программа лояльности

- **Баллы**: X% с каждой покупки (настраивается), списание при оплате (1 балл = 1 валюта)
- **Уровни**: Bronze / Silver / Gold / Platinum по сумме покупок за 3 месяца
- **Бонусы уровней**: повышенный кэшбек, ранний доступ к новинкам, бесплатная доставка (v2)
- **Купоны и промокоды**: процент / фикс / N-й бесплатно / на конкретный товар
- **Рефералка**: инвайт-ссылка → бонус обоим при первой покупке
- **Подписки (Coffeepass)**: N напитков в день за фикс/месяц, отдельная ветка заказов
- **Геймификация**: челленджи ("5 эспрессо за неделю → бесплатный круассан")

### 3.7. Подарочные карты

- Номинал на выбор
- Дизайн (шаблон + фото пользователя, как у Drinkit)
- Отправка по email / ссылка + сообщение
- Активация через код, пополнение кошелька получателя
- Интеграция со Stripe как payment method

### 3.8. Уведомления

- Push (FCM + APNS): статусы заказов, маркетинг, стоп-лист
- Email: чеки, welcome, reset password, маркетинг
- Telegram bot: статусы заказов для TMA-пользователей
- Управление подписками пользователя на каналы

### 3.9. Admin panel

- Роли: `SUPER_ADMIN`, `BRAND_ADMIN`, `STORE_MANAGER`, `STAFF`, `ANALYST`
- **Menu management**: CRUD категорий / продуктов / вариаций / модификаторов, массовое изменение цен, копирование между точками
- **Store management**: CRUD точек, часы работы, стоп-лист, принтеры
- **Orders**: живой фид заказов, поиск, refund
- **Promo / loyalty**: создание купонов, настройка уровней, подписок
- **Gift cards**: выпуск, отчёты
- **Users**: поиск, блокировка, ручная выдача баллов
- **Analytics**: revenue, orders per hour, AOV, top items, retention, funnel
- **Content**: баннеры на главной, push-кампании, пуш по сегментам
- **Franchise (v2)**: multi-tenant, отдельные бренды

### 3.10. KDS (экран баристы)

- Одно устройство на точку (iPad / Android tablet / браузер)
- Авторизация по PIN / QR
- Колонки: `NEW` / `IN PROGRESS` / `READY`
- Drag between или кнопки "В работу → Готово"
- Звук при новом заказе
- **Dual timer на карточке**:
  - Время до pickup (обещанное клиенту) — основной
  - Время с момента принятия — вспомогательный
  - Цветовая индикация: зелёный (в запасе), жёлтый (пора начать), красный (опаздываем)
- **Customer proximity alerts**:
  - «Клиент в пути» (геофенсинг 300м)
  - «Клиент у двери» (ручное `I'm here` + геофенсинг 50м)
- **Order code** и номер отсека отображаются большим шрифтом для быстрой сортировки
- Отображение комментариев, имени клиента, способа получения
- Отдельная колонка `READY` с именами клиентов и обратным таймером до pickup
- Печать на кухонный принтер (v2)

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
      notifyOrderUpdates, notifyPromotions, blockedAt?, referralCode?, referredByUserId?)
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
       busyMeter, currentEtaSeconds, minOrderCents,
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
       paymentIntentId?, customerName?, customerPhone?, notes?,
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

### 5.6. POS integrations

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

> Источник истины — контроллеры в `apps/api/src/app/**/*.controller.ts`. OTP-вход в исходном ТЗ заявлен, но в текущей реализации customer заходит через Telegram (TMA initData / widget), а staff/RIDER — через email + password (с force-rotate при инвайте).

### 6.1. Auth & Identity

```
POST   /auth/password/login          { email, password } → tokens
POST   /auth/password/forgot         { email }
POST   /auth/password/reset          { token, password }
POST   /auth/password/change         { oldPassword, newPassword }    (auth)
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
GET/POST/DELETE        /admin/stores/:storeId/riders[/:userId]

# Orders / Promo / Gift cards / Campaigns
GET                    /admin/orders                     (фильтрация по store/brand/status)
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
GET    /health                       → { status, db, redis, queues }
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

### M6 — Mobile apps (Flutter) ❌

- Копия web-функционала
- Push, Apple/Google Pay, biometric auth
- Публикация в App Store / Google Play

### M7 — Scale & polish ❌

- Наблюдаемость, алерты
- Load testing
- A/B testing framework
- White-label / multi-tenant (часть multi-brand уже в проде, см. секцию 0.2)

### Доп. треки (вне исходного roadmap)

- **POS integrations** 🟡 — iiko + Poster (см. `docs/integrations.md`). Сделано: Poster menu/stop-list (M2), outgoing orders (M3), webhooks (M4). Pending: iiko M5+ poll/orders.
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
