# Акции takeAway — takeAway's own promos and the welcome bonus

Maxim's list 5.0, item 20 (spec «Учёт акций takeAway», 2026-11-05; Maxim's
answers 2026-11-06 №11 and №16). Not to be confused with a brand's own promo
codes («Акции → Промокоды», `Promo`), which the brand pays for.

## 1. The rule

A takeAway promo is a percent discount at **every venue** that sells in the
promo's currency. takeAway pays for it:

| Symbol | Meaning                                                        |
| ------ | -------------------------------------------------------------- |
| P      | the order at menu prices, variants and add-ons included        |
| s      | the promo's percent, 1..99 (100 % would leave nothing to card) |
| D      | discount = P × s / 100, to the cent, **half up**               |

- The guest pays **P − D**; that card money goes to the venue as usual.
- takeAway owes the venue **D** (a «задолженность takeAway»), repaid in the
  next payout as its own line «Компенсация takeAway по акциям».
- The commission is taken on **P**, not on P − D: a promo order pays the venue
  exactly what a regular order of the same menu price would.
- Money is integer minor units everywhere; `takeawayPromoDiscountCents` in
  `@takeaway/utils` is the only place D is computed (15.55 at 10 % → 1.56).

| P      | s    | D     | guest pays | takeAway owes |
| ------ | ---- | ----- | ---------- | ------------- |
| 100,00 | 10 % | 10,00 | 90,00      | 10,00         |
| 15,00  | 10 % | 1,50  | 13,50      | 1,50          |
| 45,00  | 10 % | 4,50  | 40,50      | 4,50          |
| 15,55  | 10 % | 1,56  | 13,99      | 1,56          |

Out of scope (separate rules later): refunds of counted orders, fixed-amount
discounts, promos paid by the venue (those are the brand's own promo codes —
answer №11: takeAway never pays for those).

## 2. Decisions

1. **One code field.** The customer types any code into the existing promo
   field. The brand's promo with that code wins; otherwise a takeAway promo is
   looked up. Codes cannot collide: a takeAway promo cannot take a code any
   brand promo has, and a brand promo cannot take a takeAway code (both answer
   409 with their usual «code taken» error).
2. **One promo per order.** A takeAway promo and a brand promo never meet (one
   field). A takeAway promo and **loyalty points do not combine** (loyalty
   spec, item 18): `POST /orders` with both answers 400 `PROMO_WITH_POINTS`;
   the clients disable «Оплатить баллами» with «Баллы нельзя совместить с
   промокодом». A gift card still pays the rest.
3. **Currency.** The budget is in one currency (`currency`); the promo works at
   stores selling in it. Elsewhere: 400 `PROMO_NOT_HERE`.
4. **The budget is taken at checkout, not at the payment.** `POST /orders`
   takes D from the budget in the order's own transaction with one conditional
   update — `spentCents + D <= budgetCents`, the promo ACTIVE and inside its
   dates — so two checkouts at once never overspend (a DB CHECK backs it up).
   The order holds the promo while the customer pays; a cancelled order, an
   order that expires unpaid, or a card declined on accept gives D back
   (`spentCents −= D`, the redemption row is deleted, the welcome bonus is
   free again). This is the spec's «used only after a successful payment»: a
   failed payment leaves the customer able to use the code again and the
   budget untouched. The window between checkout and payment is minutes, so
   «re-check at payment» is not needed: the reservation already guarantees it.
5. **Exhausted.** When a discount does not fit what is left, the order gets
   no promo (400 `PROMO_LIMIT_REACHED`) and the promo becomes `EXHAUSTED`
   at once; also when what is left reaches exactly 0. It stays exhausted even
   if a cancelled order gives budget back; the platform admin raises the
   budget and switches it on again.
6. **Once per customer.** Unique `(promoId, userId)` on the redemption.
7. **Editing.** Unused: every field. Used (≥ 1 redemption): only `name`,
   `endsAt` and `budgetCents` (never below `spentCents`); percent, code,
   currency, start and the welcome flag are frozen (409
   `TAKEAWAY_PROMO_USED`). Switching off and on any time. Nothing done to a
   promo changes orders already placed (they carry their own snapshot).
