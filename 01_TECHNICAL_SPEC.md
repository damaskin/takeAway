# takeAway — Technical Specification (MVP)

> **Ключевая механика продукта — pre-order first.** Клиент делает предзаказ, следит за ETA и статусом, приходит к готовому заказу и забирает без очереди. Все архитектурные и UX-решения подчинены этой механике. Курьерская доставка — опциональная фича в v1.5, не входит в core MVP.

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

```
User (id, phone, email, name, locale, currency, tgUserId, createdAt)
Device (id, userId, type, token, locale)
Store (id, brandId, name, address, geo, workingHours, status, pickupPointType, busyMeter, currentEtaMinutes)
Category (id, storeId|brandId, name, order, availableFrom, availableTo)
Product (id, categoryId, name, description, basePrice, images, nutrition, tags, prepTimeSeconds)
Variation (id, productId, type[size|temp|milk], name, priceDelta, prepTimeDeltaSeconds)
Modifier (id, productId, name, priceDelta, minCount, maxCount, prepTimeDeltaSeconds)
Cart (id, userId, storeId, items, etaMinutes, updatedAt)
CartItem (id, cartId, productId, variations[], modifiers[], quantity, notes)
Order (id, userId, storeId, items, subtotal, discount, tax, total, status, pickupMode[ASAP|SCHEDULED], pickupAt, orderCode, qrToken, paymentIntentId, createdAt, acceptedAt, startedAt, readyAt, pickedUpAt, expiredAt)
OrderItem (id, orderId, product snapshot json, quantity, price)
OrderEvent (id, orderId, type, actorId, payload, createdAt)  // audit trail для статусов и геофенс-событий
Payment (id, orderId, provider, intentId, status, amount, currency, refunds[])
LoyaltyAccount (userId, balance, tier, tierProgress)
LoyaltyTxn (id, userId, delta, reason, orderId)
Coupon (code, type, value, validFrom, validTo, usageLimit, perUserLimit)
Subscription (id, userId, planId, status, stripeSubId)
GiftCard (code, amount, balance, senderId, recipientEmail, status)
Notification (id, userId, channel, type, payload, readAt)
```

## 6. API Contract (основные endpoints)

```
POST   /auth/otp/send                { phone }
POST   /auth/otp/verify              { phone, code } → { accessToken, refreshToken }
POST   /auth/oauth/:provider
POST   /auth/telegram                { initData } → tokens
POST   /auth/refresh
POST   /auth/logout

GET    /me
PATCH  /me
GET    /me/orders
GET    /me/loyalty

GET    /stores?lat=&lng=&radius=     // включая currentEtaMinutes и busyMeter
GET    /stores/:id
GET    /stores/:id/eta               // точный ETA для заданного cart

GET    /stores/:id/menu              (категории + продукты + модификаторы)
GET    /products/:id

POST   /cart                         // upsert, возвращает etaMinutes
GET    /cart
DELETE /cart/items/:itemId

POST   /orders                       { cartId, pickupMode, pickupAt?, couponCode? } → { id, orderCode, qrToken, etaMinutes }
GET    /orders/:id
POST   /orders/:id/im-here           // ручной триггер «клиент у точки»
POST   /orders/:id/location-update   { lat, lng } // для геофенсинга (опционально)
POST   /orders/:id/cancel
POST   /orders/:id/refund            (admin)

POST   /payments/intent              { orderId }
POST   /payments/webhook             (Stripe)

POST   /coupons/validate             { code, cartId }

POST   /loyalty/redeem               { orderId, points }

WS     /ws                          (события: order.statusChanged, order.etaUpdated, order.customerNearby, store.stopList, store.busyMeter, notification)

/admin/*                             (отдельный набор под JWT + RBAC)
/kds/*                               (для экрана баристы)
```

OpenAPI 3.1 — источник правды, от него генерируется типизированный клиент для Angular и Flutter.

## 7. Этапы разработки (дорожная карта)

### M0 — Фундамент (fundament)

- Монорепо (pnpm + Nx)
- docker-compose (pg, redis, minio, mailhog)
- NestJS скелет, Prisma-схема, первые миграции
- GitHub Actions CI (lint, test, build)
- Angular скелеты для web / tma / admin / kds

### M1 — Auth + Catalog

- OTP auth, JWT
- CRUD меню в admin
- Публичное API каталога
- Web: экраны каталога, карточки продукта
- TMA: адаптация под Telegram

### M2 — Pre-order core (Cart + Checkout + Live status)

- Cart sync между устройствами с live-ETA
- Чекаут с выбором точки и pickup time (ASAP / scheduled)
- Stripe Payment Intents + webhook
- Order creation с генерацией order code + QR
- Live-status экран: WebSocket, таймер ETA, push-уведомления
- Геофенсинг «я в пути» (опционально в M2, обязательно в M3)
- KDS: базовая панель с dual-timer, колонки NEW/IN_PROGRESS/READY

### M3 — Лояльность

- Loyalty accounts, начисление/списание
- Промокоды
- Подарочные карты
- Рефералка

### M4 — Push / Email / Telegram

- FCM push для web (VAPID) и TMA
- Email templates (welcome, receipt)
- Telegram bot для уведомлений

### M5 — Admin panel расширенная

- Аналитика (через materialized views)
- Маркетинговые кампании
- Multi-store управление

### M6 — Mobile apps (Flutter)

- Копия web-функционала
- Push, Apple/Google Pay, biometric auth
- Публикация в App Store / Google Play

### M7 — Scale & polish

- Наблюдаемость, алерты
- Load testing
- A/B testing framework
- White-label / multi-tenant

## 8. Вне скоупа MVP

- **Курьерская доставка** — опциональная фича на v1.5, не входит в core pre-order MVP
- Dine-in заказы с обслуживанием за столом (только базовый dine-in pickup)
- Собственный POS-терминал
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
