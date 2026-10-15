# Kitchen operations policy

The rules that decide when a store takes which order, how much the kitchen is
promised per 15 minutes, what the kitchen board reminds staff of and how a shift
starts, stretches and ends. In force since 2026-10-14; this file replaces
`docs/kitchen-policy-contract.md` and describes what is implemented.

## Owner decisions (2026-10-14)

They supersede the 2026-10-04 rule "the shift is the source of truth":

- Working hours have priority over the shift for ASAP orders.
- Unaccepted orders: alert after 3 minutes, auto-cancel after 8 minutes.
- Pre-orders for later (tomorrow morning included) work while the shift is closed.

The manager's items they answer: ordering at 01:00 for 09:15 while the store is
closed (1); a store shown open at 23:50 with hours until 21:00 because the shift
was left open (2); a clear peak-hour load policy (3); a "time to start order #…"
notice for pre-orders (20); how many orders a store can hand over at once (21);
closing a shift with unfinished orders (22); a late or unaccepted order while the
customer is on the way (23).

## Terms

- **Within hours** — `withinHours()` over the store's working-hours windows in its
  timezone (`apps/api/src/app/kitchen/opening-hours.ts`). A store with no hours on
  file is open around the clock. Back-to-back days (09:00–24:00, 00:00–02:00) merge
  into one window.
- **Shift open** — a `StoreShift` with `closedAt = null` (at most one per store).
- **Extension** — `StoreShift.extendedUntil`: the kitchen agreed to take ASAP
  orders past the hours until then.
- **On the board / awaiting acceptance** — the order is shown on the kitchen board
  and is still CREATED or PAID. `Order.kitchenVisibleAt` is when it reached the
  board: at creation when nothing is paid by card (zero total, or card payments
  switched off), else when the card hold, the charge put off until the accept, or
  a captured payment landed (`OrderSettlementService.announceHeld` /
  `settlePaidOrder`). Orders from before the migration have it null and are left to
  the old expiry backstops.
- **Due soon** — `pickupAt` within 30 minutes (`DUE_SOON_SECONDS`).

All durations are seconds in code and the database (minutes only where an env
var says so); times are UTC in the database and the store's timezone in the UI.

## A. Availability

One place decides: `apps/api/src/app/catalog/store-availability.ts`
(`storeAvailability`, `slotBlocker`, `hasBookableSlot`), applied to database rows
by `StoreAvailabilityService` (kitchen module).

