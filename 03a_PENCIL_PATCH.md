# takeAway — Pencil Design Patch (pre-order pivot)

Этот файл — **дополнительный промт для pencil.dev** с правками к уже начатому дизайну.

**Контекст для передачи в pencil**:
Уже начат дизайн по `03_PENCIL_PROMPT.md`, но концепция уточнилась. Главная ценность продукта — **pre-order first**, а не общий «order flow». Ниже — конкретные правки по экранам, что добавить, что убрать, что усилить.

---

## TL;DR для pencil

Перепиши дизайн под принцип:
> **«Клиент не стоит в очереди. Никогда. Заказ готовится к моменту прихода.»**

Всё подчиняется этому. Если элемент не работает на скорость pre-order и прозрачность ETA — убрать или понизить в иерархии.

## 1. Глобальные правки дизайн-системы

### Новые токены и компоненты (добавить в UI kit)

- **ETA Pill** — крупная капсула с таймером «Ready in 6:42», в 3 состояниях (ok / caution / late). Используется в store cards, header order screen, KDS
- **Order Code Badge** — большая 4-значная метка для получения заказа. Моноширинный шрифт, border, размер 64–96pt на status screen
- **QR Card** — белая карточка с QR внутри тёплой бежевой рамки, надпись «Show at pickup», слегка скруглённая
- **Timer Ring** — круговой прогресс-индикатор для обратного отсчёта до `READY`, используется на status screen и на KDS
- **Pickup Time Picker** — кастомный picker со слайдером слотов 5-минутного шага, отдельные состояния ASAP / SCHEDULED, выбранный слот выделен caramel-фоном
- **Busy Meter** — горизонтальный 3-сегментный индикатор (зелёный/жёлтый/красный) с подписью «Fast / Busy / Peak», используется на карточках точек
- **Proximity Banner** — широкий верхний баннер «You're almost there — we're starting your order» с иллюстрацией
- **Status Step List** — вертикальный или горизонтальный компонент 4 шагов (Paid → Preparing → Ready → Picked up) с живой анимацией перехода

### Обновление существующих компонентов

- **Store Card** в любом месте приложения теперь всегда показывает:
  - Distance + walking time («4 min walk»)
  - **Current ETA для ASAP-заказа** («Ready in 8 min») — главная цифра
  - Busy Meter
  - Рабочие часы только вторичным шрифтом
- **Product Card** в меню: добавить мелкий `⌛ 3 min` индикатор prep time рядом с ценой. Это создаёт прозрачность времени готовки
- **Cart Drawer**: сверху фиксированная плашка «Ready by 8:42» (pickup time) и live-ETA при выборе ASAP. Клиент всегда видит когда он получит заказ

## 2. Правки по экранам

### 2.1. Landing / Home (Web + PWA)

**Было**: общая «закажи кофе за 30 секунд» + список фич.

**Нужно сделать**:
- **Hero**: огромный headline «**Pre-order. Skip the queue.**» и подзаголовок «Your coffee and food ready the moment you walk in. Zero waiting.»
- Под hero-блоком — **анимированная демонстрация флоу в 3 кадра**:
  1. Телефон с кнопкой «Order now» и ETA-таймером
  2. Walking path по карте от точки пользователя к кофейне
  3. Пользователь забирает пакет из отсека, кассир не нужен
- **Live store strip** — горизонтальная лента ближайших точек с live-ETA цифрами («Ready in 5 min», «Ready in 12 min») — демонстрирует главную фичу прямо на главной
- **How it works** — переписать под pre-order:
  1. `Choose when` — пикер pickup time
  2. `We prepare` — таймер и статус
  3. `You walk in, we hand it over` — QR / отсек
- **Убрать** с лендинга любые намёки на dine-in и delivery, если они есть — вторичные упоминания ок внизу страницы
- **Social proof** для ключевого метрика: «Average pickup time: 0 seconds waiting» или «15 minutes saved per order»

### 2.2. Store Locator / Select store

**Нужно усилить**:
- На карте **pin не только с локацией, но и с ETA-меткой**: «☕ 6 min» прямо на пине, не только в bottom sheet
- В карточке точки (bottom sheet) сверху — не фото, а крупный **ETA Pill** и Busy Meter. Фото вторично
- Кнопка «Order here» показывает prefilled ETA: «Order — ready in 6 min»
- Сортировка списка: по ETA, не по расстоянию (по умолчанию)
- Если все точки загружены (все красные) — показать пустое состояние «All spots busy right now. Scheduled pickup available.» + кнопка pre-schedule

### 2.3. Menu / Catalog

