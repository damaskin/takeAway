# Settlements with brands («Расчёты с брендами»)

Customers pay by card through the platform's acquiring — Agroprombank
(«Клевер», bound cards or «Web-платёж»), Stripe as a fallback. The money lands
on the platform's account, so the platform owes every brand what its guests
paid, minus the commission. This page is how that debt is computed, fixed and
paid out.

- Platform admin: **«Расчёты с брендами»** (`/settlements`) — any brand, rate
  changes, payouts.
- Brand owner (`BRAND_ADMIN`): **«Расчёты»** (same page) — the same figures for
  their own brand, read-only.

Code: `apps/api/src/app/settlements` (arithmetic in `settlement-math.ts`),
`apps/api/src/app/plans/commission-history.ts`, the admin page in
`apps/admin/src/app/features/settlements`. Data: `BrandCommissionRate`,
`BrandPayout` (migration `20261010120000_brand_settlements`).

---

## 1. Definitions

One report covers **one brand, one currency and a period of calendar days in
the brand's time zone** (the zone most of its stores keep — the same days the
dashboards count). Currencies are never added together: NoName Coffee sold in
MDL until 2026-09-23 and in RUP since, and those are two settlements.

| Term                            | Meaning                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Counted order**               | A card payment for it was captured (even if refunded since), **or** the store accepted it. A cancelled or expired order with no captured payment never counts; a held payment that was never captured does not either.         |
| **Settled at**                  | The moment the store accepted the order; if it never did (paid, then cancelled and refunded), the moment its first payment was captured. It picks the order's **day** and its **commission rate**.                             |
| **Продажи** (sales)             | `Order.subtotalCents` — line items before any discount.                                                                                                                                                                        |
| **Промокоды**                   | `discountCents − pointsDiscountCents` — promo-code discounts.                                                                                                                                                                  |
| **Баллы**                       | `pointsDiscountCents` — loyalty points spent.                                                                                                                                                                                  |
| **Подарочные карты**            | `giftCardCents` — gift-card balance redeemed.                                                                                                                                                                                  |
| **Оплачено картами** (captured) | Sum of `Payment.amountCents` over the order's payments in `SUCCEEDED`, `PARTIALLY_REFUNDED` or `REFUNDED`, in the order's currency. Tips (`Payment.tipCents`) are routed to the employee's card by the bank and are not in it. |
| **Возвраты** (refunds)          | Sum of `Payment.refundedCents` over those payments (never more than captured).                                                                                                                                                 |
| **База комиссии**               | captured − refunded: money the platform really received and kept.                                                                                                                                                              |
| **Комиссия**                    | base × the rate in force when the order settled, rounded per order (see 3).                                                                                                                                                    |
| **К выплате** (payable)         | base − commission.                                                                                                                                                                                                             |

Every counted order with no card money is shown separately, never hidden:

- **orders at 0** — promo, points or a gift card covered everything, nothing to
  pay, so no payment exists (`zeroTotalOrders`);
- **unpaid orders** — something to pay but no card payment through the
  platform: the store accepted it while card payments were off and the guest
  paid at the counter (`unpaidOrders`, `unpaidTotalCents`).

Neither brings money to the platform, so neither adds to the payout or to the
commission (see decisions 1 and 6).

## 2. Formulas

Per order _i_ settled at _tᵢ_ with rate _r(tᵢ)_ in basis points:

```
baseᵢ       = capturedᵢ − refundedᵢ
commissionᵢ = ⌊(baseᵢ × r(tᵢ) + 5000) / 10000⌋        -- half up, whole cents
payableᵢ    = baseᵢ − commissionᵢ
```

For a period _P_ = [start, end):

```
payable(P)  = Σ payableᵢ over orders settled in P
accrued(t)  = Σ payableᵢ over every order settled before t   -- all time
owed(t)     = accrued(t) − Σ PAID payouts whose period ended by t

opening     = owed(start)
paid        = Σ PAID payouts whose period ends inside P
closing     = opening + payable(P) − paid  = owed(end)      -- «Остаток»
```

A payout fixed but not yet transferred (`PENDING`) is still owed; the page
shows it next to the closing balance.

## 3. Rounding

