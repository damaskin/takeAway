# Settlements with brands («Расчёты с брендами»)

**Since 2026-11-14 a guest pays the brand directly** (owner's decision on
Maxim's list 6.0, item 7). takeAway does not hold the brand's money and pays
nothing out of it. Two debts meet instead:

- the brand owes takeAway its **commission**, taken on the order's full price;
- takeAway owes the brand **compensation** for the discounts takeAway funds:
  its own promos («Акции takeAway», docs/takeaway-promos.md) and the loyalty
  points guests spend (item 6).

A period is closed by **one netted sum** («взаимозачёт»): commission −
compensation. Whoever owes pays; the other side confirms «получено».

- Platform admin: **«Расчёты с брендами»** (`/settlements`) — any brand, rate
  changes, fixing settlements, takeAway's own steps.
- Brand owner (`BRAND_ADMIN`): **«Расчёты»** (same page) — the same figures
  for their own brand, and the brand's own steps: «Отметить оплату» when the
  brand pays, «Получено» / «Не получено» when takeAway pays.

Code: `apps/api/src/app/settlements` (arithmetic in `settlement-math.ts`),
`apps/api/src/app/plans/commission-history.ts`, the admin page in
`apps/admin/src/app/features/settlements`. Data: `BrandCommissionRate`,
`BrandPayout` (migrations `20261010120000_brand_settlements`,
`20261114100000_settlement_netting`). The model and the routes keep the old
«payout» names; one row is one period's settlement.

> Today the card and QR payments still land on takeAway's single Agroprombank
> terminal (`AGROPROMBANK_*` env). Routing each brand's money to its own
> terminal is a separate task; the accounting below already treats the card
> money as the brand's.

---

## 1. Definitions

One report covers **one brand, one currency and a period of calendar days in
the brand's time zone** (the zone most of its stores keep — the same days the
dashboards count). Currencies are never added together.

| Term                               | Meaning                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Counted order**                  | A card payment for it was captured (even if refunded since), **or** the store accepted it. A cancelled or expired order with no captured payment never counts; a held payment that was never captured does not either. |
| **Settled at**                     | The moment the store accepted the order; if it never did (paid, then cancelled and refunded), the moment its first payment was captured. It picks the order's **day** and its **commission rate**.                     |
| **Продажи** (sales)                | `Order.subtotalCents` — line items before any discount.                                                                                                                                                                |
| **Промокоды**                      | `discountCents − pointsDiscountCents − takeawayDiscountCents` — discounts of the brand's own promo codes. The brand pays for them; takeAway never does (Maxim, 2026-11-06, №11).                                       |
| **Подарочные карты**               | `giftCardCents` — the brand sold the card and already holds that money.                                                                                                                                                |
| **Всего оплачено картами**         | Captured − refunded: `Payment.amountCents` over the order's payments in `SUCCEEDED`, `PARTIALLY_REFUNDED` or `REFUNDED`, minus their `refundedCents`. Tips are not in it.                                              |
| **Компенсация takeAway по акциям** | Σ D of the order's takeAway promo (`TakeawayPromoRedemption.discountCents`). 0 for a cancelled or expired order.                                                                                                       |
| **Компенсация takeAway по баллам** | `pointsDiscountCents` — the loyalty points spent. 0 for a cancelled or expired order (the points went back).                                                                                                           |
| **Компенсация** (total)            | promo + points: what takeAway owes the brand for the order.                                                                                                                                                            |
| **База комиссии**                  | card money + compensation: the order at the price the brand would have got without takeAway's discounts.                                                                                                               |
| **Комиссия takeAway**              | base × the rate in force when the order settled, rounded per order (see 3).                                                                                                                                            |
| **К взаиморасчёту** (net)          | commission − compensation. **Positive — the brand owes takeAway; negative — takeAway owes the brand.** Every signed figure on the page and in the API reads this way.                                                  |

Every counted order with no card money is shown separately, never hidden:

- **orders at 0** — the brand's promo or a gift card covered everything
  (`zeroTotalOrders`);
- **unpaid orders** — something to pay but no card payment: the store accepted
  it while card payments were off and the guest paid at the counter
  (`unpaidOrders`, `unpaidTotalCents`).

No commission is taken on them (decision 6 below is open).

## 2. Formulas

Per order _i_ settled at _tᵢ_ with rate _r(tᵢ)_ in basis points:

