# Order queue and ready time

The calculator behind the manager's spec «Очередь и время готовности» (list 5.0,
2026-11-05; plain-text copy and the reference model `queue_model (…).py` in
`_materials/takeAway/2026-11-05_maxim-list-5.0/`). Since 2026-11-06 the calculator
exists as a pure module with tests; since 2026-11-09 it is wired into the API,
the admin, the web and the Mini App **behind `QUEUE_POLICY_ENABLED`** (section 2):
on in staging, off in production, where `docs/kitchen-policy.md` still describes
what runs.

## 1. The calculator

`libs/utils/src/lib/queue-policy/`, exported from `@takeaway/utils`. No Nest,
Prisma, clock or network: the caller passes the store's state and `now`. Instants
are epoch ms (UTC), durations seconds.

### Inputs

| Spec                        | Field                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------- |
| A                           | `settings.acceptSeconds` — «Время на принятие заказа» (today `Store.baseEtaSeconds`)  |
| N                           | `settings.loadExtraSeconds` — what «Загрузка» adds                                    |
| C                           | `settings.stations` — positions made at once                                          |
| B, flag                     | `QueueItem.prepSeconds`, `parallel` («Готовится параллельно»), `quantity` unfolds     |
| Tᵢ, number                  | `QueueOrder.placedAt`, `seq` (tie-break)                                              |
| L                           | `QueueOrder.placedUnderLoad` (snapshot at creation); `state.loadOn` for new orders    |
| «Принял»                    | `QueueOrder.acceptedAt` → R                                                           |
| «Начать»                    | `QueueOrder.startedAt` — for the **whole order** (manager's decision)                 |
| «Готово», «Выдан», «Отмена» | the order is left out of `orders`                                                     |
| P                           | `QueueOrder.readyBy` — set for a pre-order                                            |
| hours                       | `state.hours` — merged UTC windows (null: around the clock), the extension included   |
| «Перерыв»                   | `state.paused`                                                                        |
| —                           | `state.blocked` — station time taken by something else (used by the model-port tests) |

### How it lays the queue out (spec 3.3, 3.5, 4, 7)

1. **Reserves.** Pre-orders not started yet, in booking order: each station
   position ends as close to P as it can, the last at P, each earlier one no later
   than the one after it, around earlier reserves; parallel positions end at P.
   A pre-order is ready at P. Reserves are re-derived from the orders on every run,
   not stored.
2. **Started orders** (by `startedAt`): station positions from the start, each on
   the station free first, never moved and not looking at reserves. A station is
   busy at least until now (only «Готово» frees it), so fⱼ = max(planned end, t);
   the order is ready no sooner than now.
3. **The ASAP queue**, FIFO by T (then `seq`, then input order). For every station
   position: the station where it starts first, with
   `s ≥ max(R, fⱼ, t, S_пред)` and `[s, s + B)` clear of reserves (a position that
   does not fit before a reserve starts at its end). R = T + A + N·L, or the
   «Принял» moment. Parallel positions take no station and run from O (the first
   station position's start; with none, O = max(R, t, S*пред), which also becomes
   S*пред). G = max(E, O + longest parallel).

### Functions

- `scheduleQueue(state, now)` → every order's `readyAt` (G), `startAt` (O),
  `stationsFreeAt` (E / K), `canStartAt` (R), `position` (1-based among the ASAP
  orders not started), each position's station and times; per-station `busy`.
- `quoteAsap(state, cart, now)` → the cart placed now at the end of the queue:
  `readyAt`, `waitMinutes` (⌈G − t⌉), `position`, `available` and `reason`:
  `OUTSIDE_HOURS` → `PAUSED` → `CLOSING_SOON` (ready after the window it is placed
  in closes; ready exactly at the closing is fine). The codes are those of
  `AsapBlockedReason`.
- `preorderWindows(state, basket, now, {horizonMs = 24 h})` → runs of whole
  minutes P the basket can be ready at: station positions laid from P backwards
  must fit free station time (not the queue's, not other reserves, not blocked)
  without being pushed earlier, nothing starts before t + A + N·L, and all of it
  lies in one window of the hours (P may equal the closing). With C = 1 this is
  exactly the spec's `P ∈ [max(a + D_ст, t + A + N·L + D); b]` (tested against the
  formula). Empty during «Перерыв».
- `isPreorderTimeAvailable(state, basket, P, now)` — the same check for one exact
  instant, for the order path.
- `orderCanStartAt(order, settings)` (R), `readyWaitMinutes(G, now)`.

A windows call evaluates up to 1 441 minutes; each check is a few positions ×
C stations × the station's busy list — milliseconds for a store's day.

### Interpretations and where the spec and the model differ

- **3.5, parallel-only orders.** The short C = 1 form says Oᵢ = max(Rᵢ, Oᵢ₋₁); the
  general form says Oᵢ = max(Rᵢ, t, S*пред), where S*пред is the start of the
  previous order's _last_ position. They differ when the previous order has
  several station positions (3 americanos then a cola: 12:05/12:06 vs 12:07/12:08).
  The model follows the general form, and so does the calculator (a test pins it).
- **Hours and orders already taken.** Spec 4 marks time outside the hours busy for
  every queue position; applied literally, a late order not finished by the
  closing would be forecast for the next morning. The calculator applies the hours
  to new orders only (the ASAP quote, the windows); orders already taken are
  forecast past the closing. The model never passes `close` to `schedule()`, so no
  check depends on it.
- **«Начать» / «Готово» per order** instead of per position (spec 5): a started
  order is laid out over the stations from its start; with one position this is
  exactly the spec's fⱼ = max(S_факт + B, t) (every model check with a started
  position has one).