8. **Debt status.** A promo order's debt is
   - `ACCRUED` («начислена») once the order counts (paid by card or accepted,
     the same «counts» as settlements) and no payout covers it yet;
   - `IN_PAYOUT` once «Зафиксировать выплату» created a payout that includes
     it (the redemption's `payoutId` is stamped then; deleting that pending
     payout clears it);
   - `REPAID` («погашена», with the payout's `paidAt`) once that payout is
     marked paid.
     The current debt is accrued − repaid, per brand and in total.
9. **Welcome bonus** (answer №16: yes; push + profile banner; auto-applied to
   the first order; removable in the cart):
   - The platform admin marks one takeAway promo `isWelcome` (at most one
     ACTIVE welcome promo at a time — 409 `TAKEAWAY_PROMO_WELCOME_TAKEN`).
   - A **new** customer account (Telegram, Google, Apple, email code) gets a
     `WelcomeBonus` right at sign-up when an ACTIVE welcome promo is inside its
     dates with budget left; otherwise nothing and no message.
   - Once per person, ever: `identityHash` = sha256 of the identity the
     account was created with (`tg:<telegram id>`, `email:<address>`,
     `oauth:<provider>:<sub>`), unique and kept when the account is deleted.
   - Valid 7 days from sign-up (`WELCOME_BONUS_DAYS`), once.
   - The inbox item and the push go out a minute after sign-up (a cron), so
     the app has registered its device by then; Mini App and web customers get
     it from the bot, as any push. Text from `welcomeBonusMessage(percent,
locale)`; it is a `PLATFORM_ANNOUNCEMENT` inbox item, push kind
     `announcement` — no new kinds, older apps show it.
   - The code of the welcome promo works only for customers holding an unused,
     unexpired bonus for it (otherwise `PROMO_NOT_ELIGIBLE`, expired →
     `PROMO_EXPIRED`, used → `PROMO_ALREADY_USED`).
   - Accounting is that of any takeAway promo.

## 3. Data model

`apps/api/prisma/schema.prisma`, migration `20261110100000_takeaway_promos`:

- `TakeawayPromo` — `name, code (unique, uppercase), percent, startsAt,
endsAt, currency, budgetCents, spentCents, status ACTIVE|DISABLED|EXHAUSTED,
exhaustedAt, isWelcome, createdById`.
- `TakeawayPromoRedemption` — one order holding a promo = the debt:
  `promoId, userId, orderId (unique), brandId, storeId, currency, code,
percent, menuTotalCents (P), discountCents (D), payoutId?`; unique
  `(promoId, userId)`.
- `WelcomeBonus` — `promoId, userId (unique), identityHash (unique),
expiresAt, orderId? (unique; the order holding it), notifiedAt`.
- `Order.takeawayDiscountCents` — D, snapshotted; **also included in
  `discountCents`**, so totals, tax and every receipt keep working.
  `couponCode` keeps the code.
- `BrandPayout.compensationCents` — Σ D the payout settles (already inside
  `amountCents`).

## 4. API

Shared types: `libs/shared-types/src/lib/takeaway-promo.ts`, plus the fields
added to `ValidPromoResult`, `Order`, `SettlementTotals`,
`SettlementPayoutPreview`, `SettlementPayout`, `PromoErrorCode`.

### 4.1 Platform admin (SUPER_ADMIN only)

| Route                                     | Answer                | Notes                                                                                                                                       |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/takeaway-promos`              | `TakeawayPromo[]`     | newest first                                                                                                                                |
| `POST /admin/takeaway-promos`             | `TakeawayPromo`       | `CreateTakeawayPromoInput`; code 2..32 `[A-Za-z0-9_-]`, stored uppercase                                                                    |
| `GET /admin/takeaway-promos/:id`          | `TakeawayPromo`       |                                                                                                                                             |
| `PATCH /admin/takeaway-promos/:id`        | `TakeawayPromo`       | `UpdateTakeawayPromoInput`, rules of §2.7                                                                                                   |
| `PATCH /admin/takeaway-promos/:id/status` | `TakeawayPromo`       | `{ status: 'ACTIVE' \| 'DISABLED' }`; ACTIVE from EXHAUSTED only with budget left (409 `TAKEAWAY_PROMO_BUDGET`); welcome uniqueness checked |
| `GET /admin/takeaway-promos/:id/report`   | `TakeawayPromoReport` | counted orders only; by brand, store and UTC day                                                                                            |
| `GET /admin/takeaway-promos/debt`         | `TakeawayDebtReport`  | every brand with promo orders, totals per currency, now                                                                                     |

Errors carry `{ statusCode, error, code, message }` with
`TakeawayPromoAdminErrorCode`: `TAKEAWAY_PROMO_CODE_TAKEN` (409),
`TAKEAWAY_PROMO_USED` (409), `TAKEAWAY_PROMO_DATES` (400),
`TAKEAWAY_PROMO_PERCENT` (400), `TAKEAWAY_PROMO_BUDGET` (400 on a budget
below spent / under 1; 409 on switching on with nothing left),
`TAKEAWAY_PROMO_WELCOME_TAKEN` (409), `TAKEAWAY_PROMO_STATUS` (409).

### 4.2 Brand cabinet (SUPER_ADMIN, BRAND_ADMIN — brand scope as settlements)

`GET /admin/settlements/takeaway-promos?brandId=&currency=&from=&to=` →
`BrandTakeawayPromoReport`. `from`/`to` are local days of the brand (as the
settlements report); the summary and the list cover orders that counted in
the period; `currentDebtCents` is all time, now, and equals the brand's row
of `GET /admin/takeaway-promos/debt`.

`GET /admin/settlements` (the report) gains `totals.takeawayCompensationCents`
(and per day); `commissionBaseCents` = captured − refunded + compensation;
`payableCents` = base − commission. `nextPayout.compensationCents` and every
`payouts[].compensationCents` say what part of the payout is the
compensation.

### 4.3 Customers

- `POST /promo/validate` (signed in) and `POST /promo/preview` (public) take an
  optional `storeId`. A takeAway code answers `valid: true`, `promo: null`,
  `source: 'TAKEAWAY'`, `takeawayPromo: { id, code, name, percent, isWelcome }`,
  `discountCents: D`, `pointsMultiplier: 1`. A brand code answers as before plus
  `source: 'BRAND'`. Refusals: `PROMO_UNKNOWN`, `PROMO_INACTIVE` (switched
  off), `PROMO_NOT_STARTED`, `PROMO_EXPIRED` (past its end, or a welcome bonus
  past its 7 days), `PROMO_LIMIT_REACHED` (budget), `PROMO_ALREADY_USED`,
  `PROMO_NOT_ELIGIBLE` (a welcome code without a bonus; a guest preview of a
  welcome code), `PROMO_NOT_HERE` (currency).
- `POST /orders` with `couponCode` = a takeAway code: the same checks, then the
  reservation of §2.4. With `pointsToSpend > 0` as well → 400
  `PROMO_WITH_POINTS`. The order answer carries `takeawayPromo:
TakeawayPromoLine | null` (also `GET /orders/:id` and the order lists).
- `GET /me/bonuses` → `CustomerBonus[]`: the customer's welcome bonus while
  unused, unexpired, and its promo ACTIVE, in its dates and with budget left;
  `[]` otherwise.

### 4.4 Staff

The admin order detail and the kitchen board row carry `takeawayPromo:
TakeawayPromoLine | null`, so the card can say «Акция takeAway −10%: гость
оплатил 90,00, ещё 10,00 компенсирует takeAway» — the order is fully paid,
nothing to collect from the guest.

## 5. Screens

**Admin, platform admin** — sidebar «Акции takeAway» (platform section,
SUPER_ADMIN only): the list (name, code, %, dates, currency, budget / spent /
left, status, «приветственная» badge, orders), create / edit (frozen fields
read-only once used), switch off / on, «Отчёт» (tiles: orders, customers,
budget, spent, left; tables by brand, by store, by day) and «Долг takeAway»
(per brand: accrued, in payout, repaid, debt; totals per currency).

**Admin, brand cabinet** — «Взаиморасчёты»: the totals get «Компенсация
takeAway по акциям» and the commission note says it is taken on the full
price; payouts show their compensation; a new block «Акции takeAway» with the
summary of §4.2 (period = the page's period; «Долг takeAway к ближайшей
выплате» always now) and the list of promo orders (date, №, promo, по меню,
оплатил гость, компенсация, status «начислена» / «в выплате» / «погашена
dd.mm»). The order detail and the kitchen board card show the line of §4.4.

**Web, Mini App, mobile app**

- Profile: a «Мои бонусы» banner while `GET /me/bonuses` has one: «Приветственный
  бонус −10% · на заказ в любом заведении · до 17 ноября».
- Checkout: with a bonus, no code applied, the store in the bonus's currency
  and the customer not having removed it for this cart, the bonus code goes
  into the promo field and is validated by itself; the applied state reads
  «Приветственный бонус −10%» with «Убрать». Removed, it stays removed for
  that checkout (the customer may type the code back).
- A TAKEAWAY result disables «Оплатить баллами» with «Баллы нельзя совместить с
  промокодом» and sends `pointsToSpend: 0`.
- New error texts: `PROMO_NOT_HERE` «Акция не действует в этом заведении»,
  `PROMO_WITH_POINTS` «Баллы нельзя совместить с промокодом».
- The order screen / receipt: with `takeawayPromo`, the discount line reads
  «Акция takeAway −10%» (the code beside it, as now).

## 6. Acceptance (from the spec)

- 100 at 10 %: guest pays 90, D = 10, the brand's debt 10; 15,55 → 1,56 / 13,99.
- A promo order of 100 pays the venue what a regular order of 100 does.
- Σ accrued debts of all brands = Σ `spentCents` of all promos, once no promo
  order is waiting for its payment (held orders are in `spentCents` already).
- A failed / cancelled / expired order: promo not used, `spentCents` back.
- The payout has «Компенсация takeAway по акциям» = Σ D; after it is marked
  paid its debts read «погашена» with the date.
- Current debt = accrued − repaid, per brand and in total; the brand cabinet
  and the platform report agree.
- One use per customer; exhausted promos stop by themselves; concurrent
  orders never push `spentCents` past `budgetCents`.
- Out of its dates or switched off: refused with a clear message.
- Percent frozen after the first order; editing or switching off never
  changes placed orders.
