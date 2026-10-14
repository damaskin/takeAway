# Kitchen operations policy — contract (2026-10-14)

Owner decisions (2026-10-14, supersede the 2026-10-04 "shift is the source of truth" rule):
- Working hours have priority over the shift for ASAP orders.
- Unaccepted orders: alert after 3 min, auto-cancel after 8 min.
- Pre-orders for later (incl. tomorrow morning) must work while the shift is closed.

Manager's original items (Russian, from the forwarded list):
1. Ordering at 01:00 for 09:15 tomorrow while the store is closed (opens 09:00) must be possible.
2. Store hours until 21:00 but at 23:50 it shows open because the shift is open — hours must win; shift should close itself or the kitchen gets a notification.
3. Clear peak-hour load policy for the kitchen — very important.
20. A scheduled order must trigger a "time to start order #..." notification in the kitchen, otherwise the kitchen will miss it.
21. How many orders can a store hand over at the same time? A barista cannot hand over 5 orders at 13:00.
22. A barista can close the shift while orders are unfinished — is that right?
23. What happens if the barista is late accepting/finishing an order while the customer is already in the store or on the way? (screenshot: KDS card "-1:00 СЕЙЧАС к 16:22" in red, five unaccepted ASAP orders)

## A. Availability (replaces the rule in apps/api/src/app/catalog/store-availability.ts)

Terms: "within hours" = `isOpenAt(now)` (kitchen/opening-hours.ts; a store with no hours is 24/7). "Shift open" = StoreShift with closedAt null. New field `StoreShift.extendedUntil DateTime?` = kitchen agreed to take ASAP orders outside working hours until this moment.

- `openNow` (ASAP can be ordered right now) = status != CLOSED && shift open && (within hours || extendedUntil > now) && the ASAP spill wait (section C) <= MAX_ASAP_WAIT_SECONDS (env, default 2700).
- `acceptingOrders` (some order can be placed: ASAP now or a pre-order) = status != CLOSED && (openNow || at least one bookable pre-order slot exists in the next 24 h). Implementation may approximate the second part as "a working-hours window starts or is in progress within the next 24 h".
- New `asapBlockedReason`: `'OUTSIDE_HOURS' | 'SHIFT_CLOSED' | 'QUEUE_FULL' | null` (null iff openNow; precedence in that order; for status CLOSED -> 'SHIFT_CLOSED' is not used, acceptingOrders is false instead and the reason may be null).
- New `opensAt: string | null` — ISO UTC start of the next working-hours window when now is outside hours (look ahead 7 days), else null.
- New `closesAt: string | null` — ISO UTC end of the current working-hours window when within hours (null when outside hours or the store is 24/7).
- These four fields are on StoreListItemDto (so also on StoreDetailDto) and in `libs/shared-types` catalog types. `store.availabilityChanged` keeps exactly `{storeId, brandId, acceptingOrders}` and is emitted whenever acceptingOrders OR openNow changes (clients refetch the store). Old clients (old mobile builds) only know openNow/acceptingOrders — the meaning above keeps them working (web/TMA already force SCHEDULED when !openNow).

## B. Pre-orders (item 1)

- `POST /orders` with pickupMode SCHEDULED is accepted while the shift is closed, as long as acceptingOrders and the slot is bookable. ASAP requires openNow, else 400 `{code: 'ASAP_UNAVAILABLE', reason: asapBlockedReason, opensAt}`. acceptingOrders false -> 400 `STORE_NOT_TAKING_ORDERS` (unchanged).
- Cart `addItem` is allowed whenever acceptingOrders (today it requires a shift).
- `GET /stores/:idOrSlug/pickup-slots` horizon: 24 h (was 12). New optional query `cartId` — when given, the slot fit check includes that cart's workSeconds (section C). Slot items keep their current shape (`available` false = full, rendered struck through).
- A slot t is bookable iff: within hours at t; t >= now + MIN_SCHEDULED_LEAD_MINUTES (10) — fixes today's mismatch where the first slot can be < 10 min away; and if no shift is open now, t >= opening of t's working-hours window + PREORDER_OPENING_LEAD_MINUTES (env, default 15); and capacity (section C).
- MAX_SCHEDULED_LEAD_HOURS stays 24.

## C. Load and capacity (items 3, 21)

- Slot = 15 min. A slot is full when (orders whose pickupAt is in the slot and status not CANCELLED/EXPIRED) >= Store.slotCapacity, OR their summed workSeconds + the new order's workSeconds > 900 * Store.kitchenParallelism.
- The ETA queue counts only orders that are due now: CREATED/PAID/ACCEPTED/IN_PROGRESS with pickupAt <= now + 30 min, plus every IN_PROGRESS. Future pre-orders no longer inflate the ASAP ETA.
- ASAP spill: an ASAP order's pickupAt = the earliest slot time >= now + ETA whose slot fits (count + work). The quote (store currentEtaSeconds, cart/checkout quote, order pickupAt) reflects the spill. ASAP never gets PICKUP_SLOT_FULL any more. If the spill wait > MAX_ASAP_WAIT_SECONDS -> openNow false, asapBlockedReason QUEUE_FULL (pre-orders still offered).
- «Загружены» (OVERLOADED) keeps adding BUSY_EXTRA_WAIT_SECONDS.

