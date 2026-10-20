# Round 2026-10-20 — contract for the parallel branches

Manager Maxim's third list (items 0–19, «САЙТ» 1–2, «ТГ АПП» 1–10). This file
is the shared contract the five branches of the round build against. It is
deleted (folded into `docs/kitchen-policy.md` and the changelog) when the round
is merged into `integration/2026-10-20`.

The shared types and texts below are **already on `integration/2026-10-20`**
(commit "contract"): `libs/shared-types` (catalog.ts, kitchen.ts, order.ts),
`libs/utils` (`orderDueAt`, `storeHoursNote` kinds `paused` / `closingSoon`),
`libs/i18n` (`storeHoursText` / `asapBlockedText` for PAUSED and CLOSING_SOON,
item 18 rename «Возврат» → «Возврат клиентов»). Do not change their meaning;
add to them if you must and say so in your report.

## Owner decisions (2026-10-20)

1. **The shift follows the schedule (items 4, 5, 6).** ASAP ordering opens by
   itself at the start of the working hours and closes exactly at their end.
   The kitchen has no «Начать работу» / «Закончить работу» any more. It can
   extend the closing by 30 / 60 minutes, but only in the last hour before
   closing (or while an extension runs). For an emergency it has «Пауза»
   (item 13). Accepted risk: if nobody comes in, orders still arrive. The 3-min
   alert and 8-min auto-cancel (money not taken) cover that. This reverses the
   2026-10-14 rule that a barista opens the shift.
2. **The customer cancels only before the kitchen accepts (item 19).** Once
   accepted — or whenever money has actually been charged — the API refuses
   and the clients show «Заказ уже готовят — для отмены позвоните в точку».
   The payment flow (charge on accept) does not change. Background: the prod
   Agroprombank terminal refuses refunds, and today a cancel after accept
   leaves the money charged.
3. **One PIN per employee for all their stores (items 2, 14).** The PIN is set
   on the employee's card, not per store. On the tablet: PIN first, then a
   store choice when the person works at more than one store, and switching
   without re-entering the PIN. Kitchen staff can be invited without a login
   and password. Telegram for order notifications is linked from the tablet
   through the bot (QR / link → the bot on the employee's own phone →
   `/start link_<code>`), with an «Отвязать» button.

## Shared contract

### Store availability (`GET /stores`, `GET /stores/:idOrSlug`)

- `asapBlockedReason` adds:
  - `PAUSED` — the kitchen paused the store. `pausedUntil` says until when.
  - `CLOSING_SOON` — within hours, but an order for now would not be ready
    before the closing boundary (`closesAt`, or `extendedUntil` when later).
  - Order of evaluation: `OUTSIDE_HOURS` → `PAUSED` → `SHIFT_CLOSED` →
    `CLOSING_SOON` → `QUEUE_FULL`.
  - The Dart client already maps unknown values to `unknown`; old app builds
    keep working.
- New fields `pausedUntil` (ISO UTC | null) and `pauseReason`
  (`StorePauseReason` | null).
- `currentEtaSeconds` now includes a **typical preparation time**: the
  median `prepTimeSeconds` of the store's orderable products (visible, in the
  store's menu, not on the stop list), cached for a few minutes. Before, it
  was `base + queue (+ busy)` with no product time at all (item 9).
  The «N мин» badge on every client shows this field, so every client,
  including published app builds, gets the change with no client work.

### Orders

- `POST /orders` ASAP:
  - refused with `ASAP_UNAVAILABLE {reason: 'PAUSED'}` while paused;
  - refused with `ASAP_UNAVAILABLE {reason: 'CLOSING_SOON'}` when the
    order's own `pickupAt` (its quote, spill included) is after the closing
    boundary (item 6: «последний заказ — за время готовки до закрытия»).
- `POST /orders` SCHEDULED: a slot inside a pause →
  `STORE_CLOSED_AT_TIME` (the existing code, so old clients understand it).
- Own ETA (item 10): `eta = base + queueWait + max(prepSeconds, workSeconds /
kitchenParallelism) (+ busy extra)`. Before it was `+ prepSeconds` only, so
  3× Американо counted as one.