```
cardᵢ        = capturedᵢ − refundedᵢ
compᵢ        = promoᵢ + pointsᵢ                      -- 0 once cancelled or expired
baseᵢ        = cardᵢ + compᵢ
commissionᵢ  = ⌊(baseᵢ × r(tᵢ) + 5000) / 10000⌋       -- half up, whole cents
netᵢ         = commissionᵢ − compᵢ                    -- + brand → takeAway, − takeAway → brand
```

What the brand keeps of an order is `cardᵢ − netᵢ = baseᵢ − commissionᵢ`: a
promo or points order leaves it exactly what a regular order of the same full
price does.

A settlement _S_ has a direction and an amount ≥ 0; signed, it is +amount
when the brand pays and −amount when takeAway pays. For a period _P_ =
[start, end):

```
net(P)      = Σ netᵢ over orders settled in P
accrued(t)  = Σ netᵢ over every order settled before t       -- all time
owed(t)     = accrued(t) − Σ signed CONFIRMED settlements whose period ended by t

opening     = owed(start)
settled     = Σ signed CONFIRMED settlements whose period ends inside P
closing     = opening + net(P) − settled = owed(end)         -- «Остаток»
```

A settlement fixed, or marked paid, but not confirmed by the receiver is still
owed; the page shows it next to the closing balance (`closingOpenCents`).

## 3. Rounding

Everything is integer minor units. The only rounding is the commission, **half
up to a whole cent, per order**: 349.95 kopecks → 350, 0.45 → 0, 1.5 → 2.
Rounding each order (rather than the day or the period) makes every day add up
to the period and every period to the year exactly, and a re-run gives the
same kopecks. Tests: `settlement-math.spec.ts`, `settlements.db.spec.ts`.

## 4. Worked example

A PRO brand at 15 %, prices in roubles (RUP, kopecks in brackets), one day,
guests pay the brand:

| Order | What happened                           | Продажи | Скидки               | Картой | Компенсация  | База   | Комиссия 15 % | Взаиморасчёт |
| ----- | --------------------------------------- | ------- | -------------------- | ------ | ------------ | ------ | ------------- | ------------ |
| A     | Latte + croissant                       | 75.00   | —                    | 75.00  | —            | 75.00  | 11.25         | +11.25       |
| B     | Free coffee on the brand's promo code   | 40.00   | brand promo 40.00    | 0      | —            | 0      | 0             | 0            |
| C     | 120.00, of which 50.00 from a gift card | 120.00  | gift card 50.00      | 70.00  | —            | 70.00  | 10.50         | +10.50       |
| D     | 60.00, of which 10.00 in loyalty points | 60.00   | points 10.00         | 50.00  | points 10.00 | 60.00  | 9.00          | −1.00        |
| E     | 33.33, then 10.00 refunded              | 33.33   | —                    | 23.33  | —            | 23.33  | 3.50 (3.4995) | +3.50        |
| F     | 100.00 with a takeAway promo −10 %      | 100.00  | takeAway promo 10.00 | 90.00  | promo 10.00  | 100.00 | 15.00         | +5.00        |
|       | **Total**                               | 428.33  |                      | 308.33 | **20.00**    | 328.33 | **49.25**     | **+29.25**   |

- The brand owes takeAway **29.25** for the day: 49.25 of commission less the
  20.00 takeAway owes for the points (D) and its promo (F).
- **Order D** leaves the brand 50.00 + 10.00 − 9.00 = 51.00 = 60.00 − 15 %:
  what a regular order of 60.00 leaves. Same for **F**: 90.00 + 10.00 − 15.00
  = 85.00.
- **Order B** is the brand's own promo: nothing either way.
- **Order C**: the gift-card share is not in the base — the brand sold the
  card and took the money then.

The previous settlement covered the days up to yesterday and was confirmed.
«Зафиксировать взаиморасчёт» for this day creates a `PENDING` settlement
`BRAND_TO_TAKEAWAY` of **29.25** (`cardNetCents` 308.33, `commissionCents`
49.25, `compensationCents` 10.00, `pointsCompensationCents` 10.00). Had the
compensation outweighed the commission, the net would be negative and the
settlement would read `TAKEAWAY_TO_BRAND` for the difference.

## 5. Commission rates

