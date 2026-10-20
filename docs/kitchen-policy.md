# Kitchen operations policy

The rules that decide when a store takes which order, how much the kitchen is
promised per 15 minutes, what the kitchen board reminds staff of, and how the
shift follows the working hours. In force since 2026-10-20 (it first came in on
2026-10-14); it describes what is implemented.

## Owner decisions

### 2026-10-20 (manager Maxim's third list)

They supersede the 2026-10-14 rule that a barista opens and closes the shift:

- **The shift follows the schedule (items 4, 5, 6).** ASAP ordering opens by
  itself at the start of the working hours and closes exactly at their end. There
  is no «Начать работу» / «Закончить работу» any more. The kitchen can extend the
  closing by 30 / 60 minutes, but only in the last hour before it (or while an
  extension runs), and has «Пауза» for an emergency (item 13). Accepted risk: if
  nobody comes in, orders still arrive; the 3-minute alert and the 8-minute
  auto-cancel (money not taken) cover that.
- **The last ASAP order is one the kitchen can make before the closing (item 6).**
- **The store's «N мин» counts a typical order's cooking (item 9), and an
  order's own ETA counts all its work (item 10).**
- **A late accept gets a new estimate for the customer (item 16).**
- **The customer cancels only before the kitchen accepts (item 19)**, and only
  while no money is captured. Once accepted the API refuses and the clients say
  «Заказ уже готовят — для отмены позвоните в точку». The payment flow (charge on
  accept) does not change. Background: the production Agroprombank terminal refuses
  refunds, and a cancel after accept used to leave the money charged.
- **The kitchen hears about orders that leave its board without it (ТГ 9):** a
  customer's cancel and the SLA auto-cancel go to the store team and the owner,
  and the board shows a notice with a chime.

Not decided yet (for the meeting): a stronger ASAP load rule in a rush (item 11,
today an ASAP order spills up to 45 minutes ahead) and scaling the 5-minute late
alert and the 3-minute accept alert to the promise (item 16 thresholds).

### 2026-10-14

- Working hours have priority over the shift for ASAP orders.
- Unaccepted orders: alert after 3 minutes, auto-cancel after 8 minutes.
- Pre-orders for later (tomorrow morning included) work while the shift is closed.

## Terms

- **Within hours** — `withinHours()` over the store's working-hours windows in its
  timezone (`apps/api/src/app/kitchen/opening-hours.ts`). A store with no hours on
  file is open around the clock. Back-to-back days (09:00–24:00, 00:00–02:00) merge
  into one window.
- **Shift open** — a `StoreShift` with `closedAt = null` (at most one per store).
  The schedule opens and closes it (section F).
- **Extension** — `StoreShift.extendedUntil`: the kitchen agreed to take ASAP
  orders past the hours until then.
- **Closing boundary** — the end of the current window, or the extension's end
  when later (`closingBoundary()`); none for a store open around the clock.
- **Pause** — `Store.pausedUntil > now` (section G).
- **On the board / awaiting acceptance** — the order is shown on the kitchen board
  and is still CREATED or PAID. `Order.kitchenVisibleAt` is when it reached the
  board: at creation when nothing is paid by card (zero total, or card payments
  switched off), else when the card hold, the charge put off until the accept, or
  a captured payment landed.
- **Due soon** — `pickupAt` within 30 minutes (`DUE_SOON_SECONDS`).
- **Cooking** — `max(prepSeconds, workSeconds / kitchenParallelism)`
  (`cookingSeconds()` in `kitchen/kitchen-timeline.ts`).

All durations are seconds in code and the database (minutes only where an env
var says so); times are UTC in the database and the store's timezone in the UI.

## A. Availability

One place decides: `apps/api/src/app/catalog/store-availability.ts`
(`storeAvailability`, `slotBlocker`, `hasBookableSlot`, `closingBoundary`),
applied to database rows by `StoreAvailabilityService` (kitchen module).

