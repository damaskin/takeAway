# takeAway — Design Brief for pencil.dev

Этот промт передать pencil.dev (или использовать как ввод для MCP `pencil`) для генерации дизайна продукта.

---

## Кратко о продукте

**takeAway** — глобальная цифровая платформа для заказа кофе и еды навынос. Пользователь открывает приложение, выбирает ближайшую точку, кастомизирует напиток или еду, платит и забирает заказ без очереди. Референс — **Drinkit** (drinkit.io), но с расширенным меню (кофе + завтраки + ланчи + десерты) и фокусом на omnichannel.

Целевая аудитория: городские профессионалы 22–40, студенты, цифровые кочевники в крупных городах мира (Dubai, London, Lisbon, Bangkok, Bali).

Надо спроектировать дизайн для четырёх поверхностей:
1. **Web / PWA** (adaptive, desktop + mobile browser)
2. **Telegram Mini App** (mobile portrait, Telegram chrome)
3. **Back office / Admin panel** (desktop first)
4. **KDS — экран баристы** (tablet landscape)

Нативные iOS / Android приложения в скоупе v2 — их дизайн пока не нужен, но дизайн-система должна масштабироваться.

## Бренд и настроение

- **Tone of voice**: дружелюбный, уверенный, минималистичный, ускоряющий
- **Вайб**: современная европейская кофейня, матовые поверхности, тёплое освещение, немного urban-tech
- **Настроение пользователя**: «Я тороплюсь, но хочу получить кайф от кофе»
- **Главная эмоция на экранах**: лёгкость и предвкушение
- **Анти-паттерны**: никакого кричащего color blocking, никаких корпоративных синих градиентов, никакого «еда доставка Яндекс стиля» с перегруженными карточками

## Визуальный язык

### Цвета
Основа:
- **Espresso** `#1A1414` — primary text, dark surfaces
- **Cream** `#F8F3EB` — основной background, тёплый беж
- **Latte** `#E8DDCB` — surface-variant, карточки
- **Caramel** `#C77D3B` — accent, кнопки, активные состояния
- **Foam** `#FFFFFF` — чистые поверхности поверх Cream
- **Mint** `#7BC4A4` — success, ready-статусы
- **Berry** `#D94B5E` — error, stop-lists
- **Amber** `#E9A84B` — warning, in-progress статусы

Поддерживающая палитра (для категорий меню):
- Coffee — Espresso + Caramel
- Tea — Matcha green `#9DB87E`
- Signature — Purple `#8E5FB0`
- Breakfast — Egg yellow `#F5C95C`
- Lunch — Terracotta `#C86A4B`
- Desserts — Pink `#E8A0B4`

### Тёмная тема
- Background `#0E0B0A`
- Surface `#1C1817`
- Surface-variant `#2A2523`
- Text primary `#F8F3EB`
- Accent остаётся Caramel `#C77D3B`

### Типографика
- Заголовки: **Fraunces** (modern serif, характер, немного художественный)
- Интерфейс и body: **Inter** (чистый, читаемый, современный)
- Цифры таймеров и KDS: **JetBrains Mono** или tabular-nums Inter
- Размеры (desktop base 16px):
  - display 48/56, h1 36/44, h2 28/36, h3 22/28, body 16/24, small 14/20, micro 12/16
- Mobile base 14px со скейлингом

### Углы, тени, сетка
- **Радиусы**: cards 20px, buttons 14px, inputs 12px, chips 999 (pill)
- **Тени**: мягкие, тёплые, низкий blur. Основная — `0 6px 20px rgba(26, 20, 20, 0.06)`
- **Сетка**: 8pt baseline, основные отступы `4/8/12/16/24/32/48/64`
- **Контейнер**: max-width 1200 на desktop, 16–20 padding на mobile

### Иконки
- Стиль: outlined, stroke 1.5, rounded ends
- Набор: **Lucide** (line icons)
- Размеры: 16, 20, 24, 32

### Иллюстрации и фото
- **Фото продуктов**: студийные, на светлом бежевом фоне, тёплый свет, top-down и 3/4
- **Иллюстрации**: лёгкий hand-drawn линейный стиль с caramel-акцентами для пустых состояний и онбординга
- Без стоковых "бизнес-людей" и ярких градиентов

## Экраны и флоу

### A. Web / PWA (адаптивный)

#### A1. Landing / Home
- **Hero**: большой заголовок «Coffee & Food to-go in 30 seconds», подзаголовок, 2 CTA (`Order now` primary / `Download app` secondary), анимированное фото чашки или 3D рендер
- **Store locator**: мини-карта с ближайшими точками, чипы «Open now», "2 min walk"
- **Menu highlights**: горизонтальная карусель категорий с превью продуктов
- **How it works**: 3 шага с иллюстрациями — Pick / Customize / Pick up
- **Loyalty teaser**: блок про Coffeepass и баллы
- **Gift cards teaser**
- **Footer**: соцсети, franchise CTA, join the team, legal