## D. Kitchen board (item 20)

- KDS rows get `startBy` (ISO) = pickupAt - max(prepSeconds, workSeconds / kitchenParallelism) - 120 s.
- Pre-orders whose startBy > now + 15 min sit in a separate «Предзаказы» group (sorted by pickupAt, shows «к 9:15 · начать в 9:03»). They can be accepted any time (accept = charge, as today).
- At startBy the order joins «Новые» with a chime + toast «Пора готовить #1234 к 9:15» (+ OS notification when enabled). A cron (every minute) sends staff Telegram «Пора готовить предзаказ #1234 к 9:15» once (Order.startReminderSentAt) for orders not yet IN_PROGRESS; if no shift is open at startBy the message says the shift is not open and also goes to the brand owner.
- Countdown shows h:mm:ss above 60 min (not "720:00").

## E. Acceptance SLA and lateness (item 23)

- "Awaiting acceptance" = the board's notion (visible on the board, not yet ACCEPTED). The clock starts when the order became visible to the kitchen (agent decides the field; must be correct for held/deferred card payments and pay-at-pickup).
- ASAP: at ORDER_ACCEPT_ALERT_SECONDS (env, default 180) -> staff Telegram + brand owner Telegram (once; Order.acceptAlertSentAt), board card pulses and chimes every 30 s. At ORDER_ACCEPT_TIMEOUT_SECONDS (env, default 480) -> EXPIRED with reason NOT_ACCEPTED: release/void payment, return promo/gift card/points, customer push (existing EXPIRED copy), kds.orderChanged. Captured payments (PAID) are refunded through the existing refund path; if the provider cannot refund automatically, do not auto-cancel — alert ops instead.
- SCHEDULED: deadline = max(visibleAt + ORDER_ACCEPT_TIMEOUT_SECONDS, pickupAt - 10 min); alert at startBy if still unaccepted.
- Late after acceptance: status ACCEPTED/IN_PROGRESS and now > pickupAt -> one customer push «Немного задерживаемся — заказ #… почти готов» (new push kind `order_delayed`, data.orderId; Order.lateNotifiedAt); at +5 min late one staff + owner Telegram. Board card shows «опаздываем N мин».
- The existing UNACCEPTED_GRACE / ORDER_ACCEPT_TTL sweeps stay as backstops.

## F. Shift lifecycle (items 2, 22)

- 15 min before closesAt (or extendedUntil): board banner + chime «В 21:00 по графику конец работы — заказы «сейчас» перестанут приниматься» with [Продлить на 30 мин] [на 1 ч]. `PUT /kds/shift/extend?storeId= {minutes: 30|60}` -> extendedUntil = max(closesAt, extendedUntil, now) + minutes, capped at closesAt + 4 h; emits kds.shiftChanged + store.availabilityChanged. `GET /kds/shift` adds `extendedUntil`, `closesAt`, `opensAt`, `asapOpen`, `asapBlockedReason`, `closedAutomatically`.
- While the shift is open outside hours without extension (early opening or after closing) the board shows «По графику точка сейчас закрыта — заказы «сейчас» не принимаются» with the same extend buttons.
- A cron (every minute) emits store.availabilityChanged when an open-shift store crosses a hours/extension boundary.
- Auto-close: shift open, now outside hours, no active extension, next window does not start within 60 min, now >= the end of the last window/extension + AUTO_CLOSE_GRACE_MINUTES (env, default 10), and no orders in CREATED(visible)/PAID/ACCEPTED/IN_PROGRESS due within 30 min -> close with closedById null and a marker that it closed by schedule (READY orders stay on the board). Board: «Смена закрыта автоматически в 21:10 по графику».
- `POST /kds/shift/close` -> 409 `SHIFT_HAS_UNACCEPTED_ORDERS {count}` when orders await acceptance and are due within 30 min. The UI replaces window.confirm with a dialog: unaccepted (block: accept or reject them first), in progress / ready (warn: they stay on the board, finish them), pre-orders for later (info: they come to the board in the next shift).

## Client side (web, tma, mobile)

- Store list/detail: when !openNow && acceptingOrders: «Сейчас закрыто · откроется в 9:00 · можно заказать ко времени» (QUEUE_FULL: «Очередь — только ко времени»; OUTSIDE_HOURS with opensAt tomorrow: «откроется завтра в 9:00»). When openNow and closesAt: «до 21:00».
- Checkout: ASAP disabled when !openNow with the reason; SCHEDULED preselected; slot picker covers 24 h with day labels («Сегодня», «Завтра»); pass cartId to pickup-slots; handle ASAP_UNAVAILABLE and PICKUP_SLOT_FULL.
- Checkout is blocked only when !acceptingOrders.
- Order status: awaiting acceptance -> «Ждём подтверждения точки»; pre-order awaiting acceptance while the store is closed -> «Точка подтвердит предзаказ, когда откроется»; ACCEPTED/IN_PROGRESS past pickupAt -> «Немного задерживаемся»; a «Позвонить в точку» action when the store has a phone.