- `Order.readyEstimateAt` (DTO + column): set when the kitchen accepts or
  starts an order too late to make `pickupAt`. Value: `now + max(prepSeconds,
workSeconds / kitchenParallelism)`, and only if that is later than
  `pickupAt`. `pickupAt` stays the original promise (analytics, slots, the
  board's «Опаздываем N мин»). The customer's countdown runs to
  `readyEstimateAt ?? pickupAt` (`orderDueAt` in libs/utils). The «Немного
  задерживаемся» push goes out only once that due time has passed. The accept
  push names the estimate («будет готов примерно к 12:10») when it is set.
- `Order.canCancel` (DTO only): true while the status is CREATED or PAID **and**
  nothing has been captured. A card hold or a charge put off until the accept
  is fine; captured money is not (e.g. `AGROPROMBANK_CHARGE_AT_CHECKOUT`, a
  Web-платёж without preauth). `POST /orders/:id/cancel` refuses anything
  else with 409 `ORDER_NOT_CANCELLABLE {reason: 'ACCEPTED' | 'CHARGED'}`.
- A customer's own cancel (before accept) → Telegram to the store team and the
  brand owner: «Клиент отменил заказ #1234 — он ещё не был принят». The board
  shows a toast and a short chime instead of the ticket just vanishing. The
  SLA auto-cancel (8 min) sends the same people: «Заказ #1234 отменён
  автоматически — его не приняли за 8 минут».

### Kitchen (`/kds/*`)

- The `kitchen-shift-schedule` cron opens a shift at the start of each
  window for every store that is not CLOSED. A 24/7 store, or one with no
  hours, keeps one open. Such a shift has `openedById = null` and
  `openedAutomatically = true` (new column). The cron closes the shift
  exactly at the end of the window or the extension. `AUTO_CLOSE_GRACE_MINUTES`
  defaults to 0. Orders in work do not hold the shift open: they stay on the
  board and are finished as usual. Closing the shift only stops new ASAP
  orders, which the hours stop anyway.
- `POST /kds/shift/open` and `POST /kds/shift/close` answer 409
  `SHIFT_FOLLOWS_SCHEDULE`. The admin UI no longer calls them.
- `PUT /kds/shift/extend` is allowed only when `KitchenShiftState.canExtend`
  is true: a shift is open, within hours and the closing is ≤ 60 minutes
  away, or an extension is running and is below its 4-hour cap. Otherwise 409
  `SHIFT_EXTENSION_NOT_ALLOWED`. Outside the hours nothing can be extended, so
  «Продлить» can no longer open ASAP ordering at night.
- **Pause**:
  - `PUT /kds/pause?storeId=` with body `KitchenPauseRequest` (minutes
    15/30/60/120 or null = until the closing boundary; `reason`; `comment` ≤ 120
    chars). `DELETE /kds/pause?storeId=` ends it.
  - Same roles as «Загружены», and PIN sessions are allowed.
  - Columns on Store: `pausedUntil`, `pauseReason`, `pauseComment`,
    `pausedById`.
  - While `pausedUntil > now`: ASAP is blocked (PAUSED), pre-order slots
    before `pausedUntil` are not bookable, and the cart still fills.
  - Telegram to staff and the owner on set (who, reason, comment, until)
    and on the end («Пауза снята» / «Пауза закончилась»).
  - `store.availabilityChanged` on set, end and expiry (the cron already
    watches `openNow`).
  - Cleared when the shift closes.
- `KitchenShiftState` adds `openedAutomatically`, `canExtend`, `pausedUntil`,
  `pauseReason`, `pauseComment`, `pausedByName`.

### Who builds what

| Branch                      | Worktree                          | Items                                                                                                                        |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `feat/schedule-shift-pause` | `.claude/worktrees/r1020-kitchen` | API kitchen policy above + admin kitchen board, «Точки» cards, dashboard (4, 5, 6, 9, 10, 13, 16 kitchen side, 19 API, ТГ 9) |
| `feat/staff-pin-telegram`   | `.claude/worktrees/r1020-staff`   | API auth / staff / bot webhook + admin staff, PIN, Telegram-link, owner password (2, 8, 14)                                  |
| `feat/web-round-1020`       | `.claude/worktrees/r1020-web`     | apps/web (1, 3, 15, 16 customer side, 19 UI, САЙТ 1–2)                                                                       |
| `feat/tma-round-1020`       | `.claude/worktrees/r1020-tma`     | apps/tma (ТГ 1–8, 10, cancel before accept, 16 customer side)                                                                |
| `feat/mobile-round-1020`    | `.claude/worktrees/r1020-mobile`  | apps/mobile + libs/api-client-dart (3, 16, 19 and the new fields)                                                            |

Migration folder prefixes, so the branches never collide: kitchen
`2026102010xxxx`, staff `2026102011xxxx`.

## Not coded this round — for the meeting

- **Item 11, ASAP load in a rush.** Today an ASAP order is never refused for a
  full slot: it spills to the next slot with room, up to 45 minutes ahead
  (`MAX_ASAP_WAIT_SECONDS`). With «3 заказа на 15 минут» a store therefore
  takes about 12 ASAP orders in the next 45 minutes, each one later than the
  last. Maxim wants a stronger rule; options are listed in the report.
- **Item 16, thresholds.** The fixed 5-minute late alert, and the
  3-minute accept alert against a short promise (base 1 min + prep 1 min). The
  report proposes scaling both to the promise.