#### A2. Menu / Catalog
- Слева sticky-сайдбар категорий (desktop) / горизонтальные табы (mobile)
- Сверху: выбранная точка + кнопка сменить + чипы фильтров (vegan, gluten-free, decaf, новинки)
- Сетка карточек: фото 4:3, название, короткое описание, цена «from $X», теги (vegan / new / caffeine level)
- Hover на карточке: лёгкий lift, появляется кнопка `+`
- Пустое состояние для стоп-листа

#### A3. Product detail (модалка или отдельная страница)
- Большое фото слева (desktop) / сверху (mobile)
- Название, цена (обновляется в реальном времени с модификаторами), описание, калории, аллергены
- **Variations**: табы / сегменты для Size, Temperature, Milk, Cup
- **Modifiers**: списки с стэпперами для Shots, Syrups, Toppings, min/max подписаны
- Caffeine level индикатор (0–4 чашки)
- **Special instructions** textarea
- **Add to cart** pill-button снизу, с итоговой суммой и количеством
- Related products внизу

#### A4. Cart / Drawer
- Slide-over справа на desktop, full-screen на mobile
- Выбранная точка + ETA («~5 min»)
- Список позиций с превью, миниатюрами модификаторов, стэппером, кнопкой delete
- Upsell: «Add a croissant for $3»
- Промокод-филд
- Итог: subtotal, discount, taxes, total
- `Checkout` primary button

#### A5. Checkout
- Шаги визуально: Store → Time → Payment
- **Store**: карточка + смена точки
- **Time**: ASAP / scheduled (picker времени)
- **Contact**: имя на заказе + телефон
- **Payment methods**: Apple Pay / Google Pay кнопки сверху, ниже карточки Stripe + save card checkbox
- **Summary**: sticky правая колонка (desktop) / нижний sheet (mobile)
- `Pay $X.XX`

#### A6. Order status
- Full screen progress:
  - Animated illustration чашки на каждом этапе
  - 4 шага: Received → Preparing → Ready → Picked up
  - Таймер обратного отсчёта
- Детали заказа раскрываются
- `Cancel order` доступен до Preparing
- `Reorder` после Picked up

#### A7. Orders history
- Список по дням, каждая карточка — превью товаров, сумма, точка, статус-бейдж
- Tap → детали
- `Reorder` в каждой карточке

#### A8. Profile
- Аватар, имя, телефон, баллы и tier как hero-карточка
- Разделы: Personal info, Payment methods, Addresses, Subscriptions, Gift cards, Language, Notifications, Logout
- Tier progress bar (Bronze → Silver → Gold → Platinum)

#### A9. Loyalty
- Верхний баланс баллов
- Уровень + прогресс до следующего
- Coupons/promos карусель
- Referral block «Invite a friend — get $5»
- Coffeepass промо-блок
- Challenges grid

#### A10. Authentication
- **Sign in**: поле телефона с флагом страны, `Continue` → OTP-экран с 6 полями, таймер resend
- Alternative: Google / Apple кнопки
- Minimal, без лишнего

#### A11. Store locator (full map)
- Карта на весь экран
- Pin-ы с цветовой индикацией busy-уровня
- Bottom sheet с фильтрами и списком точек
- Карточка точки при tap: фото, адрес, часы, `Order here`

#### A12. Пустые / ошибочные состояния
- Empty cart, empty orders, no stores nearby, payment failed, offline — все с иллюстрациями и CTA

### B. Telegram Mini App

Те же ключевые флоу (menu → product → cart → checkout → order status), но:
- Учитывать **Telegram header** сверху и safe area
- Использовать нативную **Telegram MainButton** для primary-действий (fixed bottom, цвет из theme)
- **Back button** — стандартный Telegram
- Цветовая схема адаптивная к теме Telegram (light/dark)
- Шрифт — system или Inter
- Упрощённая навигация: 4 вкладки снизу (Home, Menu, Orders, Profile) — но в виде tab bar выше MainButton
- Stripe и Telegram Payments оба доступны на чекауте
- Онбординг короче, используем Telegram `initData` для автоматического логина

### C. Admin Panel (desktop first)

#### Общая структура
- Левый sidebar: логотип, навигация (Dashboard, Menu, Stores, Orders, Promo, Gift cards, Users, Analytics, Settings)
- Верхний app bar: search, store selector, notifications, user menu
- Контент: dense tables, filters chips, bulk-actions bar, drawers для редактирования

#### C1. Dashboard
- Cards сверху: Orders today, Revenue, AOV, Active stores
- График revenue за 7/30 дней
- Top products
- Recent orders live feed

#### C2. Menu management
- Tree view categories слева
- Справа: таблица продуктов с inline-редактированием цены, toggle visible, drag для порядка
- Product drawer: все поля, фото uploader, variations/modifiers tabs
- Bulk-import из CSV

#### C3. Orders
- Live feed с фильтрами (status, store, period, search)
- Detail drawer: таймлайн, payment info, refund кнопка
- KDS-preview кнопка

#### C4. Promo / Loyalty
- Coupons таблица, wizard создания
- Loyalty tiers редактор
- Campaigns (push, email) builder

#### C5. Stores
- Карта + список
- Store detail: working hours grid, stop list, printer config, menu assignment