- **Pre-orders up to 24 hours ahead**, not only today (spec 7, 9) — manager's
  decision. Before an opening a basket can be ready from the opening + its cooking.
- **C > 1 windows.** The spec only says the positions are laid «с конца» and must
  all fit. Read as: packed back from P with no gap forced by somebody else's time;
  equal ends go to the last station (the queue fills from the first).
- **Parallel positions of a pre-order end at P** («каждая заканчивается как можно
  ближе к P») rather than starting at O; G = P either way, and the window check
  needs t + A + N·L + D ≤ P as in the spec.
- **Shown ready time.** The spec rounds only the wait (⌈G − t⌉). Show G rounded up
  to the minute (`Math.ceil(G / 60 000)`), so the clock time is never early.
- **A pre-order nobody started by its reserve's start** stays ready at P and keeps
  its reserve; how far to forecast lateness is a separate rule (spec 5).
- **Re-laid reserves ignore the queue.** A reserve was checked against the queue
  when it was booked; laid out again later, with C > 1 it may land on another
  station than at booking. Stations are interchangeable, so the queue then takes
  the other one; only fragmented multi-station days could shift an ASAP forecast.

## 2. Wiring (since 2026-11-09, behind `QUEUE_POLICY_ENABLED`)

The plan of 2026-11-06 is wired. Everything runs behind the env flag
`QUEUE_POLICY_ENABLED` (`FeatureFlagsService.queuePolicyEnabled`, default
off): with it off the API answers exactly as before (docs/kitchen-policy.md);
with it on the calculator drives the quotes, the pre-order times, the booking
and the kitchen board. Section 2.8 says how to switch it on. Where the build
departs from the plan, the subsection says so and why.

### 2.1 Data model — migration `20261109110000_queue_policy`