**Правки**:
- Persistent header сверху: **выбранная точка + live ETA + кнопка Change**. Это постоянный контекст «когда я получу»
- На карточках продуктов — мелкий индикатор prep time (3 min, 5 min) рядом с ценой
- Fab (floating action button) корзины снизу с **динамическим ETA**: «2 items · Ready by 8:42 · $9.50». Цифра времени готовности пересчитывается live

### 2.4. Product detail

**Правки**:
- Под ценой — строка «**Adds ~90 sec to prep**» если модификатор/вариация увеличивают время. Прозрачность для пользователя
- Кнопка Add to cart: «Add — ready in 7 min» (с учётом всей корзины)

### 2.5. Cart / Checkout — **самый важный экран для переделки**

**Было**: стандартный checkout со списком позиций.

**Надо сделать центральным экран выбора pickup time**:

- **Верхняя треть экрана — Pickup Time Picker**:
  - Большой сегмент-контрол: `ASAP` / `Scheduled`
  - Для `ASAP` — крупная цифра «Ready in ~7 min» + Timer Ring анимация
  - Для `Scheduled` — горизонтальный слайдер со слотами (8:00 / 8:05 / 8:10 / ...), выбранный — caramel pill
  - Под пикером подпись «We'll start preparing at {startTime} so it's fresh when you arrive»
- Средняя часть — **компактный order summary** (позиции, сумма)
- Нижняя часть — **Pay button с primary CTA**: «Pay $9.50 · Ready at 8:42»
- Apple Pay / Google Pay кнопки выше карточной оплаты
- Никаких лишних полей адреса и delivery options. Только pickup time + contact name + payment

### 2.6. Order Status — **hero экран продукта**

Этот экран должен быть **самым красивым и узнаваемым экраном** всего продукта. На нём клиент проводит 5–15 минут пока идёт до точки.

**Композиция (mobile first, адаптация на desktop)**:

1. **Верх**: приветствие с именем клиента и state `PREPARING` крупно
2. **Центр — Timer Ring**:
   - Большой круговой таймер (диаметр ≥ 240px на mobile)
   - Внутри — минуты и секунды обратного отсчёта
   - Цветовая анимация перетекания caramel → mint при переходе в READY
3. **Order Code + QR** сразу под таймером:
   - 4-значный код крупным моноширинным шрифтом
   - Компактный QR рядом (раскрывается на весь экран по tap)
4. **Status steps**: горизонтальная лента 4 шагов с подсветкой текущего. Анимация галочки при прохождении
5. **Store card**: адрес, walking distance, walking time, **кнопка `Navigate`** (открывает нативный maps)
6. **Order summary**: свёрнутый блок с позициями, раскрывается по tap
7. **Кнопка «I'm here»** крупно в нижней части экрана — ручной триггер для бариста. При срабатывании меняет вид на «We know — see you in a sec ✓»
8. **Cancel order** — ghost-button, только до статуса IN_PROGRESS
9. **Состояние `READY`** — экран полностью перекрашивается в mint-зелёный, Timer Ring сменяется крупной надписью «**READY**», Order Code увеличивается, появляется инструкция «**Pick up at shelf B3**» или «**Show QR at counter**» — зависит от `pickupPointType` точки

**Состояние при опоздании** (past pickupAt): вежливый баннер сверху «Your order is waiting ☕ — tap I'm here when close»

### 2.7. Home screen пользователя (после логина)

Добавить **активный заказ как первый блок** на главной после логина:
- Если есть order в статусе не PICKED_UP — крупная карточка с Timer Ring mini, code, store, CTA «View order»
- Без активного заказа — hero «Ready for your next coffee?» + быстрые кнопки «Usual order» (повтор последнего), «New order»

### 2.8. Push notifications — **дизайн push-экранов**

Добавить в deliverables design preview всех ключевых push-уведомлений:
- iOS/Android/web push preview для статусов PAID, IN_PROGRESS, READY, PICKED_UP, LATE
- В push-е видны: имя, статус, ETA, order code, store, CTA

### 2.9. Telegram Mini App — усиления

- TMA MainButton динамическая: «Pay $9.50 · Ready 8:42» (как на web)
- После оплаты экран статуса — **полноэкранный, без лишних табов**, занимает весь visible height TMA
- Бот-сообщение после оплаты — отдельный макет: карточка с кодом, таймером, кнопками `Track` (открыть TMA) и `Navigate`

### 2.10. KDS — переделать под pre-order

**Добавить**:
- **3 колонки остаются**, но карточка заказа получает **dual timer**:
  - Верхняя большая цифра: `Due in 4:12` (сколько до обещанного pickup time)
  - Нижняя мелкая: `Received 1:20 ago` (как давно пришёл)
  - Цветовая индикация фона карточки: зелёный (есть запас) → жёлтый (пора делать) → красный (опаздываем)