#### C6. Analytics
- Встроенные дашборды (Metabase-style)
- Funnel viewer, cohort grid, retention chart

### D. KDS (tablet landscape)

Единственный экран, но очень важный.

- Full-screen, максимально читаемый из-за прилавка
- Верхний бар: название точки, время, количество в очереди, фильтр статусов
- **3 колонки**: New / Preparing / Ready
- **Карточка заказа**:
  - Большой номер #1234
  - Имя клиента крупно
  - Таймер с момента приёма (цветовая индикация: зелёный < 3 мин, жёлтый < 5, красный > 5)
  - Список позиций: большими буквами, модификаторы выделены badge-ами
  - Комментарий выделен
  - Тип получения (pickup icon)
  - Кнопки: `Start` / `Ready` / `Picked up`
- Цветовые бейджи для статусов
- Звук при новом заказе (subtle bell)
- Полная поддержка тёмной темы (кафе часто с приглушённым светом)

## Дизайн-система: обязательные компоненты

Собрать как переиспользуемые Pencil-компоненты:
1. **Button** (primary / secondary / ghost / destructive; sizes sm/md/lg; states default/hover/pressed/disabled/loading)
2. **Input** (text / number / phone / OTP / textarea; label + helper + error states)
3. **Select / Dropdown**
4. **Checkbox, Radio, Switch**
5. **Chip / Tag / Badge**
6. **Card** (product, store, order, loyalty)
7. **Modal / BottomSheet / Drawer**
8. **Toast / Snackbar**
9. **Tabs / Segmented control**
10. **Stepper / Counter** (для модификаторов и корзины)
11. **Avatar**
12. **Progress bar + circular**
13. **Skeleton loaders**
14. **Map pin** (5 состояний: default, selected, busy, closed, favorite)
15. **Empty state** (иллюстрация + текст + CTA)
16. **Order status timeline**
17. **Nav bars**: top app bar, tab bar, side nav
18. **Data table** (admin)
19. **Filter bar**
20. **Date/time picker**

## Что НЕ нужно делать
- Не копировать Drinkit визуально 1:1 — мы свой бренд
- Не использовать кричащие неон-цвета
- Не делать экраны с 10+ элементами навигации одновременно
- Не делать landing page на 5000px длиной — хватит 4–5 секций
- Не использовать стоковые фото с людьми в костюмах
- Не дублировать навигацию в Telegram Mini App (использовать нативную Telegram UI)

## Deliverables от pencil.dev

В результате ожидаем:
1. **Design system / token library**: цвета, типографика, радиусы, тени, spacing
2. **UI kit**: все компоненты с вариациями и состояниями
3. **Web / PWA**: все экраны из секции A в двух темах (light / dark) и двух ширинах (desktop 1440, mobile 390)
4. **Telegram Mini App**: адаптированные ключевые экраны (390×844)
5. **Admin Panel**: ключевые экраны из секции C в desktop (1440)
6. **KDS**: экран в tablet landscape (1280×800)
7. **Interactive prototype** для основного флоу: открыть приложение → выбрать точку → заказать латте с модификаторами → оплатить → получить уведомление готово

## Референсы
- **Drinkit** (drinkit.io) — основной референс UX для кастомизации напитка
- **Blue Bottle Coffee** (bluebottlecoffee.com) — тёплый, минималистичный бренд
- **Square / Cash App** — красивая типографика и плотные admin-экраны
- **Stripe dashboard** — ориентир для admin panel
- **Apple Wallet** — как выглядит passkit-like карточка для loyalty
- **Uber Eats** (анти-референс) — не перегружать карточки
- **Telegram Wallet mini app** — референс для нашей TMA-версии

---

## Короткий промт для вставки в pencil.dev (если нужен компактный вариант)

```
Спроектируй дизайн-систему и ключевые экраны для takeAway — глобального приложения для заказа кофе и еды навынос, вдохновлённого drinkit.io, но с расширенным меню (напитки + завтраки + ланчи + десерты).

Поверхности: Web/PWA (responsive), Telegram Mini App, Admin panel, KDS (kitchen display).

Бренд: минималистичная современная кофейня, тёплый бежевый background (Cream #F8F3EB), акцент caramel (#C77D3B), типографика Fraunces (headings) + Inter (UI), светлая и тёмная темы, радиусы 20/14/12, мягкие тёплые тени.

Ключевые флоу:
1) Landing → store locator → menu → product customization (variations + modifiers + caffeine level) → cart → checkout → order status timeline → profile/loyalty
2) Admin: dashboard, menu management, live orders, promo, analytics
3) KDS: 3 колонки New / Preparing / Ready, большие таймеры, тёмная тема

Обязательные компоненты UI kit: Button, Input, OTP field, Select, Chip, Card, Modal, BottomSheet, Toast, Tabs, Counter, Avatar, Progress, Skeleton, Map pin, Order timeline, Data table, Filter bar.

Не делать: кричащих цветов, Drinkit 1:1 копии, стоковых фото с людьми, перегруженных карточек еды.

Нужно: полный дизайн-системный файл с токенами, все экраны в двух темах, интерактивный прототип базового флоу заказа.
```