| Model       | Field                                       | Default | Notes                                                                                                                                                                                                         |
| ----------- | ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Store`     | `kitchenParallelism` (existing)             | 2       | **C**, «Позиций готовится одновременно», 1–20. Reused instead of a new `prepStations`: the same setting under the same label, so every store keeps the value its owner set and nobody's quotes jump to C = 1. |
| `Store`     | `loadExtraSeconds Int`                      | 600     | **N**, «Загрузка: +N мин», whole minutes 0–60. Replaces `BUSY_EXTRA_WAIT_SECONDS` with the flag on.                                                                                                           |
| `Product`   | `prepParallel Boolean`                      | false   | «Готовится параллельно». B stays `prepTimeSeconds`.                                                                                                                                                           |
| `Order`     | `placedUnderLoad Boolean`                   | false   | **L**: the store was OVERLOADED when the order was created. Written for every order, flag on or off.                                                                                                          |
| `OrderItem` | `prepSeconds Int?`, `prepParallel Boolean?` | null    | B and the flag per line, written while the flag is on. Null on orders placed with it off: the queue reads their product as it is now (by the snapshot's product id), else the line's `unitPrepSeconds`.       |

- **No `CartItem.prepParallel`**: the cart quote reads B and the flag from the
  products as they are now (one query) — a cart is not an order, and a menu
  edit should show in it at once.
- **No backfill**: the nullable line columns and the read-through to the
  product cover orders in flight whenever the flag is switched on, which a
  one-time backfill at deploy could not.
- Variation and modifier `prepTimeDeltaSeconds` do not count with the flag on
  (B is the product's own time); they still count in the old ETA, so they stay
  in the editor.

### 2.2 Building the state — `QueueStateService` (kitchen module)

`kitchen/queue-state.ts` (pure, tested) and `queue-state.service.ts` (reads).
One query for the orders of any number of stores, one for the products of
lines without a snapshot:

- orders CREATED with `kitchenVisibleAt` set, PAID, ACCEPTED and IN_PROGRESS;
  **unpaid pre-orders too** (CREATED, SCHEDULED, no `kitchenVisibleAt`) — a
  pre-order holds the time its customer picked while they pay, as a 15-minute
  slot did; an unpaid ASAP order joins the queue once its payment lands.
  Orders due more than 2 hours ago (`pickupAt` and `readyEstimateAt`) are left
  out: a ticket nobody pressed «Готово» for must not hold a station all day;
- T = `kitchenVisibleAt` (`createdAt` for older orders), `seq` by `createdAt`
  then id; `acceptedAt`, `startedAt` (an IN_PROGRESS order without one counts
  as started when accepted); `readyBy = pickupAt` for SCHEDULED;
- A = `acceptWindowSeconds(baseEtaSeconds)` (as the accept reminder), N, C;
  `hours` from `hoursAround()` with the window open now (or the one that closed
  last) stretched to `StoreShift.extendedUntil`; `loadOn` = OVERLOADED;
  `paused` = `pausedUntil > now`;
- for pre-orders (`preorderState`): «Перерыв» is a **gap in the hours** (the
  owner's rule of 2026-10-20 — pre-orders after the pause are taken; cooking
  starts after it ends), and a window nobody is on shift for yet starts
  `PREORDER_OPENING_LEAD_MINUTES` later.

### 2.3 Code paths (flag on)

| Before                                                             | With the flag on                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KitchenLoadService.quote` for the cart                            | `QueuePolicyService.quoteBasket` → cart `etaSeconds`, `readyAt`, `asapAvailable`, `asapBlockedReason`                                                                                                                                                                                    |
| `asapByStore` + `typicalPrepByStore` (store «N мин», availability) | `typicalQuotes`: one position of the median B at the end of the queue; `StoreAvailabilityService` feeds its wait to the same `storeAvailability()` rules (reason order unchanged)                                                                                                        |
| ASAP `POST /orders` (quote, spill, `QUEUE_FULL` past 45 min)       | `pickupAt` = G of the basket, quoted again under the store lock; `CLOSING_SOON` when G is after the closing (extension included), `QUEUE_FULL` past `MAX_ASAP_WAIT_SECONDS` (kept — owner decision)                                                                                      |
| `slots.ts`, `pickupSlots`, `assertScheduledSlot`, 10-minute lead   | `preorderWindows` / `isPreorderTimeAvailable` (t + A + N·L + D); `pickup-slots` is read off the windows                                                                                                                                                                                  |
| `BUSY_EXTRA_WAIT_SECONDS`                                          | the store's N                                                                                                                                                                                                                                                                            |
| `kitchen-timeline.ts` `startBy` on the board, the start reminder   | the plan's O (`startBy`) and G (`plannedReadyAt`); «Пора готовить предзаказ» at O; `acceptAlertAt` / `acceptDeadlineAt` stay A-based (kitchen-timeline)                                                                                                                                  |
| `readyEstimate()` on a late accept or start                        | `QueueRecomputeService` (orders module): after a new order, a payment landing, accept, start, «Готово», «Выдан», cancel, expiry and once a minute (`kitchen-order-sla`) — `readyEstimateAt` = G when it moved a minute or more (null when G is the promise again), `order.statusChanged` |

The recompute leaves alone an order already past its own plan (G within a
minute of now): moving its estimate with the clock would hide the delay —
«Немного задерживаемся» runs off the estimate — and ping its customer every
minute. It announces `store.loadChanged` when the store's «N мин» changed.

### 2.4 API and DTOs

- Admin store DTO: `loadExtraSeconds` (seconds, whole minutes 0–60); C is the
  existing `kitchenParallelism`. Admin product DTO: `prepParallel`.
