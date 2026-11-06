# Order queue and ready time

The calculator behind the manager's spec «Очередь и время готовности» (list 5.0,
2026-11-05; plain-text copy and the reference model `queue_model (…).py` in
`_materials/takeAway/2026-11-05_maxim-list-5.0/`). Since 2026-11-06 the calculator
exists as a pure module with tests; **nothing calls it yet** — what runs in
production is still described in `docs/kitchen-policy.md`. Section 2 is the plan
for wiring it in.

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

## 2. Wiring plan (next round)

### 2.1 Data model — migration `queue_policy`

| Model       | Field                                     | Default   | Notes                                                                                                        |
| ----------- | ----------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `Store`     | `prepStations Int`                        | 1         | C, «Позиций готовится одновременно», 1–10. `kitchenParallelism` (default 2) and `slotCapacity` are not read. |
| `Store`     | `loadExtraSeconds Int`                    | 600       | N, «Загрузка: +N мин», whole minutes 0–60. Replaces the global `BUSY_EXTRA_WAIT_SECONDS`.                    |
| `Product`   | `prepParallel Boolean`                    | false     | «Готовится параллельно». B stays `prepTimeSeconds` (default 180 s).                                          |
| `CartItem`  | `prepParallel Boolean`                    | false     | Set with `unitPrepSeconds` when the line is priced.                                                          |
| `Order`     | `placedUnderLoad Boolean`                 | false     | L: `Store.status = OVERLOADED` when the order was created.                                                   |
| `OrderItem` | `prepSeconds Int`, `prepParallel Boolean` | 0 / false | B and the flag per line, snapshotted at creation so a menu edit does not move orders in the queue.           |

A is `Store.baseEtaSeconds` as today; «Загрузка» is the existing «Загружены»
toggle (`Store.status = OVERLOADED`, label renamed); «Перерыв» is the existing
«Пауза» (`pausedUntil`). Data part of the migration: `OrderItem.prepSeconds` of
orders not finished yet from their product's `prepTimeSeconds` (snapshot
`productId`); everything else starts at the defaults. Variation and modifier
`prepTimeDeltaSeconds` stop counting (spec: B does not depend on variants), the
columns stay.

### 2.2 Building the state — `QueueStateService` (kitchen module)

One query per store (or a batch for the store list):

- orders with status CREATED and `kitchenVisibleAt` set, PAID, ACCEPTED (queued or
  reserved) and IN_PROGRESS (started); READY and later, CANCELLED, EXPIRED and
  orders whose card has not gone through are left out;
- T = `kitchenVisibleAt` (when the order became the kitchen's; equals `createdAt`
  when nothing is paid by card), `seq` from `createdAt` then id;
  `acceptedAt`, `startedAt` as stored; `readyBy = pickupAt` for SCHEDULED;
- items from `OrderItem.prepSeconds × quantity` and `prepParallel`;
- `hours` from `hoursAround()` (DST-safe) with the current window stretched to
  `StoreShift.extendedUntil`; `loadOn` = OVERLOADED; `paused` = `pausedUntil > now`.

### 2.3 Code paths replaced

| Today                                                                                                                                 | With the calculator                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `KitchenLoadService.quote` / `asapPlan` / `queueWaitByStore` (work ÷ parallelism, half of IN_PROGRESS, 30-min «due soon», slot spill) | `quoteAsap` — cart `etaSeconds`, `POST /orders` ASAP `pickupAt = readyAt`, `CLOSING_SOON`                  |
| `asapByStore` + `typicalPrepByStore` (store card «N мин»)                                                                             | `quoteAsap` with one typical position (the median B, `typical-prep.ts` stays)                              |
| `slots.ts`, `slotCapacity`, `pickupSlots`, `assertScheduledSlot`                                                                      | `preorderWindows` / `isPreorderTimeAvailable`; the 15-minute grid and its capacity go                      |
| `MIN_SCHEDULED_LEAD_MINUTES` (10 min)                                                                                                 | t + A + N·L + D                                                                                            |
| `PREORDER_OPENING_LEAD_MINUTES` (15 min after an opening nobody is on shift for)                                                      | kept: that window is passed in `hours` starting 15 minutes later (pre-opening orders are outside the spec) |
| `BUSY_EXTRA_WAIT_SECONDS`                                                                                                             | per-store N                                                                                                |
| `kitchen-timeline.ts` `cookingSeconds` / `startBy` / `readyEstimate`                                                                  | the schedule's `startAt` / `readyAt`; the A-based accept reminder and timeout stay as they are             |
| `Order.readyEstimateAt` set only on a late accept or start                                                                            | set to G by the recompute below whenever G ≠ `pickupAt` (clients already count down to it)                 |