`BrandCommissionRate` keeps the brand's rate over time: each row applies from
its `effectiveFrom` until the next row's, so the validity ranges are contiguous
by construction and no gap or overlap has to be policed; the first row also
covers anything before it. `Brand.commissionBps` mirrors the row in force now
(the dashboards and the plan card read it).

- The migration gives every brand one row: today's rate, from the brand's
  creation. Commission only came in with plans on 2026-10-04 and nothing
  older was ever recorded.
- **«Бренды» → plan change** (`PATCH /admin/brands/:id/plan`) writes a row from
  _now_ — a plan's default (PLAN) or a typed rate (INDIVIDUAL).
- **«Расчёты» → «Новая ставка»** (`POST /admin/settlements/rates`) writes a row
  from the start of a chosen day in the brand's zone: an individual rate, or
  "back to the plan's rate". A second row on the same instant replaces the
  first, which is how a typo is corrected; a row can also be removed.
- A rate dated in the past recalculates every settlement from that day on.
  Settlements already fixed keep their amounts; the difference shows up in
  the balance and goes into the next settlement.
- A rate dated in the future takes over on its day; the hourly
  `commission-rate-sync` job copies it onto `Brand.commissionBps`.
- A brand that had no history yet gets its current rate recorded from its
  creation before the first change, so a change never rewrites the past.

## 6. Settlements

`BrandPayout`: brand, currency, `periodFrom`–`periodTo` (local days),
`periodEnd` (the instant the last day ends), `direction`
(`BRAND_TO_TAKEAWAY` | `TAKEAWAY_TO_BRAND`), `amountCents` (≥ 0), the
period's `cardNetCents`, `commissionCents`, `compensationCents` (promo) and
`pointsCompensationCents` as they were when fixed, `status`, `paidAt`,
`confirmedAt`, `disputedAt` + `disputeComment`, `reference`, `comment`, who did
what.

| Status      | Words on the page               | Who moves it on                                                   |
| ----------- | ------------------------------- | ----------------------------------------------------------------- |
| `PENDING`   | «Ждёт оплаты»                   | payer → `PAID`; receiver → `CONFIRMED`; platform admin may delete |
| `PAID`      | «Оплачено — ждёт подтверждения» | receiver → `CONFIRMED` or `DISPUTED`                              |
| `DISPUTED`  | «Не получено» + the reason      | payer → `PAID` again; receiver → `CONFIRMED`                      |
| `CONFIRMED` | «Получено dd.mm»                | final                                                             |

The payer is the platform admin for `TAKEAWAY_TO_BRAND` and the brand's owner
for `BRAND_TO_TAKEAWAY`; the receiver is the other side. The rules live in
`settlementActions()` (`libs/shared-types/src/lib/settlements.ts`), which the
API enforces and the page reads. A step the other side takes answers 403
`PAYOUT_NOT_YOUR_SIDE`; a step the status no longer allows answers 409
`PAYOUT_STATUS`.

- **«Зафиксировать взаиморасчёт»** (`POST /admin/settlements/payouts {
brandId, currency, to }`) creates a `PENDING` settlement that starts the day
  after the last one (the first one: at the first counted order) and ends on
  `to`. Its amount is **the signed balance at the end of `to` minus every
  settlement fixed so far**, whatever their status — the period's own net plus
  whatever earlier settlements did not cover (a refund after a settlement, a
  rate corrected backwards) — paid whichever way it points. Refused with 409
  when `to` has not ended in the brand's zone (`PAYOUT_PERIOD_OPEN`), when a
  settlement already covers that day (`PAYOUT_OVERLAP`) or when commission and
  compensation cancel out exactly (`PAYOUT_NOTHING_DUE`). Serialised per brand
  and currency with a Postgres advisory lock, so a double click cannot fix the
  same money twice. It stamps the takeAway promo debts it covers
  (`TakeawayPromoRedemption.payoutId`): «во взаиморасчёте», then «погашена»
  once the settlement is confirmed.
- **The «Взаиморасчёт» card** shows the settlement the report would fix
  (`nextPayout`): up to the end of the report's period when that period has
  ended, and **up to yesterday** in the brand's zone when the period reaches
  today.
- **«Отметить оплату»** (`PATCH …/payouts/:id/paid { reference?, comment?,
paidAt? }`) — the payer, from `PENDING` or `DISPUTED`.
- **«Получено» / «Не получено»** (`PATCH …/payouts/:id/confirm { received,
comment? }`) — the receiver. «Получено» from any status but `CONFIRMED`
  (the money may arrive before the payer marks it); «Не получено» only after
  the payer marked it paid.