Everything is integer minor units. The only rounding is the commission, **half
up to a whole cent, per order**: 349.95 kopecks → 350, 0.45 → 0, 1.5 → 2.
Rounding each order (rather than the day or the period) makes every day add up
to the period and every period to the year exactly, and a re-run gives the
same kopecks. Tests: `settlement-math.spec.ts`.

## 4. Worked example

A PRO brand at 15 %, prices in roubles (RUP, kopecks in brackets), one day:

| Order | What happened                                | Продажи | Скидки          | Гость заплатил картой | Возврат | База   | Комиссия 15 % | К выплате  |
| ----- | -------------------------------------------- | ------- | --------------- | --------------------- | ------- | ------ | ------------- | ---------- |
| A     | Latte + croissant                            | 75.00   | —               | 75.00                 | —       | 75.00  | 11.25         | 63.75      |
| B     | Free coffee on a promo code — **shows as 0** | 40.00   | promo 40.00     | 0 (no payment)        | —       | 0      | 0             | 0          |
| C     | 120.00, of which 50.00 from a gift card      | 120.00  | gift card 50.00 | 70.00                 | —       | 70.00  | 10.50         | 59.50      |
| D     | 60.00, of which 10.00 in loyalty points      | 60.00   | points 10.00    | 50.00                 | —       | 50.00  | 7.50          | 42.50      |
| E     | 33.33, then 10.00 refunded                   | 33.33   | —               | 33.33                 | 10.00   | 23.33  | 3.50 (3.4995) | 19.83      |
|       | **Total**                                    | 328.33  | 40 + 10 + 50    | **228.33**            | 10.00   | 218.33 | **32.75**     | **185.58** |

- **Order B** is the manager's "promo orders show 0 руб." The guest paid
  nothing, the platform received nothing, and under the v1 rule the brand gets
  nothing for it — the brand funded its own promo. If the platform had funded
  that promo, it would owe the brand 40.00 more (decision 1).
- **Order C**: the brand sold the gift card itself and already holds the 50.00.
  The platform received 70.00 and pays out 70.00 − 10.50. Adding the 50.00 to
  the payout would pay the brand twice (decision 3).
- **Order E**: commission on 23.33 is 3.4995 → 3.50.

The brand's previous payout covered the days up to yesterday and was paid in
full. «Зафиксировать выплату» for this day creates a `PENDING` payout of
**185.58** (`cardNetCents` 218.33, `commissionCents` 32.75). Next week a guest
of order A gets a full refund: the closing balance of the week goes 63.75 down,
and the following payout is 63.75 smaller. If nothing else is sold, the balance
is −63.75 — nothing is fixed (`NOTHING_DUE`), the brand owes the platform, and
the next positive week absorbs it.

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
  Payouts already fixed keep their amounts; the difference shows up in the
  balance and is settled by the next payout.
- A rate dated in the future takes over on its day; the hourly
  `commission-rate-sync` job copies it onto `Brand.commissionBps`.
- A brand that had no history yet gets its current rate recorded from its
  creation before the first change, so a change never rewrites the past.

## 6. Payouts

`BrandPayout`: brand, currency, `periodFrom`–`periodTo` (local days),
`periodEnd` (the instant the last day ends), `amountCents`, the period's
`cardNetCents` and `commissionCents` as they were when fixed, `status`
`PENDING` → `PAID`, `paidAt`, `reference`, `comment`, who did what.

- **«Зафиксировать выплату»** (`POST /admin/settlements/payouts { brandId,
currency, to }`) creates a `PENDING` payout that starts the day after the
  last payout (the first one: at the first counted order) and ends on `to`.
  Its amount is **owed at the end of `to` minus every payout fixed so far** —
  the period's own money plus whatever earlier payouts did not cover (a refund
  after a payout, a rate corrected backwards). Refused with 409 when `to` has
  not ended in the brand's zone (`PAYOUT_PERIOD_OPEN`), when a payout already
  settles that day (`PAYOUT_OVERLAP`) or when nothing is owed
  (`PAYOUT_NOTHING_DUE`). Serialised per brand and currency with a Postgres
  advisory lock, so a double click cannot fix the same money twice.
- **«Отметить выплаченной»** (`PATCH …/payouts/:id/paid { reference? }`) once
  the transfer went out. A paid payout is final.