Recompute (spec 5): on every new order, accept, start, ready, cancel and expiry,
and once a minute for stores with active orders (fold into the `kitchen-order-sla`
cron): `scheduleQueue`, write `readyEstimateAt` of orders whose G moved by a
minute or more, emit `order.statusChanged` with the new `etaSeconds` (or a new
`order.etaChanged`), and `store.loadChanged` with the store's new «N мин».
`Order.prepSeconds` / `workSeconds` stay for analytics only.

### 2.4 API and DTOs

- Admin store DTO: `prepStations` (1–10), `loadExtraSeconds` (whole minutes 0–60);
  the editor shows «Позиций готовится одновременно» and «Загрузка: +N мин».
- Admin product DTO: `prepParallel`; the editor shows «Время приготовления, мин»
  (B, edited in minutes, stored in seconds) and the «Готовится параллельно» box;
  variation/modifier prep deltas leave the editor.
- `GET /stores/:id/ready-windows?cartId=` → `{ from, to }[]` (ISO, whole minutes,
  both ends included) for the cart's basket. `GET /stores/:id/pickup-slots` stays
  for published app builds: a 15-minute slot start is `available` when it lies in a
  window; drop it once the minimum supported build uses windows.
- Cart DTO: `etaSeconds` stays; add `readyAt`, `asapAvailable`,
  `asapBlockedReason`.
- `POST /orders`: ASAP → `ASAP_UNAVAILABLE` with the quote's reason; SCHEDULED →
  `isPreorderTimeAvailable` under a per-store lock (`pg_advisory_xact_lock` in the
  order transaction), else `PICKUP_SLOT_FULL` (code kept) — two customers cannot
  book the same window.
- Store DTO: `currentEtaSeconds` and `asapBlockedReason` from the typical quote.
- KDS row: `startBy` = planned O, new `plannedReadyAt` = G (board «готов к 12:11»).
  «Начать» / «Готово» stay whole-order buttons.

### 2.5 What the customer sees

- Cart and checkout: «Если закажете сейчас — будет готово в 12:11 · ≈ 11 мин»
  (`readyAt` rounded up to the minute in the store's zone, `readyWaitMinutes`);
  «Не успеем до закрытия — выберите заказ ко времени» on `CLOSING_SOON`;
  «Заведение на перерыве» on `PAUSED` (today «Технический перерыв»).
- «Ко времени»: the free windows («12:56–13:00», «13:16–20:00», tomorrow's
  separately) and a time picker inside them.
- Order screen: «Готов в 12:11 · ≈ 11 мин», updated on every recompute; the
  countdown runs to `orderDueAt` (`readyEstimateAt ?? pickupAt`).
- Shared strings in `libs/i18n`, the same on web, TMA and the Flutter app.

### 2.6 Risks and data migration

- **C = 1 for every store** (the agreed start value) where `kitchenParallelism` is
  2 today: quotes get longer until owners set C. Tell the owners at release.
- **B quality.** Every Poster-imported product has the default 180 s and no
  product has the parallel flag yet; the quotes are only as good as these. Owners
  review B and the flag before switching on.
- **Pre-orders booked on 15-minute slots** become reserves at their `pickupAt`;
  where slot capacity allowed several in one slot on one station, the later-booked
  ones are laid earlier (their «начать в» on the board moves earlier, the
  customer's time does not change).
- **Orders in flight at deploy** get `OrderItem.prepSeconds` from the current menu
  (backfill) and no parallel flag.
- **Feature flag** `QUEUE_POLICY_ENABLED`: old path vs calculator for quotes, slots
  and the board, switched on test.takeaway.md first.
- **Load.** Windows are computed per checkout render: cache per (store, basket
  shape) for a few seconds and recompute on `store.loadChanged`.

### 2.7 Open questions for the manager

1. «Перерыв»: the spec takes no pre-orders at all while it is on; today (owner,
   2026-10-20) pre-orders for a time after the pause end are taken. Which one?
   (The calculator can do both: `paused`, or the pause as a gap in `hours`.)
2. The spec has no longest ASAP wait; today an ASAP order is refused past
   45 minutes (`QUEUE_FULL`). Keep the cap?