| Field               | Meaning                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openNow`           | An ASAP order placed now is taken: not CLOSED, within hours **or** `extendedUntil > now`, not paused, shift open, ready before the closing boundary, and the handover (queue and full slots included) within `MAX_ASAP_WAIT_SECONDS`. |
| `acceptingOrders`   | Some order can be placed: not CLOSED and (`openNow` or a pre-order slot passes the slot rules within 24 hours — capacity is not looked at).                                                                                           |
| `asapBlockedReason` | `OUTSIDE_HOURS` → `PAUSED` → `SHIFT_CLOSED` → `CLOSING_SOON` → `QUEUE_FULL` (first that applies); null when `openNow`, and for a store switched off (CLOSED), where `acceptingOrders` is false instead.                               |
| `opensAt`           | ISO UTC start of the next window while outside the hours (looks 8 days ahead), else null.                                                                                                                                             |
| `closesAt`          | ISO UTC end of the current window while within the hours; null outside them and for a store that does not close within the week.                                                                                                      |
| `pausedUntil`       | ISO UTC end of the kitchen's pause while it runs, else null.                                                                                                                                                                          |
| `pauseReason`       | `EQUIPMENT` / `NO_INGREDIENTS` / `NO_STAFF` / `OTHER` while paused, else null. Customers are shown a neutral «Технический перерыв».                                                                                                   |
| `currentEtaSeconds` | The «N мин» badge: base + queue (+ busy wait) + **a typical order's cooking**, spilled to the first slot with room (section C).                                                                                                       |

- `SHIFT_CLOSED` now shows only for the minute between the start of the hours and
  the schedule's pass that opens the shift.
- `CLOSING_SOON`: within hours (or an extension), but `now + currentEtaSeconds` is
  after the closing boundary. With the queue full the handover is later than
  `MAX_ASAP_WAIT_SECONDS`, so a boundary nearer than that is `CLOSING_SOON` too.
- Old app builds that know only `openNow` / `acceptingOrders` keep working; the
  Dart client maps unknown reasons to `unknown`.

`store.availabilityChanged` keeps exactly `{storeId, brandId, acceptingOrders}`.
It is sent after the schedule opens or closes a shift, an extension, a pause set,
lifted or run out, the store switched on or off, its hours or timezone edited, and
— from the `kitchen-shift-schedule` cron, every minute — whenever a store's
`acceptingOrders` or `openNow` changed by itself (hours, the queue). Clients
refetch the store. The cron keeps what it last saw in memory: after a restart its
first pass only takes note.

## B. Orders and pre-orders

- `POST /orders`
  - `acceptingOrders` false → 400 `STORE_NOT_TAKING_ORDERS` (unchanged).
  - ASAP needs `openNow`, else 400 `ASAP_UNAVAILABLE {reason, opensAt, pausedUntil,
closesAt}`: `reason` is the store's `asapBlockedReason`; `pausedUntil` is set for
    `PAUSED`, `closesAt` (the closing boundary) for `CLOSING_SOON`, so the clients
    can say «технический перерыв до 12:30» / «закрывается в 21:00».
  - ASAP also refused with `CLOSING_SOON` when **this order's own** handover (its
    quote, spill included) is after the closing boundary — the last order for now
    is one the kitchen can make before the closing (item 6) — and with
    `QUEUE_FULL` when its own work pushes the handover past the limit. ASAP is
    never refused with `PICKUP_SLOT_FULL`.
  - SCHEDULED is taken with the shift closed when the slot is bookable:
    `PICKUP_TIME_OUT_OF_RANGE` (sooner than 10 minutes or further than 24 hours),
    `STORE_CLOSED_AT_TIME` (outside the hours, **during a pause**, or inside the
    opening lead below), `PICKUP_SLOT_FULL` (capacity, with this order's work).
- The cart (`POST /cart/items`) fills whenever the store is `acceptingOrders` —
  also while paused.
- `GET /stores/:idOrSlug/pickup-slots?cartId=` — 24 hours of 15-minute slots;
  times that cannot be booked (outside the hours, before the end of a pause, too
  soon) are left out, full slots come back `available: false`.
- A slot time `t` is bookable when (`slotBlocker`): `t ≥ now + 10 min`,
  `t ≤ now + 24 h`, `t ≥ pausedUntil` (while paused), `t` is within hours
  (end-exclusive: with hours until 21:00 the last slot is 20:45), and — when no
  shift is open now, **or** `t`'s window has not opened yet — `t ≥` that window's
  opening + `PREORDER_OPENING_LEAD_MINUTES` (15). Then capacity (section C).

## C. Load, capacity and the ETA

`apps/api/src/app/kitchen/kitchen-load.service.ts`, `slots.ts`, `typical-prep.ts`.

- A slot (15 minutes) is full when it holds `Store.slotCapacity` orders (status not
  CANCELLED/EXPIRED), or when the work of its orders plus the new order's would
  exceed `900 s × Store.kitchenParallelism`. An order bigger than a whole slot on its
  own still fits an empty one.
- The queue counts orders due soon (CREATED/PAID/ACCEPTED/IN_PROGRESS with
  `pickupAt ≤ now + 30 min`) plus every IN_PROGRESS one (at half its work), divided
  by `kitchenParallelism`, plus `BUSY_EXTRA_WAIT_SECONDS` while «Загружены».
- **An order's ETA** (cart quote «Готово к 12:03», `POST /orders`):
  `base + queue + max(prepSeconds, workSeconds / kitchenParallelism)`. Before
  2026-10-20 it was `+ prepSeconds`, so 3× Американо of 5 minutes on a one-handed
  bar counted as one (item 10).
- **The store's ETA** (`currentEtaSeconds`, `store.loadChanged`): `base + queue +
typical cooking`, where the typical cooking is the median `Product.prepTimeSeconds`
  of what can be ordered in the store now — visible, listed in it (`ProductStore`),
  in a category sold on its own, not on its stop-list; 0 with none (item 9). Kept in
  memory per store for 3 minutes (`TYPICAL_PREP_TTL_MS`) and forgotten when the
  admin changes the stop-list (that store) or a product (every store). Every client,
  published app builds included, shows the change with no client work.
- ASAP spill: an ASAP order's `pickupAt` is `now + eta` if that slot has room, else
  the start of the first later slot that has; past `MAX_ASAP_WAIT_SECONDS` the queue
  is full (`QUEUE_FULL`, pre-orders still offered).
- Store editor: «Базовое время на заказ» says the customer sees base + typical
  cooking + queue; «Позиций готовится одновременно» (`kitchenParallelism`);
  «Заказов на 15 минут» (`slotCapacity`).

## D. Kitchen board

Rows of `GET /kds/orders` and of every `kds.orderChanged` that carries a row
(`apps/api/src/app/kds/kds-row.ts`, timing in `kitchen/kitchen-timeline.ts`) add:

| Field              | Value                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `startBy`          | `pickupAt − cooking − 120 s`                                                                      |
| `awaitingSince`    | `kitchenVisibleAt`                                                                                |
| `acceptAlertAt`    | while awaiting acceptance: ASAP — `awaitingSince + ORDER_ACCEPT_ALERT_SECONDS`; SCHEDULED — see E |
| `acceptDeadlineAt` | while awaiting acceptance: when it expires (E)                                                    |

`kds.orderChanged` with kind `removed` adds `reason` (`CANCELLED_BY_CUSTOMER`,
`REJECTED`, `NOT_ACCEPTED`, `EXPIRED`) and `orderCode`; older boards ignore them.

Board (`apps/admin/src/app/features/kitchen/kitchen.page.ts`,
`core/kitchen/kitchen-board.ts`, `shared/store-schedule-status.component.ts`):

- The status line under the header: «Работаем по графику до 21:00», «Продлено до
  21:30», «Работаем круглосуточно», «По графику закрыто · откроется завтра в 09:00 ·
  предзаказы приходят» (today / tomorrow / a date), «Точка выключена в настройках»;
  below it «Заказы «сейчас» не принимаются: большая очередь» / «… не успеем до
  закрытия» when that is why; and the pause: «Пауза до 12:30 · Сломалось
  оборудование — кофемашина (Анна) [Снять паузу]». The same line is on the «Точки»
  cards and the dashboard (read-only there).
- «Пауза» next to «Загружены» / «Стоп-лист» (section G); while paused it reads
  «Пауза до 12:30» and lifts the pause.
- Card timers (item 16): while awaiting acceptance the card shows only the
  acceptance pill — ASAP «Ждёт принятия 3 мин · автоотмена через 4:44» (amber, red
  and pulsing once overdue); a pre-order «Ждёт принятия», with the countdown once
  overdue — and the pickup time as plain text («к 00:11»). The countdown to the
  pickup appears once the order is accepted.
- A ticket the customer cancelled leaves with the notice «Заказ #1234 отменён
  клиентом» and a chime; one the SLA called off with «Заказ #1234 отменён
  автоматически — его не приняли вовремя». The kitchen's own moves and rejections
  stay quiet.
- Pre-orders (SCHEDULED, not started) whose `startBy` is more than 15 minutes away
  sit in «Предзаказы» above the columns, «к 9:15 · начать в 9:03»; at `startBy` a
  pre-order not yet IN_PROGRESS chimes and shows «Пора готовить #1234 к 9:15».
- The board keeps working with no shift open: orders on it (pre-orders included)
  can be accepted, started and handed over; accepting never looks at the shift.
- The `kitchen-order-sla` cron sends staff Telegram «Пора готовить предзаказ #1234
  к 9:15» once for pre-orders not yet IN_PROGRESS (with no shift open the message
  says the store is still closed by its hours and also goes to the owner).

## E. Acceptance SLA, lateness and the new estimate

`apps/api/src/app/kds/kitchen-sla.service.ts`, cron `kitchen-order-sla`, every minute.

- **ASAP alert**: awaiting acceptance for `ORDER_ACCEPT_ALERT_SECONDS` (180) → staff
  and brand-owner Telegram once (`Order.acceptAlertSentAt`).
- **Timeout**: at `acceptDeadlineAt` the order expires with reason `not_accepted`
  through `OrderExpiryService.expire` (promo, gift-card balance, points back; a hold
  released, a deferred charge voided; the customer's "not accepted" push; the board
  drops the ticket with `reason: NOT_ACCEPTED`), and the store team and the owner
  get «Заказ #1234 отменён автоматически — его не приняли за 8 мин» (the configured
  `ORDER_ACCEPT_TIMEOUT_SECONDS`; a pre-order says «Предзаказ к 9:15 не приняли
  вовремя»).
  - ASAP: `awaitingSince + ORDER_ACCEPT_TIMEOUT_SECONDS` (480).
  - SCHEDULED: `max(awaitingSince + ORDER_ACCEPT_TIMEOUT_SECONDS, pickupAt − 10 min)`.
  - Captured payments are refunded first; when that fails the order is not
    cancelled and ops, staff and the owner are told (unchanged).
- **New estimate (item 16)**: when the kitchen accepts or starts an order and
  `now + cooking > pickupAt`, `Order.readyEstimateAt = now + cooking` (a start
  moves it on). `pickupAt` stays the original promise (analytics, slots, the
  board's «Опаздываем N мин»). The accept push says «Заведение уже готовит ваш
  заказ — будет готов примерно к 12:10». Clients count down to
  `readyEstimateAt ?? pickupAt` (`orderDueAt` in libs/utils).
- **Late**: ACCEPTED/IN_PROGRESS past `readyEstimateAt ?? pickupAt` → one customer
  push «Немного задерживаемся» (`Order.lateNotifiedAt`); 5 minutes past `pickupAt` →
  one staff + owner Telegram (`Order.lateAlertSentAt`) — the thresholds are kept
  for the meeting. Orders due more than two hours ago are not pinged.

Every one-shot notice is claimed with a conditional update of its column before it
is sent, so two API instances never send it twice.

## F. Shift lifecycle — the schedule runs it

`apps/api/src/app/kds/store-shift.service.ts`, `shift-schedule.service.ts`.

- The `kitchen-shift-schedule` cron, every minute, in this order:
  1. ends pauses that ran out (G);
  2. **closes** an open shift exactly at the end of the window, or of the
     extension: outside the hours, no extension running, now ≥ the last window's
     end / the extension's end + `AUTO_CLOSE_GRACE_MINUTES` (default 0). Orders in
     work do **not** hold it open — they stay on the board and are finished as
     usual; closing only stops new ASAP orders, which the hours stop anyway. Closed
     with `closedById = null`, `closedAutomatically = true`; «Загружены» and a pause
     are cleared. A store open around the clock is never closed. A split day
     (09–13, 14–21) closes at 13:00 and opens again at 14:00;
  3. **opens** a shift for every store that is not CLOSED, has none open and is
     within its hours (a store with no hours on file keeps one open):
     `openedById = null`, `openedAutomatically = true`. Two API instances racing
     are kept apart by the partial unique index;
  4. announces availability changes that happened by themselves.
- `GET /kds/shift?storeId=` (`KitchenShiftState`): `open`, `openedAt`,
  `openedAutomatically`, `closedAt`, `closedAutomatically`, `busy`, `extendedUntil`,
  `closesAt`, `opensAt`, `asapOpen`, `asapBlockedReason`, `canExtend`, `pausedUntil`,
  `pauseReason`, `pauseComment`, `pausedByName`.
- `POST /kds/shift/open` and `POST /kds/shift/close` → 409
  `SHIFT_FOLLOWS_SCHEDULE` (kept so an old cabinet gets a clear answer). The
  close-summary endpoint and the "Finish work" dialog are gone.
- `PUT /kds/shift/extend?storeId= {minutes: 30|60}` only while `canExtend`: a shift
  is open, and either within hours with the closing at most 60 minutes away
  (`EXTEND_WINDOW_SECONDS`) or an extension is running — in both cases below the
  cap. Else 409 `SHIFT_EXTENSION_NOT_ALLOWED {reason}` with `reason` one of
  `NO_SHIFT`, `AROUND_THE_CLOCK`, `OUTSIDE_HOURS`, `TOO_EARLY`, `LIMIT`. The
  extension runs from the later of the closing, the current extension and now,
  capped at four hours past the closing it extends. «Продлить» at 23:57 outside the
  hours can no longer open ASAP ordering at night.
- Board banner: 15 minutes before the closing boundary — chime and «В 21:00 по
  графику конец работы — заказы «сейчас» перестанут приниматься» with [Продлить на
  30 мин] [Продлить на 1 ч] while `canExtend`. No banner and no extend buttons
  outside the hours.

## G. Pause («Пауза», item 13)

- `PUT /kds/pause?storeId=` with `KitchenPauseRequest {minutes: 15|30|60|120 | null,
reason, comment?}` (comment ≤ 120 characters). `null` = until the closing
  boundary; a store open around the clock until the next local midnight; before
  the opening until the end of the coming window; 409 `PAUSE_NEEDS_DURATION` when
  nothing opens within the week. Setting it again replaces it. A store switched
  off → 409 `STORE_SWITCHED_OFF`.
- `DELETE /kds/pause?storeId=` lifts it (idempotent).
- Same roles as «Загружены»; PIN sessions of the store may use both.
- While `pausedUntil > now`: ASAP blocked (`PAUSED`), no pre-order for a time before
  `pausedUntil`, the cart still fills; orders already on the board stay.
- Telegram to the store team and the owner: on set «Пауза до 12:30 · Центр —
  Сломалось оборудование — кофемашина (Анна). Заказы «сейчас» не принимаются,
  предзаказы до 12:30 закрыты»; on lift «Пауза снята (Анна)»; when it runs out
  «Пауза закончилась»; when the closing clears it «Точка закрылась по графику, пауза
  снята». The end is claimed conditionally, so it is sent once.
- `store.availabilityChanged` and `kds.shiftChanged` on set, lift, expiry and close.
- Cleared when the shift closes.

## H. Customer cancel (item 19)

- `Order.canCancel` (order DTO): CREATED or PAID **and** no payment SUCCEEDED or
  PARTIALLY_REFUNDED. A card hold or a charge put off until the accept is fine (it
  is released or voided).
- `POST /orders/:id/cancel` otherwise → 409 `ORDER_NOT_CANCELLABLE {reason:
'ACCEPTED' | 'CHARGED'}` (`ACCEPTED` for any status from ACCEPTED on). An order
  already cancelled or expired is refused as before (400). The claim also requires
  no captured payment, so an accept that captured a moment earlier makes the cancel
  fail with `ACCEPTED` instead of leaving the money charged.
- A cancel of an order that was on the board → Telegram to the store team and the
  owner «Клиент отменил заказ #1234 · Центр — Он ещё не был принят — готовить не
  нужно», and the board's notice. An unpaid order the kitchen never saw tells nobody.

## Client side (web, TMA, mobile)

Built on the same fields by the client branches of the round: the store hours line
and the checkout's ASAP reason for `PAUSED` / `CLOSING_SOON` (libs/i18n
`storeHoursText` / `asapBlockedText`), the countdown to `orderDueAt`, and the cancel
button only while `canCancel`, with «Заказ уже готовят — для отмены позвоните в
точку» on `ORDER_NOT_CANCELLABLE`.

## Configuration

| Variable                        | Default |                                                              |
| ------------------------------- | ------- | ------------------------------------------------------------ |
| `MAX_ASAP_WAIT_SECONDS`         | 2700    | longest ASAP handover; past it `QUEUE_FULL`                  |
| `PREORDER_OPENING_LEAD_MINUTES` | 15      | first pre-order slot after an opening nobody is on shift for |
| `ORDER_ACCEPT_ALERT_SECONDS`    | 180     | alert for an unaccepted order                                |
| `ORDER_ACCEPT_TIMEOUT_SECONDS`  | 480     | auto-cancel; never below the alert                           |
| `AUTO_CLOSE_GRACE_MINUTES`      | **0**   | the shift closes this long after the hours (was 10)          |
| `BUSY_EXTRA_WAIT_SECONDS`       | 300     | unchanged: «Загружены» extra wait                            |

Fixed in code: slot 15 min, pre-order lead 10 min, horizon 24 h, "due soon" 30 min,
pre-order group lead 15 min, start buffer 120 s, scheduled deadline 10 min before
pickup, late alert 5 min, extension cap 4 h, extend window 60 min, pause durations
15/30/60/120 min, pause comment 120 characters, typical-cooking cache 3 min.

## Data model

- `20261014100000_kitchen_policy`: `StoreShift.extendedUntil`,
  `StoreShift.closedAutomatically`; `Order.kitchenVisibleAt`, `acceptAlertSentAt`,
  `startReminderSentAt`, `lateNotifiedAt`, `lateAlertSentAt`.
- `20261020100000_kitchen_schedule_pause` (no backfill): enum `StorePauseReason`;
  `Store.pausedUntil`, `pauseReason`, `pauseComment`, `pausedById` (not a relation);
  `StoreShift.openedAutomatically`; `Order.readyEstimateAt`.

## Known limits

- An accept pressed in the same second as the timeout, or as the customer's
  cancel: the order status and the payment row are each claimed conditionally, but
  the bank calls (capture vs. release) cannot share a transaction.
- The crons run on every API instance; duplicates of `store.availabilityChanged`
  are harmless, the one-shot notices and the shift open/close are claimed in the
  database. The typical-cooking cache is per instance (3 minutes at most stale).
- The ETA spill is a quote: two ASAP orders placed in the same second can both take
  the last room in a slot.
- `CLOSING_SOON` at store level uses a typical order: a very quick order can be
  refused a few minutes before the closing although it would have made it.