- A pending payout fixed by mistake can be removed, but only the latest one
  (`DELETE …/payouts/:id`), so periods never get a hole.

## 7. API

```
GET    /admin/settlements?brandId=&currency=&from=&to=     SUPER_ADMIN (brandId required) · BRAND_ADMIN (own brands)
GET    /admin/settlements/rates?brandId=                     SUPER_ADMIN · BRAND_ADMIN
POST   /admin/settlements/rates        { brandId, bps|null, effectiveFrom, note? }   SUPER_ADMIN
DELETE /admin/settlements/rates/:id                          SUPER_ADMIN
POST   /admin/settlements/payouts      { brandId, currency, to, reference?, comment? } SUPER_ADMIN
PATCH  /admin/settlements/payouts/:id/paid  { reference?, comment?, paidAt? }        SUPER_ADMIN
DELETE /admin/settlements/payouts/:id                        SUPER_ADMIN (latest PENDING only)
```

The report (`SettlementReport` in `libs/shared-types`) carries the totals,
every day of the period, the rates in force, the balance, a preview of the
next payout and the payout list. CSV export is built in the admin from the
same report (`;` and decimal commas in Russian, for Excel).

## 8. Limits of v1

- The balance needs every counted order of the brand up to the end of the
  period; they are read on each request. Fine for today's volumes; at scale
  the per-order commission should be stored when the order settles.
- No manual adjustment line (compensation for a platform-funded promo, a
  penalty, a bank fee). Until there is one, a payout amount is exactly the
  formula.
- Plan changes before 2026-10-10 were not recorded; the backfill assumes
  today's rate since each brand's creation.
- Payouts are matched on the period they settle, not on the day the money
  left; «Уже выплачено» for a period means "paid for days in it".

## 9. Decisions for the owner

v1 takes the conservative reading of each; each is a small change once decided.

1. **Who funds promo codes?** v1: the brand that created the promo — order B
   pays the brand nothing. If the platform runs promos at its own cost
   (launch campaigns, "first coffee free" from takeAway), those promos need a
   "funded by the platform" flag, and the platform owes the brand the discount
   (40.00 for order B) on top of the payout. Same question for **loyalty
   points**: the points account is platform-wide (earned at one brand,
   referral bonuses, spendable at another), so a brand where points are spent
   may be subsidising points earned elsewhere. v1: the brand bears it.
2. **Commission base.** v1: card money actually received, net of refunds. The
   alternatives charge commission on sales before discounts, or on the price
   after promo but including gift cards and points — the brand would then pay
   commission on money that never went through the platform.
3. **Gift cards.** Today brands issue cards in the admin and sell them
   themselves, so the brand holds that money; v1 neither adds redemptions to
   the payout nor charges commission on them. If gift cards are ever sold
   online through the platform, the platform holds that money and must add
   redemptions to the payout (and decide whether to take commission on the
   sale or on the redemption).
4. **Refunds and commission.** v1 gives the commission back with the refund
   (base is net of refunds), while the bank's acquiring fee on the original
   charge is lost to the platform. Alternative: keep the commission on refunded
   orders, or only on refunds the brand caused.
5. **Acquiring fee.** v1: the platform pays the bank's fee out of its
   commission. Alternative: pass it through to the brand as a separate line.
6. **Orders not paid through the platform** (accepted unpaid orders while card
   payments are off; orders at 0). v1: no commission. Alternative: invoice the
   brand its commission on them, or deduct it from the next payout.
7. **Payout schedule and minimum.** Weekly, every two weeks or monthly; how
   many days after the period closes (a window for late refunds); a minimum
   amount below which the balance waits. v1: whenever the platform admin fixes
   a closed period.
8. **Delivery fees.** v1: part of the card money, so commission applies and the
   brand is paid the fee (its riders deliver). Alternative: no commission on
   delivery, or the fee stays with the platform if its riders deliver.
9. **Negative balance.** v1: carried forward and taken from the next payout. If
   a brand leaves with a negative balance, it has to be invoiced.
10. **Paperwork.** Agent agreement for collecting on the brand's behalf, the
    commission act/invoice per payout, and the rate history as the record of
    individual terms (`note` holds the agreement reference).