| Field               | Meaning                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openNow`           | An ASAP order placed now is taken: status not CLOSED, shift open, within hours **or** `extendedUntil > now`, and the ASAP handover (queue and full slots included, section C) within `MAX_ASAP_WAIT_SECONDS` (2700). |
| `acceptingOrders`   | Some order can be placed: not CLOSED and (`openNow` or a pre-order slot passes the slot rules within 24 hours — capacity is not looked at).                                                                          |
| `asapBlockedReason` | `OUTSIDE_HOURS` → `SHIFT_CLOSED` → `QUEUE_FULL` (first that applies); null when `openNow`, and for a store switched off (CLOSED), where `acceptingOrders` is false instead.                                          |
| `opensAt`           | ISO UTC start of the next window while outside the hours (looks 8 days ahead), else null.                                                                                                                            |
| `closesAt`          | ISO UTC end of the current window while within the hours; null outside them and for a store that does not close within the week.                                                                                     |

The fields are on `StoreListItemDto` / `StoreDetailDto` (`GET /stores`,
`GET /stores/:idOrSlug`) and in `libs/shared-types` (`StoreListItem`). Old app
builds that know only `openNow` / `acceptingOrders` keep working: web and TMA
already force a scheduled order when `!openNow`.

`store.availabilityChanged` keeps exactly `{storeId, brandId, acceptingOrders}`.
It is sent after a shift is opened, closed or extended, the store is switched on
or off, its hours or timezone are edited, and — from the `kitchen-shift-schedule`
cron, every minute — whenever a store's `acceptingOrders` or `openNow` changed by
itself (hours or an extension started or ended, the queue filled up or drained).
Clients refetch the store. The cron keeps what it last saw in memory: after a
restart its first pass only takes note.

## B. Pre-orders

- `POST /orders`
  - `acceptingOrders` false → 400 `STORE_NOT_TAKING_ORDERS` (unchanged).
  - ASAP needs `openNow`, else 400 `ASAP_UNAVAILABLE {reason, opensAt}` (`reason`
    is the store's `asapBlockedReason`; `QUEUE_FULL` also when the order's own work
    pushes the handover past the limit). ASAP is never refused with
    `PICKUP_SLOT_FULL`.
  - SCHEDULED is taken with the shift closed when the slot is bookable:
    `PICKUP_TIME_OUT_OF_RANGE` (sooner than 10 minutes or further than 24 hours),
    `STORE_CLOSED_AT_TIME` (outside the hours, or inside the opening lead below),
    `PICKUP_SLOT_FULL` (capacity, with this order's work).
- The cart (`POST /cart/items`) fills whenever the store is `acceptingOrders`.
- `GET /stores/:idOrSlug/pickup-slots?cartId=` — 24 hours of 15-minute slots. With
  `cartId` (a cart of that store; another store's cart is ignored) a slot without
  room for the cart's kitchen work comes back `available: false`. The item shape is
  unchanged; times that cannot be booked at all are left out, full slots are
  returned struck out.
- A slot time `t` is bookable when (`slotBlocker`): `t ≥ now + 10 min`
  (`MIN_SCHEDULED_LEAD_MINUTES`; the first slot used to be offered less than ten
  minutes ahead and then refused), `t ≤ now + 24 h`, `t` is within hours, and — when
  no shift is open now, **or** `t`'s window has not opened yet — `t ≥` that window's
  opening + `PREORDER_OPENING_LEAD_MINUTES` (15). Then capacity (section C).

  _Interpretation:_ the contract asked for the opening lead only "if no shift is
  open now". It is also applied to a window that has not opened yet while a shift
  is open (an evening shift still running does not mean someone opens on time
  tomorrow). Inside a running window with a shift open there is no lead.

## C. Load and capacity

`apps/api/src/app/kitchen/kitchen-load.service.ts`, `slots.ts`.

- A slot (15 minutes) is full when it holds `Store.slotCapacity` orders (status not
  CANCELLED/EXPIRED), or when the work of its orders plus the new order's would
  exceed `900 s × Store.kitchenParallelism`. An order bigger than a whole slot on its
  own still fits an empty one — otherwise it could never be placed.
- The ETA queue counts orders due soon (CREATED/PAID/ACCEPTED/IN_PROGRESS with
  `pickupAt ≤ now + 30 min`) plus every IN_PROGRESS one (at half its work):
  `eta = baseEtaSeconds + work / kitchenParallelism + own prep (+ BUSY_EXTRA_WAIT_SECONDS
while «Загружены»)`. Pre-orders for later no longer inflate the ASAP wait.
- ASAP spill: an ASAP order's `pickupAt` is `now + eta` if that slot has room, else
  the start of the first later slot that has; past `MAX_ASAP_WAIT_SECONDS` the queue
  is full (`openNow` false, `QUEUE_FULL`, pre-orders still offered). The store's
  `currentEtaSeconds`, the cart quote and the order's `pickupAt` all show the spill.
- Store editor: «Позиций готовится одновременно» (`kitchenParallelism`, how many
  items the kitchen makes at once) and «Заказов на 15 минут» (`slotCapacity`, how
  many orders the store hands over in 15 minutes), with "in 15 minutes the kitchen
  does N min of work (say, M three-minute drinks) and hands over up to K orders".

## D. Kitchen board

Rows of `GET /kds/orders` and of every `kds.orderChanged` that carries a row
(`apps/api/src/app/kds/kds-row.ts`, timing in `kitchen/kitchen-timeline.ts`) add:

| Field              | Value                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `startBy`          | `pickupAt − max(prepSeconds, workSeconds / kitchenParallelism) − 120 s`                           |
| `awaitingSince`    | `kitchenVisibleAt`                                                                                |
| `acceptAlertAt`    | while awaiting acceptance: ASAP — `awaitingSince + ORDER_ACCEPT_ALERT_SECONDS`; SCHEDULED — see E |
| `acceptDeadlineAt` | while awaiting acceptance: when it expires (E)                                                    |

Board (`apps/admin/src/app/features/kitchen/kitchen.page.ts`,
`core/kitchen/kitchen-board.ts`):

- Pre-orders (SCHEDULED, not started) whose `startBy` is more than 15 minutes away
  sit in «Предзаказы» above the columns, sorted by pickup, «к 9:15 · начать в 9:03».
  They can be accepted any time (accept = charge, as before) and stay there until
  15 minutes before their start, then join «Новые».
- At `startBy` a pre-order not yet IN_PROGRESS chimes, shows «Пора готовить #1234 к
  9:15» and raises an OS notification from a background tab (once per board session).
- The `kitchen-order-sla` cron (every minute) sends staff Telegram «Пора готовить
  предзаказ #1234 к 9:15» once (`Order.startReminderSentAt`) for pre-orders not yet
  IN_PROGRESS: an accepted one at `startBy`; one not accepted yet at its
  `acceptAlertAt` (E), saying it is not accepted. With no shift open, or the order
  not accepted, the message says so and also goes to the brand owner.
- Countdowns read `h:mm:ss` above an hour (not `720:00`).

## E. Acceptance SLA and lateness

`apps/api/src/app/kds/kitchen-sla.service.ts`, cron `kitchen-order-sla`, every minute.

- **ASAP alert**: awaiting acceptance for `ORDER_ACCEPT_ALERT_SECONDS` (180) → staff
  and brand-owner Telegram once (`Order.acceptAlertSentAt`). The board card pulses,
  shows «Ждёт принятия N мин · автоотмена через m:ss» and chimes every 30 s.
- **Timeout**: at `acceptDeadlineAt` the order expires with reason `not_accepted`
  (event payload `rule: accept_timeout`) through `OrderExpiryService.expire`, the
  same path as the unpaid-order expiry: promo, gift-card balance and points go back,
  a card hold is released (`ReverseOperation` / `CancelOperation`, retried by the
  reconciliation cron when the bank does not answer), a charge put off until the
  accept is voided without a bank call, the customer gets the existing "not
  accepted" push, the board drops the ticket (`kds.orderChanged` removed).
  - ASAP: `awaitingSince + ORDER_ACCEPT_TIMEOUT_SECONDS` (480).
  - SCHEDULED: `max(awaitingSince + ORDER_ACCEPT_TIMEOUT_SECONDS, pickupAt − 10 min)`.
  - **Captured payments** (PAID — `AGROPROMBANK_CHARGE_AT_CHECKOUT`, a Web-платёж
    without preauth, Stripe) are refunded **first** through the admin refund path
    (`PaymentsService.refundOrder`, `source: sla`), then the PAID order expires and
    the push says the money is on its way back. If the refund fails (the production
    terminal refuses refunds) the order is **not** cancelled: it stays on the board
    and ops chat, staff and the owner are told once (an order NOTE
    `acceptTimeoutBlocked` keeps later passes off it). The same applies when another
    provider's payment is still in flight on a CREATED order. If the kitchen accepts
    the order while its refund goes through, the alert says to take the payment at
    the counter.
  - The old sweeps (`ORDER_ACCEPT_TTL_MINUTES`, `ORDER_ACCEPT_GRACE_MINUTES`, the
    pay-on-pickup grace) stay as backstops; the ops alert for paid orders left
    unaccepted for 10 minutes now ignores pre-orders not due within 30 minutes.
- **SCHEDULED alert** — _deviation_: the contract said "alert at startBy". For a
  short pre-order `startBy` falls after its deadline (pickup 09:15, deadline 09:05,
  start 09:10), so the alert would come after the cancellation. It is
  `max(awaitingSince + ALERT, min(startBy, deadline − (TIMEOUT − ALERT)))`: at the
  start time, but never later than the five-minute warning an ASAP order gets.
- **Late**: ACCEPTED/IN_PROGRESS past `pickupAt` → one customer push «Немного
  задерживаемся — заказ #… почти готов» (push kind `order_delayed`, `data.orderId`,
  honours the order-updates opt-out; `Order.lateNotifiedAt`); 5 minutes late → one
  staff + owner Telegram (`Order.lateAlertSentAt`). Board: «Опаздываем N мин».
  Orders due more than two hours ago are not pinged (stale rows nobody closed).

Every one-shot notice is claimed with a conditional update of its column before it
is sent, so two API instances never send it twice.

## F. Shift lifecycle

`apps/api/src/app/kds/store-shift.service.ts`, `shift-schedule.service.ts`.

- `GET /kds/shift?storeId=` adds `extendedUntil` (running extension or null),
  `closesAt`, `opensAt`, `asapOpen` (= `openNow`), `asapBlockedReason`,
  `closedAutomatically` (`KitchenShiftState` in shared-types).
- `PUT /kds/shift/extend?storeId= {minutes: 30|60}` → `extendedUntil = max(closesAt,
extendedUntil, now) + minutes`, capped at four hours past the closing it extends:
  the current window's end within hours; the last window's end for a shift that was
  open then; four hours from now for a shift opened outside the hours (early
  opening). 409 `SHIFT_NOT_OPEN`, `SHIFT_EXTENSION_NOT_NEEDED` (open around the
  clock), `SHIFT_EXTENSION_LIMIT`. Emits `kds.shiftChanged` and
  `store.availabilityChanged`.
- Board banners: 15 minutes before `closesAt` (or the extension's end) — chime and
  «В 21:00 по графику конец работы — заказы «сейчас» перестанут приниматься» with
  [Продлить на 30 мин] [Продлить на 1 ч]; while the shift is open outside the hours
  with no extension — «По графику точка сейчас закрыта — заказы «сейчас» не
  принимаются» (and the next opening) with the same buttons. A closed shift the
  schedule closed: «Смена закрыта автоматически в 21:10 по графику».
- **Auto-close** (cron, every minute): shift open, outside the hours, no running
  extension, the next window not opening within 60 minutes, now ≥ the end of the
  last window / extension / the shift's own opening + `AUTO_CLOSE_GRACE_MINUTES`
  (10), and no order on the board due soon still CREATED/PAID/ACCEPTED, nor any
  IN_PROGRESS → closed with `closedById = null`, `closedAutomatically = true`;
  «Загружены» is cleared as on a manual close. READY orders stay on the board.
- `POST /kds/shift/close` → 409 `SHIFT_HAS_UNACCEPTED_ORDERS {count}` while orders
  awaiting acceptance are due soon. `GET /kds/shift/close-summary?storeId=` →
  `{awaitingAcceptance, inProgress, ready, later}`; the dialog that replaced
  `window.confirm` (board, «Точки», dashboard) shows it: unaccepted → blocked
  (accept or reject first), being made / ready → they stay, finish them; pre-orders
  for later → they come in the next shift.

## Client side (web, TMA, mobile)

Implemented on `feat/preorder-clients` against the same fields:

- Store list/detail: when `!openNow && acceptingOrders` — «Сейчас закрыто ·
  откроется в 9:00 · можно заказать ко времени» (`QUEUE_FULL`: «Очередь — только ко
  времени»; `OUTSIDE_HOURS` with `opensAt` tomorrow: «откроется завтра в 9:00»).
  When `openNow` and `closesAt`: «до 21:00».
- Checkout: ASAP disabled with the reason when `!openNow`, SCHEDULED preselected,
  slots over 24 hours with day labels («Сегодня», «Завтра»), `cartId` passed to
  `pickup-slots`, `ASAP_UNAVAILABLE` and `PICKUP_SLOT_FULL` handled. Checkout is
  blocked only when `!acceptingOrders`.
- Order status: awaiting acceptance — «Ждём подтверждения точки»; a pre-order
  awaiting acceptance while the store is closed — «Точка подтвердит предзаказ, когда
  откроется»; ACCEPTED/IN_PROGRESS past `pickupAt` — «Немного задерживаемся»; «Позвонить
  в точку» when the store has a phone.

## Configuration

| Variable                        | Default |                                                              |
| ------------------------------- | ------- | ------------------------------------------------------------ |
| `MAX_ASAP_WAIT_SECONDS`         | 2700    | longest ASAP handover; past it `QUEUE_FULL`                  |
| `PREORDER_OPENING_LEAD_MINUTES` | 15      | first pre-order slot after an opening nobody is on shift for |
| `ORDER_ACCEPT_ALERT_SECONDS`    | 180     | alert for an unaccepted order                                |
| `ORDER_ACCEPT_TIMEOUT_SECONDS`  | 480     | auto-cancel; never below the alert                           |
| `AUTO_CLOSE_GRACE_MINUTES`      | 10      | auto-close after the hours; 0 at once                        |
| `BUSY_EXTRA_WAIT_SECONDS`       | 300     | unchanged: «Загружены» extra wait                            |

Fixed in code: slot 15 min, pre-order lead 10 min, horizon 24 h, "due soon" 30 min,
pre-order group lead 15 min, start buffer 120 s, scheduled deadline 10 min before
pickup, late alert 5 min, extension cap 4 h, auto-close "next opening" window 60 min.

## Data model

Migration `20261014100000_kitchen_policy` (no backfill):

- `StoreShift.extendedUntil DateTime?`, `StoreShift.closedAutomatically Boolean @default(false)`.
- `Order.kitchenVisibleAt`, `acceptAlertSentAt`, `startReminderSentAt`,
  `lateNotifiedAt`, `lateAlertSentAt` (all `DateTime?`).

## Known limits

- An accept pressed in the same second as the timeout: the order status and the
  payment row are each claimed conditionally, but the bank calls (capture vs.
  release) cannot share a transaction. It is the same race as a customer cancel
  against an accept, not a new one; the Web-платёж flow gives back money that
  arrives for an expired order, the bound-card flow logs it for ops.
- The availability broadcast cron and the reminder crons run on every API instance;
  duplicates of `store.availabilityChanged` are harmless, the one-shot notices are
  claimed in the database.
- The ETA spill is a quote: two ASAP orders placed in the same second can both take
  the last room in a slot.