- `GET /stores/:idOrSlug/ready-windows?cartId=` → `{ from, to }[]` (ISO, whole
  minutes, both ends included) for the cart's basket, else one position of the
  store's typical B. With the flag off it answers the free 15-minute slot
  starts as one-minute windows (what the order path books then).
- `GET /stores/:idOrSlug/pickup-slots` (published app builds): with the flag
  on, the slot starts of the next 24 hours; those the time rules close (too
  soon, outside the hours, «Перерыв», the opening lead) are left out, the
  others `available` when they lie in a window; `taken` as before.
- Cart DTO: `etaSeconds` stays; `readyAt`, `asapAvailable`,
  `asapBlockedReason` only with the flag on (absent otherwise).
- `POST /orders`: checks before the transaction and again inside it under
  `pg_advisory_xact_lock(hashtext('queue-policy:<storeId>'))`; SCHEDULED →
  `PICKUP_TIME_OUT_OF_RANGE` (`minMinutes` = the soonest minute the basket can
  be ready), `STORE_CLOSED_AT_TIME` (outside the hours, «Перерыв», opening
  lead) or `PICKUP_SLOT_FULL` (codes kept). An opt-in Postgres test
  (`queue-booking.db.spec.ts`, `QUEUE_IT_DATABASE_URL`) books the same ten
  minutes from two transactions at once: one wins.
- Order DTO: `readyFromQueue: true` while the flag is on (absent otherwise).
- KDS row: `startBy` = O, `plannedReadyAt` = G («готов к 12:11 · начать в
  12:05»). «Начать» / «Готово» stay whole-order buttons.
- `/config/features`: `queuePolicyEnabled: true` only while on.

### 2.5 What the customer sees (web, Mini App)

- Cart and checkout, ordering for now: «Если закажете сейчас — будет готово в
  12:11 · ≈ 11 мин» (`readyAt` rounded up to the minute in the store's zone);
  on `CLOSING_SOON` «Сейчас» is off and «Не успеем до закрытия — выберите
  заказ ко времени» shows (a time later is preselected).
- «Ко времени»: the free windows as times in the existing picker — each
  window's ends and every five minutes inside it, grouped by day.
- Order screen: «Готов в 12:11 · ≈ 11 мин» while it counts down (web: beside
  the address; Mini App: under the countdown), to `orderDueAt`.
- Strings: `common.queue.*` in libs/i18n. «Заведение на перерыве» (PAUSED) was
  not changed: the existing «Технический перерыв» texts serve both modes.
- The Flutter app needs no change: every new field is optional, it keeps
  `pickup-slots` (read off the windows) and counts down to
  `readyEstimateAt ?? pickupAt`, which the recompute keeps current.

### 2.6 Risks

- **B quality.** Every Poster-imported product has the default 180 s and no
  product has «Готовится параллельно» yet; the quotes are only as good as
  these. Owners review B, the flag, C and N before switching on.
- **Pre-orders booked on 15-minute slots** become reserves at their `pickupAt`;
  where slot capacity allowed several in one slot on one station, the later
  booked ones are laid earlier (their «начать в» moves earlier, the
  customer's time does not change).
- **Load.** A windows answer evaluates up to 1 441 minutes per request; not
  cached yet (milliseconds for a store's day).
- **The board** refreshes its O and G on its 30-second poll and on every
  ticket event; the recompute does not push board rows.
- The 45-minute cap and the store-level `CLOSING_SOON` still use a typical
  order (docs/kitchen-policy.md, known limits); the cart and the order path use
  the basket itself.

### 2.7 Open questions — answered for now (2026-11-09)

1. «Перерыв»: today's owner rule — pre-orders are taken for times whose
   cooking starts after the pause ends (the pause is a gap in the hours).
2. The 45-minute cap on an ASAP order stays (`QUEUE_FULL`,
   `MAX_ASAP_WAIT_SECONDS`).

Both until the manager says otherwise.

### 2.8 Switching it on

- **Staging** (test.takeaway.md): on — `deploy/docker-compose.staging.yml`
  sets `QUEUE_POLICY_ENABLED: 'true'` for the api (docs/environments.md).
- **Production**: off. To switch on, after the owners checked C, N, B and the
  parallel flags in the admin: `QUEUE_POLICY_ENABLED=true` in production's
  `deploy/.env.production`, then redeploy (or recreate the api). To switch off
  again, remove the line: orders placed meanwhile keep their snapshots and the
  old rules simply ignore them.
- `/api/config/features` shows `queuePolicyEnabled: true` while it is on.