- A pending settlement fixed by mistake can be removed, but only the latest
  one and only while nobody paid or confirmed it (`DELETE …/payouts/:id`), so
  periods never get a hole.

Payouts fixed before 2026-11-14 (the old model, takeAway paying the brand out
of collected money) read `TAKEAWAY_TO_BRAND`; a paid one became `CONFIRMED`
(migration `20261114100100_settlement_netting_legacy`). Neither production nor
staging had any at the change.

## 7. API

```
GET    /admin/settlements?brandId=&currency=&from=&to=     SUPER_ADMIN (brandId required) · BRAND_ADMIN (own brands)
GET    /admin/settlements/takeaway-promos?…                  the brand's takeAway promo orders (docs/takeaway-promos.md §4.2)
GET    /admin/settlements/rates?brandId=                     SUPER_ADMIN · BRAND_ADMIN
POST   /admin/settlements/rates        { brandId, bps|null, effectiveFrom, note? }   SUPER_ADMIN
DELETE /admin/settlements/rates/:id                          SUPER_ADMIN
POST   /admin/settlements/payouts      { brandId, currency, to, reference?, comment? } SUPER_ADMIN
PATCH  /admin/settlements/payouts/:id/paid     { reference?, comment?, paidAt? }      the payer
PATCH  /admin/settlements/payouts/:id/confirm  { received, comment? }                 the receiver
DELETE /admin/settlements/payouts/:id                        SUPER_ADMIN (latest PENDING only)
```

The report (`SettlementReport` in `libs/shared-types`) carries the totals,
every day of the period, the rates in force, the signed balance, a preview of
the next settlement and the settlement list. CSV export is built in the admin
from the same report (`;` and decimal commas in Russian, for Excel).

The staff order list (`GET /admin/orders`) carries `takeawayFundedCents` per
order — its takeAway promo and points — so the business sees the full amount
it is credited with (`totalCents + takeawayFundedCents`, item 4). Business
analytics count such orders at the full price as well: only the brand's own
promo codes are its discount (migration `20261114110000_analytics_points_funded`).

## 8. Limits

- The balance needs every counted order of the brand up to the end of the
  period; they are read on each request. Fine for today's volumes; at scale
  the per-order commission should be stored when the order settles.
- No manual adjustment line (a penalty, a bank fee). Until there is one, a
  settlement amount is exactly the formula.
- Plan changes before 2026-10-10 were not recorded; the backfill assumes
  today's rate since each brand's creation.
- Settlements are matched on the period they cover, not on the day the money
  moved.
- Nobody is notified when a settlement waits on them; the page shows a banner.

## 9. Decisions for the owner

1. **Who funds promo codes and points?** Decided: a brand's own code is the
   brand's (Maxim, 2026-11-06, №11); takeAway's own promos (2026-11-10) and the
   loyalty points (2026-11-14, list 6.0 item 6) are takeAway's — compensated
   to the brand, commission on the full price.
2. **Where the guest's money goes.** Decided 2026-11-14: to the brand
   directly; settlements are netted (one sum, either way, confirmed by the
   receiver). Per-brand terminals in the payment code are still to do.
3. **Gift cards.** Brands issue cards in the admin and sell them themselves,
   so the brand holds that money; no commission on redemptions. If gift cards
   are ever sold online through takeAway, this needs a rule.
4. **Refunds and commission.** The commission goes back with the refund
   (base is net of refunds). Alternative: keep it on refunds the brand caused.
5. **Acquiring fee.** Open now that the brand takes the money: whose terminal,
   whose fee.
6. **Orders not paid by card** (paid at the counter while cards are off;
   orders at 0). Today: no commission. With the guest's money going to the
   brand anyway, takeAway may want its commission on them too — the formula
   would add `unpaidTotalCents` to the base.
7. **Settlement schedule and minimum.** Weekly, every two weeks or monthly; a
   minimum below which the balance waits. Today: whenever the platform admin
   fixes a closed period.
8. **Delivery fees.** Part of the card money, so commission applies.
9. **A brand that leaves with a balance** has to be invoiced or paid.
10. **Paperwork.** The commission act/invoice per settlement, and the rate
    history as the record of individual terms (`note` holds the agreement
    reference).