- **Proximity badge** на карточке когда сработал геофенсинг: оранжевый `🚶 Customer nearby` / красный `📍 Customer here`
- **Отдельная колонка `READY`** — с именами клиентов и обратным таймером до момента когда они должны забрать заказ. Когда клиент подходит — карточка подсвечивается
- Крупный счётчик вверху: «12 in queue · avg 4:30» — средняя текущая загрузка точки
- **Peak mode toggle** — переключатель для бариста: вручную перевести точку в «Busy» статус чтобы временно показать клиентам увеличенный ETA

### 2.11. Admin Panel — правки

- **Dashboard hero metric**: не просто «Revenue», а «**Avg wait time: 0s**» (сколько времени клиенты ждали у прилавка) + «Avg ETA accuracy: ±1.2 min» (насколько точно мы попадаем в обещанное время). Это ядро value proposition, должно быть на виду
- В Orders: колонка `ETA vs actual` с цветовой индикацией отклонений
- Analytics: отдельный раздел «**Pickup performance**»:
  - ETA accuracy distribution
  - Average prep time by product
  - Customer arrival delays (пришёл раньше / позже)
  - Percentage of `EXPIRED` orders
  - Peak hours heatmap

## 3. Что убрать или понизить

- **Dine-in flow** — не делать отдельный экран «eat here». Dine-in это просто тип получения (чекбокс на чекауте), никакого meal-management, номеров столов, официантов
- **Курьерская доставка** — НЕ показывать в основных флоу. Если совсем хочется — оставить одну placeholder-иконку «Delivery (coming soon)» в одном месте, не в hero-пути
- **Любые multi-step wizard-ы без прогресса ETA** — всегда держать ETA в видимой части экрана. Клиент должен помнить, зачем он здесь
- **Стандартные «cart empty — explore menu» баннеры** — вместо них показывать live-ETA ближайшей точки и приглашение заказать сейчас

## 4. Обновлённый приоритет экранов для пёрфект-прототипа

Порядок, в котором важно отполировать экраны (прототип-обход демонстрирует именно этот порядок):

1. **Home with active order card**
2. **Store locator с live-ETA**
3. **Menu с persistent ETA header**
4. **Product detail с prep time**
5. **Cart / Checkout с Pickup Time Picker как hero**
6. **Payment success → instant transition to Order Status**
7. **Order Status с Timer Ring, Order Code, QR**
8. **Order Status → READY state (mint-зелёный)**
9. **Pickup instructions (shelf B3 / counter / locker)**
10. **Order completed → loyalty points + reorder CTA**

Прототип должен проигрывать этот flow за 60 секунд.

## 5. Короткий промт для вставки в pencil.dev

```
Перепиши уже начатый дизайн takeAway под pre-order first механику. Главный value prop — «клиент не стоит в очереди, заказ готов к моменту прихода».

Ключевые правки:
1) Landing hero: «Pre-order. Skip the queue.» + анимированная демка трёх кадров флоу.
2) Store locator: на пинах карты — live-ETA «Ready in 6 min», сортировка по ETA, Busy Meter на карточке точки.
3) Menu: persistent header с выбранной точкой + live-ETA, prep time на карточках продуктов, floating cart FAB показывает «Ready by 8:42».
4) Cart/Checkout: центральный элемент — Pickup Time Picker (ASAP с Timer Ring / Scheduled с 5-мин слотами). Pay button с «Pay $X · Ready at 8:42». Убрать поля delivery адресов.
5) Order Status — hero screen продукта: большой Timer Ring, 4-значный order code крупно, QR, status steps, store card с Navigate, «I'm here» кнопка, состояние READY полностью перекрашивает экран в mint-зелёный с инструкциями pickup (shelf/counter/locker).
6) Home после логина: активный заказ первым блоком с mini Timer Ring.
7) Push-экраны design preview для статусов PAID/IN_PROGRESS/READY/LATE.
8) KDS: dual timer на карточке (time until pickup + received ago), цветовой фон по запасу времени, proximity badges, отдельная колонка READY с именами клиентов.
9) Admin dashboard hero metric «Avg wait time: 0s» + «ETA accuracy ±1.2 min» + отдельный раздел Pickup Performance.
10) Убрать dine-in как отдельный флоу и delivery из основного пути.

Новые компоненты UI kit: ETA Pill, Order Code Badge, QR Card, Timer Ring, Pickup Time Picker, Busy Meter, Proximity Banner, Status Step List.

Стиль и цвета без изменений: Cream #F8F3EB, Caramel #C77D3B, Espresso #1A1414, mint #7BC4A4 для ready-состояний, Fraunces (headings) + Inter (UI).
```
